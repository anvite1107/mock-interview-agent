import { describe, it, expect } from "vitest";
import { loadRubric } from "../../src/rubric/loadRubric.ts";
import {
  compareRun,
  agreementStats,
  agreementByCategory,
  type CategoryComparison,
} from "../../eval-harness/metrics.ts";
import { GOLD_SCHEMA_VERSION, type GoldLabels } from "../../eval-harness/goldSchema.ts";
import { REPORT_SCHEMA_VERSION, type SessionReport } from "../../src/report/schema.ts";

const rubricConfig = loadRubric();
const CATEGORY_IDS = rubricConfig.categories.map((c) => c.id);

function makeGold(scores: Record<string, number>, overrides: Partial<GoldLabels> = {}): GoldLabels {
  return {
    schemaVersion: GOLD_SCHEMA_VERSION,
    runId: "run-001",
    problemId: "two-sum",
    labeledAt: "2026-08-15T12:00:00.000Z",
    rubricCategoryIds: CATEGORY_IDS,
    categories: CATEGORY_IDS.map((id) => ({
      categoryId: id,
      justification: `gold note for ${id}`,
      score: scores[id] ?? 3,
    })),
    ...overrides,
  };
}

function makeReport(
  scores: Record<string, number>,
  sources: Record<string, "judge" | "ground-truth-override"> = {}
): SessionReport {
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: "2026-08-15T12:00:00.000Z",
    problem: {
      id: "two-sum",
      title: "Two Sum",
      difficulty: "easy",
      referenceComplexity: { time: "O(n)", space: "O(n)" },
    },
    scores: {
      weightedTotal: 50,
      categories: rubricConfig.categories.map((c) => ({
        categoryId: c.id,
        label: c.label,
        weight: c.weight,
        score: scores[c.id] ?? 3,
        justification: `agent note for ${c.id}`,
        source: sources[c.id] ?? "judge",
      })),
      overriddenCategoryIds: Object.keys(sources).filter(
        (id) => sources[id] === "ground-truth-override"
      ),
    },
    execution: { core: { passed: 0, total: 0 }, edge: { passed: 0, total: 0 }, results: [] },
    flow: {
      finalState: "wrap-up",
      completed: true,
      statesReached: ["problem-intro", "wrap-up"],
      forcedAdvanceCount: 0,
      transitions: [],
    },
    transcript: [],
  };
}

describe("compareRun", () => {
  it("pairs every rubric category and signs delta as agent minus gold", () => {
    const [first, second] = CATEGORY_IDS as [string, string];
    const rows = compareRun(
      makeGold({ [first]: 2, [second]: 5 }),
      makeReport({ [first]: 4, [second]: 3 })
    );

    expect(rows).toHaveLength(CATEGORY_IDS.length);

    const firstRow = rows.find((r) => r.categoryId === first)!;
    expect(firstRow.goldScore).toBe(2);
    expect(firstRow.agentScore).toBe(4);
    expect(firstRow.delta).toBe(2); // agent generous -> positive

    const secondRow = rows.find((r) => r.categoryId === second)!;
    expect(secondRow.delta).toBe(-2); // agent harsh -> negative
  });

  it("carries both justifications and the override source through", () => {
    const target = CATEGORY_IDS[0]!;
    const rows = compareRun(
      makeGold({}),
      makeReport({}, { [target]: "ground-truth-override" })
    );

    const row = rows.find((r) => r.categoryId === target)!;
    expect(row.goldJustification).toBe(`gold note for ${target}`);
    expect(row.agentJustification).toBe(`agent note for ${target}`);
    expect(row.source).toBe("ground-truth-override");
  });

  it("carries runId and problemId onto every row", () => {
    const rows = compareRun(makeGold({}), makeReport({}));
    expect(rows.every((r) => r.runId === "run-001" && r.problemId === "two-sum")).toBe(true);
  });

  // The alternative — intersecting the two category sets — shrinks the
  // denominator silently and inflates every rate computed downstream.
  it("throws rather than silently dropping a category gold has but the report lacks", () => {
    const gold = makeGold({});
    const report = makeReport({});
    report.scores.categories = report.scores.categories.slice(1);

    expect(() => compareRun(gold, report)).toThrow(/different categories/);
  });

  it("throws when the report carries a category gold never labeled", () => {
    const gold = makeGold({});
    gold.categories = gold.categories.slice(1);
    gold.rubricCategoryIds = gold.rubricCategoryIds.slice(1);

    expect(() => compareRun(gold, makeReport({}))).toThrow(/different categories/);
  });
});

describe("agreementStats", () => {
  function rowsWithDeltas(deltas: number[]): CategoryComparison[] {
    return deltas.map((delta, i) => ({
      runId: "run-001",
      problemId: "two-sum",
      categoryId: `cat-${i}`,
      goldScore: 3,
      agentScore: 3 + delta,
      delta,
      goldJustification: "",
      agentJustification: "",
      source: "judge" as const,
    }));
  }

  it("counts exact and within-1 agreement", () => {
    // deltas: 0 0 1 -1 2 -3  =>  exact 2/6, within-1 4/6
    const stats = agreementStats(rowsWithDeltas([0, 0, 1, -1, 2, -3]));

    expect(stats.n).toBe(6);
    expect(stats.exact).toBe(2);
    expect(stats.within1).toBe(4);
    expect(stats.exactRate).toBeCloseTo(2 / 6);
    expect(stats.within1Rate).toBeCloseTo(4 / 6);
  });

  it("treats exact agreement as within-1 too", () => {
    const stats = agreementStats(rowsWithDeltas([0, 0, 0]));
    expect(stats.exact).toBe(3);
    expect(stats.within1).toBe(3);
    expect(stats.within1Rate).toBe(1);
  });

  it("reports zero when nothing agrees", () => {
    const stats = agreementStats(rowsWithDeltas([2, -2, 3, 4]));
    expect(stats.exactRate).toBe(0);
    expect(stats.within1Rate).toBe(0);
  });

  // NaN rates would propagate into the printed table and the results JSON.
  it("returns 0 rates rather than NaN on an empty corpus", () => {
    const stats = agreementStats([]);
    expect(stats).toEqual({ n: 0, exact: 0, within1: 0, exactRate: 0, within1Rate: 0 });
  });
});

describe("agreementByCategory", () => {
  it("splits stats per category rather than averaging them together", () => {
    const [nailed, missed] = CATEGORY_IDS as [string, string];

    // Same run scored twice over, one category perfect and one always off.
    const rows = [
      ...compareRun(makeGold({ [nailed]: 4, [missed]: 2 }), makeReport({ [nailed]: 4, [missed]: 5 })),
      ...compareRun(makeGold({ [nailed]: 2, [missed]: 1 }), makeReport({ [nailed]: 2, [missed]: 4 })),
    ];

    const byCategory = agreementByCategory(rows);

    expect(byCategory.get(nailed)).toMatchObject({ n: 2, exact: 2, exactRate: 1 });
    expect(byCategory.get(missed)).toMatchObject({ n: 2, exact: 0, within1: 0 });
  });

  it("preserves rubric order", () => {
    const rows = compareRun(makeGold({}), makeReport({}));
    expect([...agreementByCategory(rows).keys()]).toEqual(CATEGORY_IDS);
  });

  it("returns an empty map for no rows", () => {
    expect(agreementByCategory([]).size).toBe(0);
  });
});
