// scratch/verify-corpus.ts
//
// Runs every persona's code through the real execution harness and prints
// the core/edge tally per submission.
//
// The corpus is only useful if the gold scores it produces span the whole
// 1-5 range. That spread starts with execution: a corpus where every
// persona passes everything gives the agreement metric nothing to measure.
// This is the cheap check — it takes seconds, where confirming the same
// thing by replaying 18 interviews takes an hour of API calls.
//
//   npx tsx scratch/verify-corpus.ts

import { listPersonaIds, loadPersona } from "../eval-harness/personaSchema.ts";
import { loadProblems } from "../problem-bank/loadProblems.ts";
import { runSubmission } from "../src/execution/harness.ts";

const problems = loadProblems();

for (const id of listPersonaIds()) {
  const persona = loadPersona(id);
  const problem = problems.get(persona.problemId);
  if (problem === undefined) {
    console.log(`${id.padEnd(32)} UNKNOWN PROBLEM ${persona.problemId}`);
    continue;
  }

  const codeFiles = persona.turns.filter((t) => t.kind === "code").map((t) => t.file);
  if (codeFiles.length === 0) {
    console.log(`${id.padEnd(32)} (never submits)`);
    continue;
  }

  const tallies: string[] = [];
  for (const file of codeFiles) {
    const results = await runSubmission(persona.code.get(file)!, problem);
    const core = results.filter((r) => r.tag === "core");
    const edge = results.filter((r) => r.tag === "edge");
    const errorTypes = [...new Set(results.filter((r) => !r.passed).map((r) => r.error?.type))];

    tallies.push(
      `core ${core.filter((r) => r.passed).length}/${core.length} ` +
        `edge ${edge.filter((r) => r.passed).length}/${edge.length}` +
        (errorTypes.length > 0 ? ` [${errorTypes.join(",")}]` : "")
    );
  }

  console.log(`${id.padEnd(32)} ${tallies.join("  ->  ")}`);
}
