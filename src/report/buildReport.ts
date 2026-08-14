// src/report/buildReport.ts
//
// Assembles the end-of-session report. Pure and synchronous — every input
// is already computed by the time this runs, so there's no API call and
// nothing to fail partway.
//
// Takes SessionState rather than SessionEvidence because the report needs
// `current` (the final state) alongside the evidence arrays, and passing
// both separately would let a caller pair a session with someone else's
// evidence.

import type { SessionState, InterviewState } from "../engine/states.ts";
import type { TestCaseResult } from "../engine/evidence.ts";
import { isTerminal } from "../engine/stateMachine.ts";
import type { AggregatedResult } from "../evaluation/aggregator.ts";
import type { RubricConfig } from "../rubric/schema.ts";
import type { Problem } from "../../problem-bank/schema.ts";
import type { SessionReport, ReportCategoryScore } from "./schema.ts";
import { REPORT_SCHEMA_VERSION } from "./schema.ts";

export interface BuildReportOptions {
  /** ISO timestamp. Injectable so tests are deterministic; defaults to now. */
  generatedAt?: string;
}

function tally(results: TestCaseResult[], tag: "core" | "edge") {
  const tagged = results.filter((r) => r.tag === tag);
  return {
    passed: tagged.filter((r) => r.passed).length,
    total: tagged.length,
  };
}

/**
 * The ordered list of states the session actually visited, reconstructed
 * from the transition log rather than from INTERVIEW_STATES.
 *
 * Reconstructing it means an abandoned session reports only what it
 * reached, and a future non-linear flow would still report truthfully.
 * Slicing INTERVIEW_STATES up to `current` would produce the same answer
 * today only because the walk happens to be linear.
 *
 * An empty log means no transition ever fired, so the session is still in
 * the state it started in — that single state is the whole history.
 */
function statesReached(session: SessionState): InterviewState[] {
  const log = session.evidence.transitionLog;
  const first = log[0];
  if (first === undefined) {
    return [session.current];
  }
  return [first.from, ...log.map((t) => t.to)];
}

export function buildReport(
  session: SessionState,
  aggregated: AggregatedResult,
  problem: Problem,
  rubricConfig: RubricConfig,
  options: BuildReportOptions = {}
): SessionReport {
  const categoryMeta = new Map(rubricConfig.categories.map((c) => [c.id, c]));

  const categories = aggregated.categoryScores.map(
    (score): ReportCategoryScore => {
      const meta = categoryMeta.get(score.categoryId);

      // Unreachable through the real pipeline: buildScoringResponseSchema
      // already rejects any categoryId absent from the rubric, so getting
      // here means that validation was bypassed. Throwing beats emitting a
      // report with a blank label and a zero weight, which would silently
      // skew the weighted total in the eval harness.
      if (meta === undefined) {
        throw new Error(
          `buildReport: category "${score.categoryId}" is not in the rubric config. ` +
            `Scores must be validated against the same rubric used to build the report.`
        );
      }

      return {
        categoryId: score.categoryId,
        label: meta.label,
        weight: meta.weight,
        score: score.score,
        justification: score.justification,
        source: score.source,
      };
    }
  );

  const { executionResults, transitionLog, transcript } = session.evidence;

  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: options.generatedAt ?? new Date().toISOString(),

    problem: {
      id: problem.id,
      title: problem.title,
      difficulty: problem.difficulty,
      referenceComplexity: problem.referenceComplexity,
    },

    scores: {
      weightedTotal: aggregated.weightedTotal,
      categories,
      overriddenCategoryIds: categories
        .filter((c) => c.source === "ground-truth-override")
        .map((c) => c.categoryId),
    },

    execution: {
      core: tally(executionResults, "core"),
      edge: tally(executionResults, "edge"),
      results: executionResults,
    },

    flow: {
      finalState: session.current,
      completed: isTerminal(session),
      statesReached: statesReached(session),
      forcedAdvanceCount: transitionLog.filter(
        (t) => t.reason === "probe-cap-exceeded"
      ).length,
      transitions: transitionLog,
    },

    transcript,
  };
}
