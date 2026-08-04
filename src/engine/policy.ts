// transition rules
// src/engine/policy.ts
import { InterviewState, INTERVIEW_STATES, PROBE_CAPS, SessionState, TransitionReason } from "./states.js";

export interface ProbeDecision {
  shouldAdvance: boolean;
  reason: TransitionReason | null;
  nextState: InterviewState | null;
}

// Looks up the state that comes after `current` in the fixed sequence.
// Returns null if `current` is the terminal state (wrap-up).
function getNextState(current: InterviewState): InterviewState | null {
  const index = INTERVIEW_STATES.indexOf(current);
  const next = INTERVIEW_STATES[index + 1];
  return next ?? null;
}

// Called once per candidate turn. `candidateTriggeredAdvance` is decided
// upstream (e.g. "did they just submit code?") — this function doesn't
// know how to detect that itself, it just consumes the boolean.
export function evaluateTransition(
  session: SessionState,
  candidateTriggeredAdvance: boolean
): ProbeDecision {
  const nextState = getNextState(session.current);

  // Terminal state — nothing to advance to regardless of anything else.
  if (nextState === null) {
    return { shouldAdvance: false, reason: null, nextState: null };
  }

  // Candidate action satisfies this state's natural exit condition.
  if (candidateTriggeredAdvance) {
    return { shouldAdvance: true, reason: "candidate-action", nextState };
  }

  // No natural advance yet — check whether the probe cap forces one.
  const cap = PROBE_CAPS[session.current];
  if (cap !== undefined && session.probeCountInCurrentState >= cap) {
    return { shouldAdvance: true, reason: "probe-cap-exceeded", nextState };
  }

  return { shouldAdvance: false, reason: null, nextState: null };
}

// Called when the engine determines the agent's last turn was an
// agent-initiated follow-up (not an answer to a candidate-asked question).
export function recordProbe(session: SessionState): SessionState {
  return {
    ...session,
    probeCountInCurrentState: session.probeCountInCurrentState + 1,
  };
}

// Called after evaluateTransition returns shouldAdvance: true.
// Resets the probe count for the new state.
export function applyTransition(
  session: SessionState,
  decision: ProbeDecision
): SessionState {
  if (!decision.shouldAdvance || decision.nextState === null) {
    return session; // no-op guard, shouldn't normally be called this way
  }
  return {
    current: decision.nextState,
    probeCountInCurrentState: 0,
  };
}