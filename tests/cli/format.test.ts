import { describe, it, expect } from "vitest";
import {
  formatExecutionSummary,
  formatTranscriptForReview,
  formatStageBanner,
  type DisplayableResult,
} from "../../src/cli/format.ts";

describe("formatExecutionSummary", () => {
  it("tallies core and edge separately", () => {
    const results: DisplayableResult[] = [
      { testCaseId: "core-1", tag: "core", passed: true, error: null },
      { testCaseId: "core-2", tag: "core", passed: true, error: null },
      { testCaseId: "edge-1", tag: "edge", passed: false, error: { type: "wrong-output", message: "Expected [], got [0, 0]" } },
    ];
    const out = formatExecutionSummary(results);

    expect(out).toContain("core  2/2 passed");
    expect(out).toContain("edge  0/1 passed");
  });

  it("shows the harness error detail on failures", () => {
    const results: DisplayableResult[] = [
      { testCaseId: "edge-2", tag: "edge", passed: false, error: { type: "wrong-output", message: "Expected [], got [0, 0]" } },
    ];
    expect(formatExecutionSummary(results)).toContain(
      "edge-2 FAILED  wrong-output: Expected [], got [0, 0]"
    );
  });

  it("lists no per-case lines when everything passed", () => {
    const results: DisplayableResult[] = [
      { testCaseId: "core-1", tag: "core", passed: true, error: null },
    ];
    expect(formatExecutionSummary(results)).not.toContain("FAILED");
  });

  it("handles a failure with no error object attached", () => {
    // ExecutionResult uses undefined where the saved session uses null;
    // the formatter accepts both and must not print "undefined".
    const results: DisplayableResult[] = [
      { testCaseId: "core-1", tag: "core", passed: false, error: undefined },
    ];
    const out = formatExecutionSummary(results);

    expect(out).toContain("core-1 FAILED  failed");
    expect(out).not.toContain("undefined");
  });

  it("reports zeroes rather than NaN when a tag has no test cases", () => {
    const results: DisplayableResult[] = [
      { testCaseId: "core-1", tag: "core", passed: true, error: null },
    ];
    const out = formatExecutionSummary(results);

    expect(out).toContain("edge  0/0 passed");
    expect(out).not.toContain("NaN");
  });
});

describe("formatStageBanner", () => {
  it("marks a forced advance differently from an earned one", () => {
    expect(formatStageBanner("coding", true)).toContain("moving on");
    expect(formatStageBanner("coding", false)).not.toContain("moving on");
  });
});

describe("formatTranscriptForReview", () => {
  it("emits a stage header only when the stage changes", () => {
    const out = formatTranscriptForReview([
      { speaker: "interviewer", state: "problem-intro", text: "here it is" },
      { speaker: "candidate", state: "problem-intro", text: "got it" },
      { speaker: "candidate", state: "clarifying-questions", text: "can it be empty?" },
    ]);

    expect(out.match(/── Problem intro ──/g)).toHaveLength(1);
    expect(out.match(/── Clarifying questions ──/g)).toHaveLength(1);
  });

  it("indents continuation lines of a multi-line turn", () => {
    const out = formatTranscriptForReview([
      { speaker: "candidate", state: "coding", text: "(submits code)\ndef solution():" },
    ]);

    expect(out).toContain("candidate > (submits code)\n              def solution():");
  });
});
