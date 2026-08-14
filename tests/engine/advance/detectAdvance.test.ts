import { describe, it, expect } from "vitest";
import { detectMechanicalAdvance } from "../../../src/engine/advance/detectAdvance.ts";
import type { TestCaseResult } from "../../../src/engine/evidence.ts";

const CORE_PASS: TestCaseResult[] = [
  { testCaseId: "core-1", tag: "core", passed: true },
];
const CORE_FAIL: TestCaseResult[] = [
  { testCaseId: "core-1", tag: "core", passed: false },
];

describe("detectMechanicalAdvance", () => {
  it("problem-intro: resolves true/advance based on candidateSentMessage", () => {
    expect(
      detectMechanicalAdvance("problem-intro", {
        candidateSentMessage: true,
        executionResults: undefined,
      })
    ).toEqual({ resolved: true, advance: true });

    expect(
      detectMechanicalAdvance("problem-intro", {
        candidateSentMessage: false,
        executionResults: undefined,
      })
    ).toEqual({ resolved: true, advance: false });
  });

  it("coding: resolves true/advance when a submission occurred this turn", () => {
    expect(
      detectMechanicalAdvance("coding", {
        candidateSentMessage: true,
        executionResults: CORE_FAIL, // fails don't matter for coding->testing-debugging
      })
    ).toEqual({ resolved: true, advance: true });

    expect(
      detectMechanicalAdvance("coding", {
        candidateSentMessage: true,
        executionResults: undefined,
      })
    ).toEqual({ resolved: true, advance: false });
  });

  it("testing-debugging: resolves true/advance:true when all core tests passed", () => {
    expect(
      detectMechanicalAdvance("testing-debugging", {
        candidateSentMessage: true,
        executionResults: CORE_PASS,
      })
    ).toEqual({ resolved: true, advance: true });
  });

  it("testing-debugging: resolves false (needs judge) when core tests failed", () => {
    expect(
      detectMechanicalAdvance("testing-debugging", {
        candidateSentMessage: true,
        executionResults: CORE_FAIL,
      })
    ).toEqual({ resolved: false });
  });

  it("testing-debugging: resolves false (needs judge) when no execution results this turn", () => {
    expect(
      detectMechanicalAdvance("testing-debugging", {
        candidateSentMessage: true,
        executionResults: undefined,
      })
    ).toEqual({ resolved: false });
  });

  it("clarifying-questions: always resolves false — no mechanical signal exists", () => {
    expect(
      detectMechanicalAdvance("clarifying-questions", {
        candidateSentMessage: true,
        executionResults: undefined,
      })
    ).toEqual({ resolved: false });
  });

  it("complexity-discussion: always resolves false — no mechanical signal exists", () => {
    expect(
      detectMechanicalAdvance("complexity-discussion", {
        candidateSentMessage: true,
        executionResults: undefined,
      })
    ).toEqual({ resolved: false });
  });

  it("wrap-up: resolves true/advance:false — terminal state", () => {
    expect(
      detectMechanicalAdvance("wrap-up", {
        candidateSentMessage: true,
        executionResults: undefined,
      })
    ).toEqual({ resolved: true, advance: false });
  });
});