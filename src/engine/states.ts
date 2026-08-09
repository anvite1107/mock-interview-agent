// state definitions/types
// The fixed sequence of interview states. Order matters — this list
// doubles as the "what comes next" lookup for forced/normal advances.

import type { SessionEvidence } from "./evidence.ts";

export const INTERVIEW_STATES = [
  "problem-intro",
  "clarifying-questions",
  "coding",
  "testing-debugging",
  "complexity-discussion",
  "wrap-up",
] as const;

export type InterviewState = typeof INTERVIEW_STATES[number];

// Only states that have a probe cap need an entry here.
// States not listed (problem-intro, testing-debugging, complexity-discussion, wrap-up)
// have no cap 
export const PROBE_CAPS: Partial<Record<InterviewState, number>> = {
  "clarifying-questions": 3,
  "coding": 2,
};

// Reason a transition happened — useful later for logging/eval,
// so you can see whether an interview flowed naturally or got force-advanced.
export type TransitionReason =
  | "candidate-action"
  | "probe-cap-exceeded";

export interface SessionState {
  current: InterviewState;
  probeCountInCurrentState: number;
  evidence: SessionEvidence;
}