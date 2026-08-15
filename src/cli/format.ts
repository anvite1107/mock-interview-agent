// src/cli/format.ts
//
// Terminal rendering. Pure string-building, no I/O, so the output the
// candidate and the labeler actually see is unit-testable.

import type { InterviewState } from "../engine/states.ts";
import type { Problem } from "../../problem-bank/schema.ts";

/** Structural supertype of both the harness's ExecutionResult and the
 *  saved session's ExecutionDetail. `error` covers null and undefined
 *  because those two types disagree on which absence they use, and this
 *  formatter has no reason to care. */
export interface DisplayableResult {
  testCaseId: string;
  tag: "core" | "edge";
  passed: boolean;
  error: { type: string; message: string } | null | undefined;
}

export const STAGE_LABELS: Record<InterviewState, string> = {
  "problem-intro": "Problem intro",
  "clarifying-questions": "Clarifying questions",
  coding: "Coding",
  "testing-debugging": "Testing & debugging",
  "complexity-discussion": "Complexity discussion",
  "wrap-up": "Wrap-up",
};

function tally(results: DisplayableResult[], tag: "core" | "edge") {
  const tagged = results.filter((r) => r.tag === tag);
  return { passed: tagged.filter((r) => r.passed).length, total: tagged.length };
}

/**
 * Pass counts plus a line per failure.
 *
 * Failures show the harness's own error message — for a wrong-output that
 * includes expected vs actual. Passes are not listed individually; a
 * candidate mid-debugging needs the failures to stand out, not a wall of
 * green.
 */
export function formatExecutionSummary(results: DisplayableResult[]): string {
  const core = tally(results, "core");
  const edge = tally(results, "edge");

  const lines = [
    `  core  ${core.passed}/${core.total} passed`,
    `  edge  ${edge.passed}/${edge.total} passed`,
  ];

  const failures = results.filter((r) => !r.passed);
  if (failures.length > 0) {
    lines.push("");
    for (const f of failures) {
      const detail = f.error ? `${f.error.type}: ${f.error.message}` : "failed";
      lines.push(`  ${f.testCaseId} FAILED  ${detail}`);
    }
  }

  return lines.join("\n");
}

/** The interviewer's opening turn. Also the text recorded in the
 *  transcript, so the judge and the labeler see exactly what the
 *  candidate saw. */
export function formatProblemIntro(problem: Problem): string {
  const constraints = problem.constraints.map((c) => `  - ${c}`).join("\n");

  return [
    `Let's work on: ${problem.title} (${problem.difficulty})`,
    "",
    problem.prompt,
    "",
    "Constraints:",
    constraints,
    "",
    `Write your solution as: ${problem.functionSignature}`,
    "",
    "Take a moment, and let me know if anything about the problem is unclear.",
  ].join("\n");
}

export function formatStageBanner(state: InterviewState, forced: boolean): string {
  const suffix = forced ? "  (moving on)" : "";
  return `\n── ${STAGE_LABELS[state]}${suffix} ──\n`;
}

export function formatTranscriptForReview(
  entries: Array<{ speaker: string; state: InterviewState; text: string }>
): string {
  const lines: string[] = [];
  let lastState: InterviewState | null = null;

  for (const entry of entries) {
    if (entry.state !== lastState) {
      lines.push(`\n── ${STAGE_LABELS[entry.state]} ──`);
      lastState = entry.state;
    }
    const who = entry.speaker === "candidate" ? "candidate " : "interviewer";
    // Indent continuation lines so multi-line turns stay visually attached
    // to their speaker.
    const text = entry.text.split("\n").join("\n              ");
    lines.push(`${who}> ${text}`);
  }

  return lines.join("\n");
}
