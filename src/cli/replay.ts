// src/cli/replay.ts
//
// Plays a persona script through the real interview loop, producing a
// session file indistinguishable in kind from a hand-played one: real
// Gemini probes, real Python execution, real state transitions. Only the
// candidate's turns are predetermined.
//
// This exists because the eval corpus needs ~18 sessions and hand-playing
// them is 10-20 hours. The trade is stated in the README: because the
// corpus author also writes the gold labels, agreement is an upper bound.

import { stdout } from "node:process";
import { writeFileSync } from "node:fs";
import { loadPersona, listPersonaIds, type LoadedPersona } from "../../eval-harness/personaSchema.ts";
import { runInterview } from "./interview.ts";
import type { TurnSource } from "./turnSource.ts";

export interface ScriptedTurnSource extends TurnSource {
  /** Turns the session never got to. Non-zero means the interview reached
   *  wrap-up before the script ran out — see the desync note below. */
  remaining(): number;
}

/**
 * Feeds persona turns to the interview loop.
 *
 * DESYNC IS EXPECTED. Probes come from an LLM and advance-detection is
 * partly judged, so the same persona replayed twice can transition between
 * states at different points. Neither direction is an error:
 *
 *   - script exhausted first  -> next() returns null, session saves with
 *                                completed: false. Still valid eval data.
 *   - session ends first      -> leftover turns are reported by remaining()
 *                                and the caller warns.
 *
 * What would be an error is pretending otherwise — a driver that forced the
 * script to line up would be scoring a transcript the engine didn't produce.
 */
export function createScriptedTurnSource(
  persona: LoadedPersona,
  candidateFilePath: string
): ScriptedTurnSource {
  let index = 0;

  return {
    async next(): Promise<string | null> {
      // Code turns are a side effect, not an utterance: write the file and
      // keep going. Looping rather than recursing so a run of consecutive
      // code turns can't grow the stack.
      for (;;) {
        const turn = persona.turns[index];
        if (turn === undefined) return null;
        index += 1;

        switch (turn.kind) {
          case "code": {
            const source = persona.code.get(turn.file);
            if (source === undefined) {
              // loadPersona reads every referenced file up front, so this is
              // unreachable short of a bug there.
              throw new Error(`Persona ${persona.id}: code file ${turn.file} was not loaded`);
            }
            writeFileSync(candidateFilePath, source, "utf-8");
            stdout.write(`  (candidate edits ${turn.file})\n`);
            continue;
          }

          case "say":
            // Echoed because no TTY is doing it, and a replay log that shows
            // only the interviewer reads as half a conversation.
            stdout.write(`candidate> ${turn.text}\n`);
            return turn.text;

          case "submit":
            stdout.write("candidate> /submit\n");
            return "/submit";

          case "quit":
            stdout.write("candidate> /quit\n");
            return "/quit";
        }
      }
    },

    remaining: () => Math.max(0, persona.turns.length - index),
    close: () => {},
  };
}

async function replayOne(personaId: string): Promise<void> {
  const persona = loadPersona(personaId);

  stdout.write(`\n${"=".repeat(60)}\n`);
  stdout.write(`persona: ${persona.id}  ->  ${persona.problemId}\n`);
  stdout.write(`${"=".repeat(60)}\n`);

  let source: ScriptedTurnSource | null = null;

  const paths = await runInterview({
    problemId: persona.problemId,
    makeTurnSource: (candidateFile) => {
      source = createScriptedTurnSource(persona, candidateFile);
      return source;
    },
  });

  // Deliberately doesn't name a cause. Turns go unused when the session
  // reached wrap-up early, but also when it was abandoned or aborted, and
  // this has no way to tell those apart — asserting the wrong one sends
  // whoever reads the log looking in the wrong place.
  const unused = source === null ? 0 : (source as ScriptedTurnSource).remaining();
  if (unused > 0) {
    stdout.write(
      `  Note: the session ended with ${unused} scripted turn(s) unused ` +
        `(final state: ${paths.runId} — see session.json).\n`
    );
  }
  stdout.write(`  ${persona.id} -> ${paths.runId}\n`);
}

export async function runReplay(arg: string): Promise<void> {
  const ids = arg === "--all" ? listPersonaIds() : [arg];

  if (ids.length === 0) {
    throw new Error("No personas found in eval-harness/personas/.");
  }

  // One bad persona shouldn't cost the other seventeen their API calls, so
  // failures are collected and reported at the end rather than thrown.
  const failures: Array<{ id: string; message: string }> = [];

  for (const id of ids) {
    try {
      await replayOne(id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      stdout.write(`\n  FAILED ${id}: ${message}\n`);
      failures.push({ id, message });
    }
  }

  stdout.write(`\n── Replay complete ──\n`);
  stdout.write(`  ${ids.length - failures.length}/${ids.length} personas played\n`);
  for (const failure of failures) {
    stdout.write(`  failed: ${failure.id} — ${failure.message}\n`);
  }
  stdout.write("\n  Next: npm run label <run-id>   (before you look at agent scores)\n\n");
}
