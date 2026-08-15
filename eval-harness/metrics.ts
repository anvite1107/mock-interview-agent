// eval-harness/metrics.ts
//
// Agent-vs-gold agreement. Pure functions, no I/O — same shape as
// aggregator.ts and format.ts, so the arithmetic is testable without a
// filesystem or an API key. runEval.ts does the reading and printing.
//
// Two metrics, both on a 1-5 ordinal scale:
//
//   exact     agent and human picked the same level
//   within-1  they picked adjacent levels
//
// Within-1 carries most of the signal. On a five-point rubric, two careful
// graders routinely land one apart on the same evidence, so exact agreement
// alone understates a judge that is working. A large gap between the two
// rates is itself the finding: it means the judge has the right shape but
// is reading the anchors half a level off, which is an anchor-wording
// problem, not a judging problem.

import type { GoldLabels } from "./goldSchema.ts";
import type { SessionReport } from "../src/report/schema.ts";

/** One (run, category) pair where both a human and the agent committed to a
 *  score. The row keeps both justifications because a bare delta says a
 *  disagreement happened without saying anything about why. */
export interface CategoryComparison {
  runId: string;
  problemId: string;
  categoryId: string;
  goldScore: number;
  agentScore: number;
  /** agent - gold. Signed, so the direction survives aggregation: a judge
   *  that is uniformly one level generous is a different problem from one
   *  that is noisy in both directions, and |delta| can't tell them apart. */
  delta: number;
  goldJustification: string;
  agentJustification: string;
  /** Whether execution results capped the agent's score for this category
   *  (see aggregator.ts). A disagreement on an overridden category means
   *  the human and the test suite disagree, which is a different
   *  investigation from the judge misreading a transcript. */
  source: "judge" | "ground-truth-override";
}

export interface AgreementStats {
  n: number;
  exact: number;
  within1: number;
  /** Rates are 0-1. Zero when n is 0 rather than NaN, so an empty corpus
   *  prints as an obvious 0% instead of poisoning a table with NaNs. */
  exactRate: number;
  within1Rate: number;
}

/**
 * Pairs up one run's gold labels with the agent's report.
 *
 * Throws when the two disagree on which categories exist. That is rubric
 * drift, not a scoring disagreement: silently intersecting the two sets
 * would drop categories from the denominator and quietly inflate every
 * rate computed downstream. loadGold.ts's rubricDrift() catches the common
 * case earlier and with a better message; this is the backstop.
 */
export function compareRun(gold: GoldLabels, report: SessionReport): CategoryComparison[] {
  const agentById = new Map(report.scores.categories.map((c) => [c.categoryId, c]));
  const goldIds = gold.categories.map((c) => c.categoryId);

  const missingFromAgent = goldIds.filter((id) => !agentById.has(id));
  const missingFromGold = report.scores.categories
    .map((c) => c.categoryId)
    .filter((id) => !goldIds.includes(id));

  if (missingFromAgent.length > 0 || missingFromGold.length > 0) {
    throw new Error(
      `${gold.runId}: gold and report cover different categories ` +
        `(only in gold: ${missingFromAgent.join(", ") || "none"}; ` +
        `only in report: ${missingFromGold.join(", ") || "none"}). ` +
        `Re-label or re-score this run before including it in the eval.`
    );
  }

  return gold.categories.map((goldCategory): CategoryComparison => {
    const agent = agentById.get(goldCategory.categoryId)!;
    return {
      runId: gold.runId,
      problemId: gold.problemId,
      categoryId: goldCategory.categoryId,
      goldScore: goldCategory.score,
      agentScore: agent.score,
      delta: agent.score - goldCategory.score,
      goldJustification: goldCategory.justification,
      agentJustification: agent.justification,
      source: agent.source,
    };
  });
}

export function agreementStats(rows: CategoryComparison[]): AgreementStats {
  const exact = rows.filter((r) => r.delta === 0).length;
  const within1 = rows.filter((r) => Math.abs(r.delta) <= 1).length;

  return {
    n: rows.length,
    exact,
    within1,
    exactRate: rows.length === 0 ? 0 : exact / rows.length,
    within1Rate: rows.length === 0 ? 0 : within1 / rows.length,
  };
}

/**
 * Same stats, split by rubric category.
 *
 * The per-category view is the one worth reading. An overall rate averages
 * a category the judge nails together with one it cannot read at all, and
 * reports a middling number that describes neither — while the split says
 * which anchor to go rewrite.
 *
 * Insertion-ordered by first appearance, which for rows built off
 * GoldLabels means rubric order.
 */
export function agreementByCategory(
  rows: CategoryComparison[]
): Map<string, AgreementStats> {
  const grouped = new Map<string, CategoryComparison[]>();

  for (const row of rows) {
    const existing = grouped.get(row.categoryId);
    if (existing === undefined) grouped.set(row.categoryId, [row]);
    else existing.push(row);
  }

  return new Map([...grouped].map(([id, categoryRows]) => [id, agreementStats(categoryRows)]));
}
