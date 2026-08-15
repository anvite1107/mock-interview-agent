#!/usr/bin/env node
// eval-harness/runEval.ts
//
// agent-vs-human-coach agreement scoring.
//
// Reads every labeled+scored run in sessions/, computes exact and within-1
// agreement overall and per rubric category, prints a table, and writes the
// full per-pair comparison to eval-harness/results/.
//
// The results file matters as much as the table. Day 19 tunes rubric
// anchors and re-runs this; comparing the new file against the old one is
// how you tell whether a reworded anchor actually helped or just moved the
// disagreements somewhere else.

import { stdout, stderr, exit } from "node:process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadRubric } from "../src/rubric/loadRubric.ts";
import type { RubricConfig } from "../src/rubric/schema.ts";
import { listRuns, type SessionPaths } from "../src/session/store.ts";
import { SessionReportSchema, type SessionReport } from "../src/report/schema.ts";
import { readGoldIfPresent, rubricDrift } from "./loadGold.ts";
import {
  compareRun,
  agreementStats,
  agreementByCategory,
  type CategoryComparison,
  type AgreementStats,
} from "./metrics.ts";

const RESULTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "results");

/** Why a run contributed nothing. Reported rather than silently dropped:
 *  a shrinking denominator is the easiest way to publish a flattering
 *  agreement number by accident. */
interface SkippedRun {
  runId: string;
  reason: string;
}

function readReportIfPresent(reportFile: string): SessionReport | null {
  if (!existsSync(reportFile)) return null;

  const result = SessionReportSchema.safeParse(JSON.parse(readFileSync(reportFile, "utf-8")));
  if (!result.success) {
    throw new Error(
      `${reportFile} failed validation:\n${JSON.stringify(result.error.format(), null, 2)}`
    );
  }
  return result.data;
}

function collectRows(
  runs: SessionPaths[],
  rubricConfig: RubricConfig
): {
  rows: CategoryComparison[];
  skipped: SkippedRun[];
  warnings: string[];
  runsIncluded: string[];
} {
  const rows: CategoryComparison[] = [];
  const skipped: SkippedRun[] = [];
  const warnings: string[] = [];
  const runsIncluded: string[] = [];

  for (const paths of runs) {
    try {
      const gold = readGoldIfPresent(paths.goldFile);
      if (gold === null) {
        skipped.push({ runId: paths.runId, reason: "not labeled — run `npm run label`" });
        continue;
      }

      const report = readReportIfPresent(paths.reportFile);
      if (report === null) {
        skipped.push({ runId: paths.runId, reason: "not scored — run `npm run score`" });
        continue;
      }

      // Drift is a warning, not a skip: the run's numbers are still
      // computable, they just describe two different rubrics. Excluding it
      // outright would hide the problem instead of flagging it.
      const drift = rubricDrift(gold, rubricConfig);
      if (drift.drifted && drift.message !== null) warnings.push(drift.message);

      rows.push(...compareRun(gold, report));
      runsIncluded.push(paths.runId);
    } catch (err) {
      skipped.push({
        runId: paths.runId,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { rows, skipped, warnings, runsIncluded };
}

function pct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function formatStatsRow(label: string, stats: AgreementStats, labelWidth: number): string {
  return (
    `  ${label.padEnd(labelWidth)}  ` +
    `${String(stats.n).padStart(4)}  ` +
    `${pct(stats.exactRate).padStart(7)}  ` +
    `${pct(stats.within1Rate).padStart(8)}`
  );
}

export function runEval(): void {
  const runs = listRuns();
  if (runs.length === 0) {
    throw new Error("No sessions in sessions/. Play or replay some first.");
  }

  const rubricConfig = loadRubric();
  const { rows, skipped, warnings, runsIncluded } = collectRows(runs, rubricConfig);

  if (warnings.length > 0) {
    stdout.write("\n── Warnings ──\n");
    for (const warning of warnings) stdout.write(`  ${warning}\n`);
  }

  if (skipped.length > 0) {
    stdout.write("\n── Excluded ──\n");
    for (const skip of skipped) stdout.write(`  ${skip.runId}: ${skip.reason}\n`);
  }

  if (rows.length === 0) {
    throw new Error(
      `No run has both gold labels and a report — nothing to compare across ${runs.length} session(s).`
    );
  }

  const labelById = new Map(rubricConfig.categories.map((c) => [c.id, c.label]));
  const byCategory = agreementByCategory(rows);
  const overall = agreementStats(rows);

  const labelWidth = Math.max(
    "OVERALL".length,
    ...[...byCategory.keys()].map((id) => (labelById.get(id) ?? id).length)
  );

  stdout.write(`\n── Agreement — ${runsIncluded.length} run(s), ${rows.length} scored categories ──\n\n`);
  stdout.write(`  ${"category".padEnd(labelWidth)}     n    exact   within-1\n`);
  stdout.write(`  ${"-".repeat(labelWidth)}  ----  -------  --------\n`);

  for (const [categoryId, stats] of byCategory) {
    stdout.write(formatStatsRow(labelById.get(categoryId) ?? categoryId, stats, labelWidth));
    stdout.write("\n");
  }

  stdout.write(`  ${"-".repeat(labelWidth)}  ----  -------  --------\n`);
  stdout.write(formatStatsRow("OVERALL", overall, labelWidth));
  stdout.write("\n");

  // Written whether or not anything disagreed — a run with no disagreements
  // is still a data point Day 19 wants to diff against.
  mkdirSync(RESULTS_DIR, { recursive: true });
  const generatedAt = new Date().toISOString();
  const outFile = join(RESULTS_DIR, `eval-${generatedAt.slice(0, 19).replace(/[:]/g, "")}.json`);

  writeFileSync(
    outFile,
    `${JSON.stringify(
      {
        generatedAt,
        rubricCategoryIds: rubricConfig.categories.map((c) => c.id),
        runsIncluded,
        skipped,
        warnings,
        overall,
        byCategory: Object.fromEntries(byCategory),
        comparisons: rows,
      },
      null,
      2
    )}\n`,
    "utf-8"
  );

  stdout.write(`\n  Saved ${outFile}\n`);
  stdout.write("  Day 19: read `comparisons` — every pair carries both justifications.\n\n");
}

try {
  runEval();
} catch (err) {
  stderr.write(`\n${err instanceof Error ? err.message : String(err)}\n\n`);
  exit(1);
}
