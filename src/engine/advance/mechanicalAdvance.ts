// Mechanical (non-LLM) candidate-advance detection.
//
// These are pure functions: no session mutation, no API calls.
// Each returns a boolean meant to be passed straight into
// evaluateTransition(session, candidateTriggeredAdvance) from policy.ts.
//
// Inputs are deliberately narrow (not a full TurnInput) since TurnInput's
// exact shape wasn't available when this was written — wire the real
// fields in at the call site in handleTurn.

import type { TestCaseResult } from "../evidence.ts";

/**
 * problem-intro -> clarifying-questions
 * Pure formality: advances as soon as the candidate has sent any message
 * at all. No content check.
 */
export function checkProblemIntroAdvance(candidateSentMessage: boolean): boolean {
  return candidateSentMessage;
}

/**
 * coding -> testing-debugging
 * Advances the moment a submission was run through the harness this turn,
 * regardless of pass/fail — testing-debugging is where iterating on
 * failures happens, so coding's job is just "did they submit something."
 *
 * `executionResults` should be THIS TURN's results only (the per-turn
 * slice), not the accumulated session evidence array — see prior
 * discussion on why executionResults can't be read from session history
 * without a submission boundary marker.
 */
export function checkCodingAdvance(
  executionResults: TestCaseResult[] | undefined
): boolean {
  return executionResults !== undefined && executionResults.length > 0;
}

/**
 * testing-debugging -> complexity-discussion (mechanical branch only)
 * Advances if every `core`-tagged test in this turn's submission passed.
 * This is the FIRST branch of a two-branch check — if this returns false,
 * the caller should fall through to the LLM-judged branch (candidate may
 * still choose to move on despite failures; that's judgedAdvance's job,
 * not this file's).
 *
 * Only inspects `core`-tagged results. `edge`-tagged results are scored
 * (Code correctness (20%) is core-gated; edge-case-handling (15%) is
 * edge-gated) but are NOT a mechanical advance condition — a candidate
 * failing edge cases should still be able to explicitly move on, which is
 * exactly why the LLM fallback branch exists.
 */
export function checkTestingDebuggingMechanicalAdvance(
  executionResults: TestCaseResult[] | undefined
): boolean {
  if (executionResults === undefined || executionResults.length === 0) {
    return false;
  }

  const coreResults = executionResults.filter((r) => r.tag === "core");

  // No core-tagged results present in this submission's output — can't
  // mechanically confirm a full pass. Fall through to LLM branch rather
  // than guessing.
  if (coreResults.length === 0) {
    return false;
  }

  return coreResults.every((r) => r.passed);
}