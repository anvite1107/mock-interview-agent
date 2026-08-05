// tests/problem-bank/loadProblems.test.ts
import { describe, it, expect } from "vitest";
import { join } from "path";
import { loadProblems } from "../../problem-bank/loadProblems.js";

describe("loadProblems", () => {
  it("loads the real problems directory without throwing", () => {
    expect(() => loadProblems()).not.toThrow();
  });

  it("loads two-sum.json and returns it keyed by id", () => {
    const problems = loadProblems();
    expect(problems.has("two-sum")).toBe(true);

    const twoSum = problems.get("two-sum");
    expect(twoSum).toBeDefined();
    expect(twoSum?.title).toBe("Two Sum");
    expect(twoSum?.difficulty).toBe("easy");
  });

  it("two-sum has correct core/edge test case split", () => {
    const problems = loadProblems();
    const twoSum = problems.get("two-sum")!;

    const core = twoSum.testCases.filter(tc => tc.tag === "core");
    const edge = twoSum.testCases.filter(tc => tc.tag === "edge");

    expect(core.length).toBe(3);
    expect(edge.length).toBe(4);
    expect(twoSum.testCases.length).toBe(7);
  });

  it("all test case ids within two-sum are unique", () => {
    const problems = loadProblems();
    const twoSum = problems.get("two-sum")!;
    const ids = twoSum.testCases.map(tc => tc.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("throws with collected errors when a directory has invalid files", () => {
    const fixtureDir = join(__dirname, "fixtures", "invalid-problems");
    expect(() => loadProblems(fixtureDir)).toThrow(/failed validation/);
  });

  // tests/problem-bank/loadProblems.test.ts — additions

describe("loadProblems — full problem bank", () => {
  const EXPECTED_IDS = [
    "two-sum",
    "valid-parentheses",
    "best-time-to-buy-and-sell-stock",
    "container-with-most-water",
    "longest-substring-without-repeating-characters",
    "subarray-sum-equals-k",
    "validate-binary-search-tree",
    "number-of-islands",
    "binary-tree-level-order-traversal",
    "find-the-duplicate-number",
    "reverse-nodes-in-k-group",
  ];

  it("loads all 11 problems", () => {
    const problems = loadProblems();
    expect(problems.size).toBe(11);
  });

  it("loads every expected problem id", () => {
    const problems = loadProblems();
    for (const id of EXPECTED_IDS) {
      expect(problems.has(id)).toBe(true);
    }
  });

  it("has no unexpected extra problem ids", () => {
    const problems = loadProblems();
    const loadedIds = Array.from(problems.keys()).sort();
    expect(loadedIds).toEqual([...EXPECTED_IDS].sort());
  });

  it("every problem has at least one core and one edge test case", () => {
    const problems = loadProblems();
    for (const [id, problem] of problems) {
      const hasCore = problem.testCases.some(tc => tc.tag === "core");
      const hasEdge = problem.testCases.some(tc => tc.tag === "edge");
      expect(hasCore, `${id} missing core test case`).toBe(true);
      expect(hasEdge, `${id} missing edge test case`).toBe(true);
    }
  });

  it("every problem has 6-8 total test cases", () => {
    const problems = loadProblems();
    for (const [id, problem] of problems) {
      expect(
        problem.testCases.length,
        `${id} has ${problem.testCases.length} test cases, expected 6-8`
      ).toBeGreaterThanOrEqual(6);
      expect(problem.testCases.length).toBeLessThanOrEqual(8);
    }
  });

  it("difficulty distribution matches 3 easy / 6 medium / 2 hard", () => {
    const problems = loadProblems();
    const counts = { easy: 0, medium: 0, hard: 0 };
    for (const problem of problems.values()) {
      counts[problem.difficulty]++;
    }
    expect(counts).toEqual({ easy: 3, medium: 6, hard: 2 });
  });

  it("tree/linked-list problems declare inputStructures correctly", () => {
    const problems = loadProblems();

    const bst = problems.get("validate-binary-search-tree")!;
    expect(bst.inputStructures).toEqual(["tree"]);

    const levelOrder = problems.get("binary-tree-level-order-traversal")!;
    expect(levelOrder.inputStructures).toEqual(["tree"]);

    const reverseK = problems.get("reverse-nodes-in-k-group")!;
    expect(reverseK.inputStructures).toEqual(["linked-list", "flat"]);
    expect(reverseK.outputStructure).toBe("linked-list");
  });

  it("flat-structure problems have no inputStructures set", () => {
    const problems = loadProblems();
    const twoSum = problems.get("two-sum")!;
    expect(twoSum.inputStructures).toBeUndefined();
  });
});
});