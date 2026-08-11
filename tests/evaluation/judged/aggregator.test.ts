import { describe, it, expect } from "vitest";
import { loadRubric } from "../../../src/rubric/loadRubric.ts";
import { aggregateScores } from "../../../src/evaluation/aggregator.ts";
import type { ScoringResponse } from "../../../src/evaluation/judged/schema.ts";
import type { SessionEvidence, TestCaseResult } from "../../../src/engine/evidence.ts";

const rubricConfig = loadRubric();

// All six categories present with placeholder scores/justifications.
// Individual tests override the ones they care about.
function makeJudgeResponse(overrides: Record<string, number>): ScoringResponse {
  const defaults: Record<string, number> = {
    "problem-understanding": 3,
    "approach-correctness": 3,
    "complexity-analysis": 3,
    "edge-case-handling": 3,
    "code-correctness": 3,
    "communication": 3,
  };
  const scores = { ...defaults, ...overrides };
  return {
    categoryScores: Object.entries(scores).map(([categoryId, score]) => ({
      categoryId,
      score,
      justification: `stub justification for ${categoryId}`,
    })),
  };
}

function makeEvidence(executionResults: TestCaseResult[]): SessionEvidence {
  return { transcript: [], executionResults, transitionLog: [] };
}

const allCorePassed: TestCaseResult[] = [
  { testCaseId: "core-1", tag: "core", passed: true },
  { testCaseId: "core-2", tag: "core", passed: true },
];
const someCorePassed: TestCaseResult[] = [
  { testCaseId: "core-1", tag: "core", passed: true },
  { testCaseId: "core-2", tag: "core", passed: false },
];
const noCorePassed: TestCaseResult[] = [
  { testCaseId: "core-1", tag: "core", passed: false },
  { testCaseId: "core-2", tag: "core", passed: false },
];
const allEdgePassed: TestCaseResult[] = [
  { testCaseId: "edge-1", tag: "edge", passed: true },
];
const someEdgePassed: TestCaseResult[] = [
  { testCaseId: "edge-1", tag: "edge", passed: true },
  { testCaseId: "edge-2", tag: "edge", passed: false },
];

describe("aggregateScores", () => {
  it("clamps an inflated code-correctness score when only some core tests passed", () => {
    const judged = makeJudgeResponse({ "code-correctness": 5 });
    const evidence = makeEvidence(someCorePassed);
    const result = aggregateScores(judged, evidence, rubricConfig);

    const cc = result.categoryScores.find((c) => c.categoryId === "code-correctness")!;
    expect(cc.score).toBe(2);
    expect(cc.source).toBe("ground-truth-override");
  });

  it("clamps to 1 when no core tests passed, regardless of judge score", () => {
    const judged = makeJudgeResponse({ "code-correctness": 4 });
    const evidence = makeEvidence(noCorePassed);
    const result = aggregateScores(judged, evidence, rubricConfig);

    const cc = result.categoryScores.find((c) => c.categoryId === "code-correctness")!;
    expect(cc.score).toBe(1);
    expect(cc.source).toBe("ground-truth-override");
  });

  it("trusts the judge's score for code-correctness when all core tests passed", () => {
    const judged = makeJudgeResponse({ "code-correctness": 5 });
    const evidence = makeEvidence(allCorePassed);
    const result = aggregateScores(judged, evidence, rubricConfig);

    const cc = result.categoryScores.find((c) => c.categoryId === "code-correctness")!;
    expect(cc.score).toBe(5);
    expect(cc.source).toBe("judge");
  });

  it("does not override when the judge's score is already <= the ground-truth level", () => {
    const judged = makeJudgeResponse({ "code-correctness": 2 });
    const evidence = makeEvidence(someCorePassed); // gtLevel = 2
    const result = aggregateScores(judged, evidence, rubricConfig);

    const cc = result.categoryScores.find((c) => c.categoryId === "code-correctness")!;
    expect(cc.score).toBe(2);
    expect(cc.source).toBe("judge"); // judge's own honest score, not an override
  });

  it("applies the same clamp independently to edge-case-handling", () => {
    const judged = makeJudgeResponse({ "edge-case-handling": 5 });
    const evidence = makeEvidence(someEdgePassed);
    const result = aggregateScores(judged, evidence, rubricConfig);

    const ech = result.categoryScores.find((c) => c.categoryId === "edge-case-handling")!;
    expect(ech.score).toBe(2);
    expect(ech.source).toBe("ground-truth-override");
  });

  it("trusts the judge's score for edge-case-handling when all edge tests passed", () => {
    const judged = makeJudgeResponse({ "edge-case-handling": 4 });
    const evidence = makeEvidence(allEdgePassed);
    const result = aggregateScores(judged, evidence, rubricConfig);

    const ech = result.categoryScores.find((c) => c.categoryId === "edge-case-handling")!;
    expect(ech.score).toBe(4);
    expect(ech.source).toBe("judge");
  });

  it("never overrides non-execution-gated categories", () => {
    const judged = makeJudgeResponse({ "problem-understanding": 5 });
    // Deliberately pass evidence with failing tests, unrelated to this category
    const evidence = makeEvidence(noCorePassed);
    const result = aggregateScores(judged, evidence, rubricConfig);

    const pu = result.categoryScores.find((c) => c.categoryId === "problem-understanding")!;
    expect(pu.score).toBe(5);
    expect(pu.source).toBe("judge");
  });

  it("computes a weighted total consistent with rubric category weights", () => {
    // All categories scored 3/5 -> normalized (3-1)/4 = 0.5 -> weighted total = 50
    const judged = makeJudgeResponse({});
    const evidence = makeEvidence(allCorePassed.concat(allEdgePassed));
    const result = aggregateScores(judged, evidence, rubricConfig);

    expect(result.weightedTotal).toBeCloseTo(50, 5);
  });
});