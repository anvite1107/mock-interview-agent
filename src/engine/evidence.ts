import type { InterviewState, TransitionReason } from "./states.ts";

/** A single turn's transcript entry. No redundant metadata —
 *  handleTurn already tracks wasProbe/candidateTriggeredAdvance separately. */
export interface TranscriptEntry {
  speaker: "interviewer" | "candidate";
  state: InterviewState;
  text: string;
}

/** Result of running one test case against a candidate's submission.
 *  Pass rate is computed at scoring time, not stored here. */
export interface TestCaseResult {
  testCaseId: string;
  tag: "core" | "edge";
  passed: boolean;
}

/** One recorded state transition, for eval-harness visibility into
 *  how the session moved through the interview flow. */
export interface TransitionLogEntry {
  from: InterviewState;
  to: InterviewState;
  reason: TransitionReason;
}

/** Accumulated evidence for a session, threaded forward turn-by-turn
 *  by the caller. Lives as a required field on SessionState — never
 *  optional/undefined, so createSession initializes all three arrays
 *  empty rather than leaving evidence unset. */
export interface SessionEvidence {
  transcript: TranscriptEntry[];
  executionResults: TestCaseResult[];
  transitionLog: TransitionLogEntry[];
}

export function createEmptyEvidence(): SessionEvidence {
  return {
    transcript: [],
    executionResults: [],
    transitionLog: [],
  };
}