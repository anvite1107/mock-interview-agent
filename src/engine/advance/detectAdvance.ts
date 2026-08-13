// Advance-detection dispatcher.
//
// Single entry point handleTurn calls once per candidate turn to figure
// out `candidateTriggeredAdvance` before calling evaluateTransition().
//
// Synchronous and mechanical-only by design. When the current state
// requires judgment (clarifying-questions, complexity-discussion, or
// testing-debugging's fallback branch), this returns { resolved: false }
// instead of guessing — the caller (handleTurn) is responsible for then
// invoking the LLM-judged branch and feeding ITS boolean into
// evaluateTransition. This file has no async/API-call dependency on
// purpose, mirroring the mechanical/judged split used throughout
// evaluation/.

import type { InterviewState } from "../states.ts";
import type { TestCaseResult } from "../evidence.ts";
import {
  checkProblemIntroAdvance,
  checkCodingAdvance,
  checkTestingDebuggingMechanicalAdvance,
} from "./mechanicalAdvance.ts";

export type MechanicalAdvanceResult =
  | { resolved: true; advance: boolean }
  | { resolved: false }; // mechanical check inconclusive — caller must invoke LLM judge branch

/**
 * Narrow, explicit inputs rather than a full TurnInput — see
 * mechanicalAdvance.ts for why. Wire real TurnInput fields in at the
 * handleTurn call site.
 */
export interface AdvanceDetectionInput {
  candidateSentMessage: boolean;
  executionResults: TestCaseResult[] | undefined;
}

export function detectMechanicalAdvance(
  state: InterviewState,
  input: AdvanceDetectionInput
): MechanicalAdvanceResult {
  switch (state) {
    case "problem-intro":
      return {
        resolved: true,
        advance: checkProblemIntroAdvance(input.candidateSentMessage),
      };

    case "coding":
      return {
        resolved: true,
        advance: checkCodingAdvance(input.executionResults),
      };

    case "testing-debugging": {
      const mechanicalAdvance = checkTestingDebuggingMechanicalAdvance(
        input.executionResults
      );
      // All core tests passed — resolved, no judge call needed.
      if (mechanicalAdvance) {
        return { resolved: true, advance: true };
      }
      // Not all core tests passed — mechanical check alone can't say
      // whether the candidate is choosing to move on anyway. Caller
      // must invoke the LLM fallback branch.
      return { resolved: false };
    }

    case "clarifying-questions":
    case "complexity-discussion":
      // Always requires judgment — no mechanical signal exists for
      // "did the candidate signal readiness" or "did they state
      // complexity."
      return { resolved: false };

    case "wrap-up":
      // Terminal state. evaluateTransition() already short-circuits on
      // null nextState regardless of this value, but return a definite
      // false rather than leaving it ambiguous.
      return { resolved: true, advance: false };
  }
}