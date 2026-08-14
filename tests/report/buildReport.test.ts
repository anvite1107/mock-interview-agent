import { describe, it, expect } from "vitest";
import { loadRubric } from "../../src/rubric/loadRubric.ts";
import { loadProblems } from "../../problem-bank/loadProblems.ts";
import { buildReport } from "../../src/report/buildReport.ts";
import { SessionReportSchema, REPORT_SCHEMA_VERSION } from "../../src/report/schema.ts";
import type { AggregatedResult } from "../../src/evaluation/aggregator.ts";
import type { SessionState } from "../../src/engine/states.ts";
import type {
  TestCaseResult,
  TranscriptEntry,
  TransitionLogEntry,
} from "../../src/engine/evidence.ts";

const rubricConfig = loadRubric();
const problem = loadProblems().get("two-sum")!;

const GENERATED_AT = "2026-08-15T12:00:00.000Z";

function makeAggregated(
  overrides: Partial<Record<string, { score: number; source: "judge" | "ground-truth-override" }>> = {}
): AggregatedResult {
  const categoryScores = rubricConfig.categories.map((c) => {
    const o = overrides[c.id];
    return {
      categoryId: c.id,
      score: o?.score ?? 3,
      justification: `stub justification for ${c.id}`,
      source: o?.source ?? ("judge" as const),
    };
  });
  return { categoryScores, weightedTotal: 50 };
}

function makeSession(partial: {
  current?: SessionState["current"];
  transcript?: TranscriptEntry[];
  executionResults?: TestCaseResult[];
  transitionLog?: TransitionLogEntry[];
}): SessionState {
  return {
    current: partial.current ?? "wrap-up",
    probeCountInCurrentState: 0,
    evidence: {
      transcript: partial.transcript ?? [],
      executionResults: partial.executionResults ?? [],
      transitionLog: partial.transitionLog ?? [],
    },
  };
}

describe("buildReport — schema conformance", () => {
  it("produces a report that validates against SessionReportSchema", () => {
    const report = buildReport(
      makeSession({}),
      makeAggregated(),
      problem,
      rubricConfig,
      { generatedAt: GENERATED_AT }
    );

    expect(() => SessionReportSchema.parse(report)).not.toThrow();
    expect(report.schemaVersion).toBe(REPORT_SCHEMA_VERSION);
    expect(report.generatedAt).toBe(GENERATED_AT);
  });

  it("defaults generatedAt to a parseable timestamp when not injected", () => {
    const report = buildReport(makeSession({}), makeAggregated(), problem, rubricConfig);
    expect(Number.isNaN(Date.parse(report.generatedAt))).toBe(false);
  });
});

describe("buildReport — category denormalization", () => {
  it("joins each score to its rubric label and weight", () => {
    const report = buildReport(
      makeSession({}),
      makeAggregated(),
      problem,
      rubricConfig,
      { generatedAt: GENERATED_AT }
    );

    for (const category of report.scores.categories) {
      const rubricCategory = rubricConfig.categories.find((c) => c.id === category.categoryId)!;
      expect(category.label).toBe(rubricCategory.label);
      expect(category.weight).toBe(rubricCategory.weight);
    }
  });

  it("throws when a score references a category absent from the rubric", () => {
    const aggregated = makeAggregated();
    aggregated.categoryScores.push({
      categoryId: "not-a-real-category",
      score: 4,
      justification: "stub",
      source: "judge",
    });

    expect(() =>
      buildReport(makeSession({}), aggregated, problem, rubricConfig)
    ).toThrow(/not in the rubric config/);
  });

  it("lists only ground-truth-overridden categories in overriddenCategoryIds", () => {
    const aggregated = makeAggregated({
      "code-correctness": { score: 2, source: "ground-truth-override" },
    });
    const report = buildReport(makeSession({}), aggregated, problem, rubricConfig, {
      generatedAt: GENERATED_AT,
    });

    expect(report.scores.overriddenCategoryIds).toEqual(["code-correctness"]);
  });
});

