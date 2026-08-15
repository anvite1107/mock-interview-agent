// eval-harness/personaSchema.ts
//
// A scripted candidate: the turns one hypothetical interviewee takes on one
// problem. Replaying a persona through the real engine produces a real
// session — genuine probes, genuine execution results — with only the
// candidate's half predetermined.
//
// Lives under eval-harness/ for the same reason goldSchema.ts does: these
// are evaluation artifacts. Nothing the agent does at interview time reads
// them, and nothing in the labeling path may.
//
// WHAT IS DELIBERATELY ABSENT: expected scores. A persona says how the
// candidate BEHAVES, never how they should be graded. Writing a target
// score here would turn labeling into recall of the target rather than a
// reading of the transcript, and the agreement metric would then be
// measuring the corpus author agreeing with themselves.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, basename } from "node:path";
import { z } from "zod";

export const PERSONA_SCHEMA_VERSION = 1;

const PERSONAS_DIR = join(dirname(fileURLToPath(import.meta.url)), "personas");
const CODE_DIR = join(PERSONAS_DIR, "code");

/** Something the candidate says. Goes into the transcript verbatim. */
const SayTurnSchema = z.object({
  kind: z.literal("say"),
  text: z.string().min(1),
});

/** The candidate editing their file. Produces NO transcript entry — a
 *  person typing in their editor isn't a turn, and inventing one would put
 *  words in the transcript that were never spoken.
 *
 *  Code lives in a real .py file rather than a JSON string so it can be
 *  run, diffed and linted like the Python it is. `file` is a bare filename
 *  resolved against personas/code/. */
const CodeTurnSchema = z.object({
  kind: z.literal("code"),
  file: z.string().regex(/^[a-z0-9.-]+\.py$/, "code file must be a bare .py filename"),
});

/** Emits the literal "/submit" and "/quit" lines rather than calling the
 *  harness directly, so scripted turns go through the same parseCommand
 *  dispatch (src/cli/commands.ts) a typed line does. A replay that bypassed
 *  the parser wouldn't be exercising the code path it claims to. */
const SubmitTurnSchema = z.object({ kind: z.literal("submit") });
const QuitTurnSchema = z.object({ kind: z.literal("quit") });

export const PersonaTurnSchema = z.discriminatedUnion("kind", [
  SayTurnSchema,
  CodeTurnSchema,
  SubmitTurnSchema,
  QuitTurnSchema,
]);

export type PersonaTurn = z.infer<typeof PersonaTurnSchema>;

const PersonaShape = z.object({
  schemaVersion: z.literal(PERSONA_SCHEMA_VERSION),
  id: z.string().regex(/^[a-z0-9-]+$/, "id must be kebab-case"),
  problemId: z.string().min(1),
  /** Behavioral description — what this candidate does, not what they earn.
   *  Read when authoring and when diagnosing a weird transcript; never
   *  during labeling. */
  notes: z.string().min(1),
  turns: z.array(PersonaTurnSchema).min(1),
});

type PersonaInput = z.infer<typeof PersonaShape>;

export const PersonaSchema = PersonaShape.superRefine((persona: PersonaInput, ctx) => {
  // A submit with no preceding code turn runs whatever the seeded stub
  // contains, which fails every test case for a reason that has nothing to
  // do with the candidate being modeled.
  const firstSubmit = persona.turns.findIndex((t) => t.kind === "submit");
  const firstCode = persona.turns.findIndex((t) => t.kind === "code");
  if (firstSubmit !== -1 && (firstCode === -1 || firstCode > firstSubmit)) {
    ctx.addIssue({
      code: "custom",
      message: `Persona "${persona.id}" submits at turn ${firstSubmit} before any code turn`,
      path: ["turns", firstSubmit],
    });
  }

  // A quit is an ending. Turns after it would silently never run.
  const quitIndex = persona.turns.findIndex((t) => t.kind === "quit");
  if (quitIndex !== -1 && quitIndex !== persona.turns.length - 1) {
    ctx.addIssue({
      code: "custom",
      message: `Persona "${persona.id}" has turns after its quit at index ${quitIndex}`,
      path: ["turns", quitIndex],
    });
  }
});

export type Persona = z.infer<typeof PersonaSchema>;

/** A persona with its code files read off disk, so the replay driver never
 *  touches the filesystem mid-session. */
export interface LoadedPersona extends Persona {
  /** filename -> file contents, for every code turn in `turns`. */
  code: Map<string, string>;
}

function personaPath(id: string): string {
  return join(PERSONAS_DIR, `${id}.json`);
}

export function loadPersona(id: string): LoadedPersona {
  const path = personaPath(id);
  if (!existsSync(path)) {
    throw new Error(`No persona at ${path}. Available: ${listPersonaIds().join(", ")}`);
  }

  const result = PersonaSchema.safeParse(JSON.parse(readFileSync(path, "utf-8")));
  if (!result.success) {
    throw new Error(
      `Persona ${id} failed validation:\n${JSON.stringify(result.error.format(), null, 2)}`
    );
  }
  const persona = result.data;

  if (persona.id !== id) {
    // Otherwise `replay foo` silently plays bar, and the resulting session
    // is attributed to the wrong persona in the corpus.
    throw new Error(`Persona file ${basename(path)} declares id "${persona.id}".`);
  }

  const code = new Map<string, string>();
  for (const turn of persona.turns) {
    if (turn.kind !== "code" || code.has(turn.file)) continue;
    const codePath = join(CODE_DIR, turn.file);
    if (!existsSync(codePath)) {
      throw new Error(`Persona ${id} references missing code file ${codePath}`);
    }
    code.set(turn.file, readFileSync(codePath, "utf-8"));
  }

  return { ...persona, code };
}

export function listPersonaIds(): string[] {
  if (!existsSync(PERSONAS_DIR)) return [];
  return readdirSync(PERSONAS_DIR)
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.slice(0, -".json".length))
    .sort();
}
