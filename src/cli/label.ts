// src/cli/label.ts
//
// Blind human labeling of a played session.
//
// "Blind" is the whole design constraint: this command reads session.json,
// which by construction carries no scores, and it never loads report.json
// even if one exists. Seeing the agent's answer first would anchor the
// label, and an anchored label makes the agreement metric measure nothing.

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { existsSync, writeFileSync } from "node:fs";
import { loadRubric } from "../rubric/loadRubric.ts";
import { loadProblems } from "../../problem-bank/loadProblems.ts";
import { resolveRun, readSession } from "../session/store.ts";
import { GoldLabelsSchema, GOLD_SCHEMA_VERSION, type GoldLabels } from "../../eval-harness/goldSchema.ts";
import { formatExecutionSummary, formatTranscriptForReview } from "./format.ts";

async function askScore(
  rl: ReturnType<typeof createInterface>,
  categoryLabel: string
): Promise<number> {
  for (;;) {
    const raw = (await rl.question("  Score (1-5)> ")).trim();
    const score = Number.parseInt(raw, 10);
    if (Number.isInteger(score) && score >= 1 && score <= 5) return score;
    stdout.write(`  "${raw}" isn't a score for ${categoryLabel} — enter a whole number 1-5.\n`);
  }
}

async function askJustification(rl: ReturnType<typeof createInterface>): Promise<string> {
  for (;;) {
    const raw = (await rl.question("  Justification> ")).trim();
    if (raw.length > 0) return raw;
    // Refusing to accept an empty one is the point of asking first: the
    // justification is what makes a disagreement diagnosable on Day 19.
    stdout.write("  Write at least a phrase — this is what you'll read back when tuning.\n");
  }
}

export async function runLabel(runArg: string): Promise<void> {
  const paths = resolveRun(runArg);
  const session = readSession(paths);
  const rubricConfig = loadRubric();
  const problem = loadProblems().get(session.problemId);

  if (problem === undefined) {
    throw new Error(
      `Session ${session.runId} references problem "${session.problemId}", which is no longer in the problem bank.`
    );
  }

  if (existsSync(paths.goldFile)) {
    throw new Error(
      `${paths.goldFile} already exists. Delete it if you mean to relabel ${session.runId}.`
    );
  }

  stdout.write(`\n${session.runId} — ${problem.title} (${problem.difficulty})\n`);
  if (!session.completed) {
    stdout.write(`  Note: this session ended early, in ${session.finalState}.\n`);
  }
  stdout.write(`${formatTranscriptForReview(session.transcript)}\n`);

  const finalSubmission = session.submissions.at(-1);
  stdout.write("\n── Execution ──\n");
  if (finalSubmission === undefined) {
    stdout.write("  No code was ever submitted.\n");
  } else {
    stdout.write(`  Final submission (${session.submissions.length} total):\n`);
    stdout.write(`${formatExecutionSummary(finalSubmission.results)}\n`);
  }

  const rl = createInterface({ input: stdin, output: stdout });
  const categories: GoldLabels["categories"] = [];

  try {
    stdout.write("\n── Labeling ──\n");
    stdout.write("Justification first, then the score — same ordering the judge is held to.\n");

    for (const category of rubricConfig.categories) {
      stdout.write(`\n${category.label}  (weight ${category.weight})\n`);
      for (const level of ["1", "2", "3", "4", "5"] as const) {
        stdout.write(`  ${level}: ${category.anchors[level]}\n`);
      }

      const justification = await askJustification(rl);
      const score = await askScore(rl, category.label);
      categories.push({ categoryId: category.id, justification, score });
    }
  } finally {
    rl.close();
  }

  const gold: GoldLabels = {
    schemaVersion: GOLD_SCHEMA_VERSION,
    runId: session.runId,
    problemId: session.problemId,
    labeledAt: new Date().toISOString(),
    rubricCategoryIds: rubricConfig.categories.map((c) => c.id),
    categories,
  };

  writeFileSync(paths.goldFile, `${JSON.stringify(GoldLabelsSchema.parse(gold), null, 2)}\n`, "utf-8");
  stdout.write(`\n  Saved ${paths.goldFile}\n\n`);
}
