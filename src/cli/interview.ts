// src/cli/interview.ts
//
// The interactive session loop — the integration point where the engine,
// the execution harness, and the LLM probe generator finally run against
// each other instead of against fixtures.
//
// Writes a scoreless session file (see src/session/schema.ts). Scoring is
// a separate command on purpose, so a session can be labeled by hand
// before anyone has seen what the agent thought.

import { createInterface } from "node:readline/promises";
import { once } from "node:events";
import { stdin, stdout } from "node:process";
import { readFileSync, writeFileSync } from "node:fs";
import { loadProblems } from "../../problem-bank/loadProblems.ts";
import type { Problem } from "../../problem-bank/schema.ts";
import { createSession, handleTurn, isTerminal } from "../engine/stateMachine.ts";
import { handleCandidateTurn } from "../engine/handleCandidateTurn.ts";
import { handleProbeTurn } from "../engine/handleProbeTurn.ts";
import type { SessionState } from "../engine/states.ts";
import type { TestCaseResult } from "../engine/evidence.ts";
import { runSubmission, type ExecutionResult } from "../execution/harness.ts";
import { nextRunId, pathsFor, createRunDir, writeSession } from "../session/store.ts";
import type { SavedSession, Submission } from "../session/schema.ts";
import { SESSION_SCHEMA_VERSION } from "../session/schema.ts";
import { parseCommand, HELP_TEXT } from "./commands.ts";
import {
  formatExecutionSummary,
  formatProblemIntro,
  formatStageBanner,
  STAGE_LABELS,
} from "./format.ts";

/** The engine only needs pass/fail; the richer harness output is kept in
 *  the session file for the human labeler, not fed into the state machine. */
function toTestCaseResults(results: ExecutionResult[]): TestCaseResult[] {
  return results.map((r) => ({
    testCaseId: r.testCaseId,
    tag: r.tag,
    passed: r.passed,
  }));
}

/** JSON has one absence, the harness type has two. Normalize on the way
 *  into the session file so a round-trip is lossless. */
function toExecutionDetails(results: ExecutionResult[]) {
  return results.map((r) => ({
    testCaseId: r.testCaseId,
    tag: r.tag,
    passed: r.passed,
    actualOutput: r.actualOutput ?? null,
    error: r.error ?? null,
    executionTimeMs: r.executionTimeMs,
  }));
}

/**
 * Reads one line, or null if the input closed.
 *
 * rl.question() does NOT reject when readline closes — its promise simply
 * never settles. Awaiting it bare means that on Ctrl-D (or any piped
 * stdin reaching EOF) the loop parks forever, node finds an empty event
 * loop, and the process exits 0 having silently discarded the session.
 * Racing the close event turns that into an ordinary end-of-input.
 */
async function askOrNull(
  rl: ReturnType<typeof createInterface>,
  prompt: string
): Promise<string | null> {
  return Promise.race([
    rl.question(prompt),
    once(rl, "close").then(() => null),
  ]);
}

function seedCandidateFile(problem: Problem, path: string): void {
  const body = [
    `# ${problem.title}`,
    `# ${problem.functionSignature}`,
    "#",
    "# Write your solution below, save the file, then type /submit in the",
    "# interview window to run it against the test cases.",
    "",
    `def solution(*args):`,
    `    pass`,
    "",
  ].join("\n");
  writeFileSync(path, body, "utf-8");
}

function pickProblem(problems: Map<string, Problem>, requestedId: string | undefined): Problem {
  if (requestedId !== undefined) {
    const problem = problems.get(requestedId);
    if (problem === undefined) {
      throw new Error(
        `Unknown problem "${requestedId}". Available: ${[...problems.keys()].sort().join(", ")}`
      );
    }
    return problem;
  }
  const ids = [...problems.keys()].sort();
  return problems.get(ids[Math.floor(Math.random() * ids.length)]!)!;
}