describe("buildReport — execution tallies", () => {
  it("counts core and edge passes separately", () => {
    const executionResults: TestCaseResult[] = [
      { testCaseId: "core-1", tag: "core", passed: true },
      { testCaseId: "core-2", tag: "core", passed: false },
      { testCaseId: "edge-1", tag: "edge", passed: true },
      { testCaseId: "edge-2", tag: "edge", passed: true },
      { testCaseId: "edge-3", tag: "edge", passed: false },
    ];
    const report = buildReport(
      makeSession({ executionResults }),
      makeAggregated(),
      problem,
      rubricConfig,
      { generatedAt: GENERATED_AT }
    );

    expect(report.execution.core).toEqual({ passed: 1, total: 2 });
    expect(report.execution.edge).toEqual({ passed: 2, total: 3 });
    expect(report.execution.results).toEqual(executionResults);
  });

  it("reports zero totals rather than failing when no code was ever run", () => {
    const report = buildReport(makeSession({}), makeAggregated(), problem, rubricConfig, {
      generatedAt: GENERATED_AT,
    });

    expect(report.execution.core).toEqual({ passed: 0, total: 0 });
    expect(report.execution.edge).toEqual({ passed: 0, total: 0 });
  });
});

describe("buildReport — flow", () => {
  const fullRun: TransitionLogEntry[] = [
    { from: "problem-intro", to: "clarifying-questions", reason: "candidate-action" },
    { from: "clarifying-questions", to: "coding", reason: "probe-cap-exceeded" },
    { from: "coding", to: "testing-debugging", reason: "candidate-action" },
    { from: "testing-debugging", to: "complexity-discussion", reason: "candidate-action" },
    { from: "complexity-discussion", to: "wrap-up", reason: "probe-cap-exceeded" },
  ];

  it("reconstructs statesReached from the transition log", () => {
    const report = buildReport(
      makeSession({ current: "wrap-up", transitionLog: fullRun }),
      makeAggregated(),
      problem,
      rubricConfig,
      { generatedAt: GENERATED_AT }
    );

    expect(report.flow.statesReached).toEqual([
      "problem-intro",
      "clarifying-questions",
      "coding",
      "testing-debugging",
      "complexity-discussion",
      "wrap-up",
    ]);
  });

  it("counts only probe-cap-exceeded transitions as forced advances", () => {
    const report = buildReport(
      makeSession({ current: "wrap-up", transitionLog: fullRun }),
      makeAggregated(),
      problem,
      rubricConfig,
      { generatedAt: GENERATED_AT }
    );

    expect(report.flow.forcedAdvanceCount).toBe(2);
    expect(report.flow.transitions).toEqual(fullRun);
  });

  it("marks completed true only in the terminal state", () => {
    const done = buildReport(
      makeSession({ current: "wrap-up" }),
      makeAggregated(),
      problem,
      rubricConfig,
      { generatedAt: GENERATED_AT }
    );
    const abandoned = buildReport(
      makeSession({ current: "coding" }),
      makeAggregated(),
      problem,
      rubricConfig,
      { generatedAt: GENERATED_AT }
    );

    expect(done.flow.completed).toBe(true);
    expect(abandoned.flow.completed).toBe(false);
  });

  it("reports the single current state when no transition ever fired", () => {
    const report = buildReport(
      makeSession({ current: "problem-intro", transitionLog: [] }),
      makeAggregated(),
      problem,
      rubricConfig,
      { generatedAt: GENERATED_AT }
    );

    expect(report.flow.statesReached).toEqual(["problem-intro"]);
    expect(report.flow.finalState).toBe("problem-intro");
    expect(report.flow.completed).toBe(false);
  });
});

describe("buildReport — transcript and problem passthrough", () => {
  it("carries the transcript through verbatim", () => {
    const transcript: TranscriptEntry[] = [
      { speaker: "interviewer", state: "problem-intro", text: "Here is the problem." },
      { speaker: "candidate", state: "problem-intro", text: "Got it." },
    ];
    const report = buildReport(
      makeSession({ transcript }),
      makeAggregated(),
      problem,
      rubricConfig,
      { generatedAt: GENERATED_AT }
    );

    expect(report.transcript).toEqual(transcript);
  });

  it("records problem identity and reference complexity", () => {
    const report = buildReport(makeSession({}), makeAggregated(), problem, rubricConfig, {
      generatedAt: GENERATED_AT,
    });

    expect(report.problem.id).toBe(problem.id);
    expect(report.problem.title).toBe(problem.title);
    expect(report.problem.difficulty).toBe(problem.difficulty);
    expect(report.problem.referenceComplexity).toEqual(problem.referenceComplexity);
  });
});
