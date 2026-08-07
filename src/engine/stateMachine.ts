// decision policy, probe caps
import { SessionState, InterviewState, TransitionReason, INTERVIEW_STATES } from "./states.ts";
import { evaluateTransition, applyTransition, recordProbe } from "./policy.ts";

export interface TurnInput {
  candidateTriggeredAdvance: boolean; // caller decides this
  wasProbe: boolean;                  // caller decides this too
}

export interface TurnResult {
  session: SessionState;
  transitioned: boolean;
  reason: TransitionReason | null;
  fromState: InterviewState;
  toState: InterviewState | null;
}

export function createSession(): SessionState {
  return { current: INTERVIEW_STATES[0], probeCountInCurrentState: 0 };
}

// The single entry point the rest of the app calls, once per turn.
export function handleTurn(session: SessionState, input: TurnInput): TurnResult {
  const fromState = session.current;
  let workingSession = session;

  // Record the probe first, so a probe on the turn that finally exceeds
  // the cap is reflected before we check whether the cap was exceeded.
  // Guard: if candidate action already fired this turn, don't also count
  // it as a probe — those are mutually exclusive readings of the same turn.
  if (input.wasProbe && !input.candidateTriggeredAdvance) {
    workingSession = recordProbe(workingSession);
  }

  const decision = evaluateTransition(workingSession, input.candidateTriggeredAdvance);

  if (decision.shouldAdvance) {
    const nextSession = applyTransition(workingSession, decision);
    return {
      session: nextSession,
      transitioned: true,
      reason: decision.reason,
      fromState,
      toState: decision.nextState,
    };
  }

  return { session: workingSession, transitioned: false, reason: null, fromState, toState: null };
}

export function isTerminal(session: SessionState): boolean {
  return session.current === INTERVIEW_STATES[INTERVIEW_STATES.length - 1];
}