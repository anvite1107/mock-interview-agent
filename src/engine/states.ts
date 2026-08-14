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
// States not listed (problem-intro, testing-debugging, wrap-up) have no cap.
//
// problem-intro and wrap-up don't need one: problem-intro advances on any
// candidate message, and wrap-up is terminal. testing-debugging is
// deliberately left uncapped — a candidate whose core tests never pass and
// who never says they're moving on will stall there indefinitely. Known
// and accepted; revisit once the CLI surfaces real stall behavior.
//
// IMPORTANT: these are cap values, not probe counts. handleProbeTurn.ts
// declines to probe on the turn that would reach the cap (force-advancing
// instead), so a capped state yields cap - 1 probes the candidate actually
// gets to ANSWER. Each entry below is therefore one higher than the number
// of real probes intended:
//   clarifying-questions 4 => 3 real probes
//   coding               3 => 2 real probes
//   complexity-discussion 3 => 2 real probes
export const PROBE_CAPS: Partial<Record<InterviewState, number>> = {
  "clarifying-questions": 4,
  "coding": 3,
  "complexity-discussion": 3,
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