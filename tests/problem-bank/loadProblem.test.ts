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
});