export async function runInterview(options: { problemId?: string } = {}): Promise<void> {
  const problems = loadProblems();
  const problem = pickProblem(problems, options.problemId);

  const paths = pathsFor(nextRunId());
  createRunDir(paths);
  seedCandidateFile(problem, paths.candidateFile);

  const startedAt = new Date().toISOString();
  let session: SessionState = createSession();
  const submissions: Submission[] = [];

  // The intro is a real interviewer turn, recorded verbatim, so the judge
  // and the labeler both see exactly what the candidate was told.
  const intro = formatProblemIntro(problem);
  session = handleTurn(session, {
    candidateTriggeredAdvance: false,
    wasProbe: false,
    speaker: "interviewer",
    text: intro,
  }).session;

  const rl = createInterface({ input: stdin, output: stdout });

  stdout.write(`\n${paths.runId}\n`);
  stdout.write(formatStageBanner("problem-intro", false));
  stdout.write(`interviewer> ${intro}\n\n`);
  stdout.write(`  Your file: ${paths.candidateFile}\n`);
  stdout.write(`  Edit it in your editor, then /submit to run. /help for commands.\n\n`);

  let quitEarly = false;
  let fatalError: unknown = null;

  try {
    while (!isTerminal(session) && !quitEarly) {
      const raw = await askOrNull(rl, "candidate> ");
      if (raw === null) {
        // Ctrl-D or end of piped input. An ordinary early quit, not an error.
        quitEarly = true;
        break;
      }

      const command = parseCommand(raw);
      let turnText: string;
      let executionResults: TestCaseResult[] | undefined;

      switch (command.kind) {
        case "empty":
          continue;

        case "help":
          stdout.write(`${HELP_TEXT}\n\n`);
          continue;

        case "code":
          stdout.write(`  Your file: ${paths.candidateFile}\n\n`);
          continue;

        case "state":
          stdout.write(`  ${STAGE_LABELS[session.current]}\n\n`);
          continue;

        case "quit":
          quitEarly = true;
          continue;

        case "unknown":
          stdout.write(`  Unknown command "/${command.name}". /help for the list.\n\n`);
          continue;

        case "submit": {
          const code = readFileSync(paths.candidateFile, "utf-8");
          stdout.write(`\n  Running ${problem.testCases.length} test cases...\n`);

          const results = await runSubmission(code, problem);
          stdout.write(`${formatExecutionSummary(results)}\n\n`);

          executionResults = toTestCaseResults(results);
          // The code goes in the transcript because the judge scores
          // approach-correctness and complexity-analysis off what was
          // actually written, not off how the candidate described it.
          turnText = `(submits code)\n\n${code.trim()}`;
          submissions.push({
            turnIndex: session.evidence.transcript.length,
            code,
            results: toExecutionDetails(results),
          });
          break;
        }

        case "message":
          turnText = command.text;
          break;
      }

      const turn = await handleCandidateTurn(session, {
        text: turnText,
        ...(executionResults !== undefined ? { executionResults } : {}),
      });
      session = turn.session;

      if (turn.transitioned && turn.toState !== null) {
        stdout.write(formatStageBanner(turn.toState, turn.reason === "probe-cap-exceeded"));
        continue; // new stage — the candidate gets the floor, no probe yet
      }

      // The candidate's turn didn't move things along, so the interviewer
      // asks something. This is also where the probe cap can force an
      // advance with nothing said.
      let outcome;
      try {
        outcome = await handleProbeTurn(session, { problem });
      } catch (err) {
        // generateProbe is fail-fast by design: a fabricated fallback probe
        // would land in the transcript and then in the gold corpus, reading
        // as real agent behavior. End the session instead, keeping what we
        // have.
        stdout.write(`\n  Could not generate the next question: ${(err as Error).message}\n`);
        stdout.write(`  Ending the session here; the transcript is still saved.\n\n`);
        quitEarly = true;
        break;
      }

      session = outcome.result.session;

      if (outcome.kind === "probed") {
        stdout.write(`interviewer> ${outcome.probe.probe}\n\n`);
      }
      if (outcome.result.transitioned && outcome.result.toState !== null) {
        stdout.write(
          formatStageBanner(outcome.result.toState, outcome.result.reason === "probe-cap-exceeded")
        );
      }
    }

    if (isTerminal(session)) {
      const closing = "That's everything I wanted to cover. Thanks for walking me through it.";
      session = handleTurn(session, {
        candidateTriggeredAdvance: false,
        wasProbe: false,
        speaker: "interviewer",
        text: closing,
      }).session;
      stdout.write(`interviewer> ${closing}\n\n`);
    }
  } catch (err) {
    // Held rather than rethrown, so the save below still runs. Losing a
    // played interview to a crash is worse than any error it could report,
    // and an abandoned transcript is still valid eval data.
    fatalError = err;
  } finally {
    rl.close();
  }

  const saved: SavedSession = {
    schemaVersion: SESSION_SCHEMA_VERSION,
    runId: paths.runId,
    problemId: problem.id,
    startedAt,
    endedAt: new Date().toISOString(),
    finalState: session.current,
    completed: isTerminal(session),
    transcript: session.evidence.transcript,
    submissions,
    transitionLog: session.evidence.transitionLog,
  };

  writeSession(saved, paths);

  stdout.write(`  Saved ${paths.sessionFile}\n`);
  stdout.write(`  Next: npm run label ${paths.runId}   (before you look at agent scores)\n`);
  stdout.write(`        npm run score ${paths.runId}\n\n`);

  if (fatalError !== null) throw fatalError;
}
