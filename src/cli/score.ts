// src/cli/score.ts
//
// Runs the agent's scoring pipeline over an already-played session and
// writes report.json.
//
// Separate from `interview` so it can be re-run: Day 19 tunes rubric
// anchors and re-scores the same corpus, which only works if scoring is
// decoupled from playing. Re-running is idempotent apart from LLM
// variance, and overwrites the previous report.

import { stdout } from "node:process";
import { loadRubric } from "../rubric/loadRubric.ts";
import { loadProblems } from "../../problem-bank/loadProblems.ts";
import { resolveRun, readSession, listRuns, type SessionPaths } from "../session/store.ts";
import { readGoldIfPresent, rubricDrift } from "../../eval-harness/loadGold.ts";
import type { SavedSession } from "../session/schema.ts";
import type { SessionEvidence, TestCaseResult } from "../engine/evidence.ts";
import type { SessionState } from "../engine/states.ts";
import { scoreSession } from "../evaluation/judged/scorer.ts";
import { aggregateScores } from "../evaluation/aggregator.ts";
import { buildReport } from "../report/buildReport.ts";
import { writeReport } from "../report/writeReport.ts";

/**
 * Ground truth is the candidate's FINAL submission, not every attempt
 * they made.
 *
 * The engine accumulates executionResults across turns (stateMachine.ts),
 * so a session with a buggy first attempt and a clean second one ends up
 * holding both. Feeding that to the aggregator reads as "some core tests
 * fail" and caps code-correctness — penalizing the candidate for the
 * iteration that testing-debugging exists to encourage. The rubric scores
 * the code they ended with, so that's what gets passed through.
 *
 * Earlier attempts aren't discarded, just not used as ground truth: they
 * stay in session.json, and the transcript still shows every submission,
 * so the judge can see the debugging arc when scoring communication and
 * testing behavior.
 */
function finalExecutionResults(session: SavedSession): TestCaseResult[] {
  const final = session.submissions.at(-1);
  if (final === undefined) return [];
  return final.results.map((r) => ({
    testCaseId: r.testCaseId,
    tag: r.tag,
    passed: r.passed,
  }));
}

async function scoreOne(paths: SessionPaths): Promise<void> {
  const saved = readSession(paths);
  const rubricConfig = loadRubric();
  const problem = loadProblems().get(saved.problemId);

  if (problem === undefined) {
    throw new Error(
      `Session ${saved.runId} references problem "${saved.problemId}", which is no longer in the problem bank.`
    );
  }

  // Header first so that in batch mode the drift warning below appears
  // under the run it belongs to rather than trailing the previous one.
  stdout.write(`\n${saved.runId} — scoring with the judge...\n`);

  // Checked before spending an API call, not after: if this run's labels
  // are stale the resulting score can't be compared against them anyway.
  const gold = readGoldIfPresent(paths.goldFile);
  if (gold !== null) {
    const drift = rubricDrift(gold, rubricConfig);
    if (drift.drifted) stdout.write(`  Warning: ${drift.message}\n`);
  }

  const evidence: SessionEvidence = {
    transcript: saved.transcript,
    executionResults: finalExecutionResults(saved),
    transitionLog: saved.transitionLog,
  };

  const sessionState: SessionState = {
    current: saved.finalState,
    probeCountInCurrentState: 0, // not carried in the session file; unused by the report
    evidence,
  };

  const judged = await scoreSession(evidence, problem, rubricConfig);
  const aggregated = aggregateScores(judged, evidence, rubricConfig);
  const report = buildReport(sessionState, aggregated, problem, rubricConfig);

  writeReport(report, paths.reportFile);

  stdout.write("\n── Scores ──\n");
  for (const category of report.scores.categories) {
    const flag = category.source === "ground-truth-override" ? "  [overridden by execution]" : "";
    stdout.write(`  ${category.score}/5  ${category.label}${flag}\n`);
  }
  stdout.write(`\n  Weighted total: ${report.scores.weightedTotal.toFixed(1)}/100\n`);
  stdout.write(`  Saved ${paths.reportFile}\n\n`);
}

/**
 * Scores one run, or every run with `--all`.
 *
 * Batch exists for Day 19: tuning rubric anchors means re-scoring the whole
 * corpus and re-running the agreement metric, which is only bearable as one
 * command. Individual failures are collected rather than thrown — one
 * malformed session shouldn't cost the other seventeen their API calls.
 */
export async function runScore(runArg: string): Promise<void> {
  if (runArg !== "--all") {
    await scoreOne(resolveRun(runArg));
    return;
  }

  const runs = listRuns();
  if (runs.length === 0) {
    throw new Error("No sessions to score. Play or replay some first.");
  }

  const failures: Array<{ runId: string; message: string }> = [];

  for (const paths of runs) {
    try {
      await scoreOne(paths);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      stdout.write(`  FAILED ${paths.runId}: ${message}\n\n`);
      failures.push({ runId: paths.runId, message });
    }
  }

  stdout.write("── Scoring complete ──\n");
  stdout.write(`  ${runs.length - failures.length}/${runs.length} runs scored\n`);
  for (const failure of failures) {
    stdout.write(`  failed: ${failure.runId} — ${failure.message}\n`);
  }
  stdout.write("\n");
}
