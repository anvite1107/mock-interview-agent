import { describe, it, expect } from "vitest";
import {
  checkProblemIntroAdvance,
  checkCodingAdvance,
  checkTestingDebuggingMechanicalAdvance,
} from "../../../src/engine/advance/mechanicalAdvance.ts";
import type { TestCaseResult } from "../../../src/engine/evidence.ts";

function coreResult(passed: boolean): TestCaseResult {
  return { testCaseId: `core-${Math.random()}`, tag: "core", passed };
}
function edgeResult(passed: boolean): TestCaseResult {
  return { testCaseId: `edge-${Math.random()}`, tag: "edge", passed };
}

describe("checkProblemIntroAdvance", () => {
  it("advances when the candidate sent a message", () => {
    expect(checkProblemIntroAdvance(true)).toBe(true);
  });

  it("does not advance when the candidate sent no message", () => {
    expect(checkProblemIntroAdvance(false)).toBe(false);
  });
});

describe("checkCodingAdvance", () => {
  it("advances when this turn has execution results", () => {
    expect(checkCodingAdvance([coreResult(false)])).toBe(true);
  });

  it("does not advance when executionResults is undefined", () => {
    expect(checkCodingAdvance(undefined)).toBe(false);
  });

  it("does not advance when executionResults is an empty array", () => {
    expect(checkCodingAdvance([])).toBe(false);
  });

  it("advances even if the submission failed every test (submission itself is the trigger)", () => {
    expect(checkCodingAdvance([coreResult(false), coreResult(false)])).toBe(true);
  });
});

describe("checkTestingDebuggingMechanicalAdvance", () => {
  it("returns false when executionResults is undefined", () => {
    expect(checkTestingDebuggingMechanicalAdvance(undefined)).toBe(false);
  });

  it("returns false when executionResults is empty", () => {
    expect(checkTestingDebuggingMechanicalAdvance([])).toBe(false);
  });

  it("returns true when all core tests passed", () => {
    const results = [coreResult(true), coreResult(true), edgeResult(false)];
    expect(checkTestingDebuggingMechanicalAdvance(results)).toBe(true);
  });

  it("returns false when any core test failed", () => {
    const results = [coreResult(true), coreResult(false)];
    expect(checkTestingDebuggingMechanicalAdvance(results)).toBe(false);
  });

  it("ignores edge-tagged results entirely — passing edge cases don't compensate for a failing core case", () => {
    const results = [coreResult(false), edgeResult(true), edgeResult(true)];
    expect(checkTestingDebuggingMechanicalAdvance(results)).toBe(false);
  });

  it("returns false (falls through to judge) when there are no core-tagged results at all", () => {
    const results = [edgeResult(true), edgeResult(true)];
    expect(checkTestingDebuggingMechanicalAdvance(results)).toBe(false);
  });
});