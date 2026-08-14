// decision policy, probe caps
import { SessionState, InterviewState, TransitionReason, INTERVIEW_STATES } from "./states.ts";
import { evaluateTransition, applyTransition, recordProbe, getNextState } from "./policy.ts";
import {
  SessionEvidence,
  TranscriptEntry,
  TestCaseResult,
  createEmptyEvidence,
} from "./evidence.ts";

export interface TurnInput {
  candidateTriggeredAdvance: boolean; // caller decides this
  wasProbe: boolean;                  // caller decides this too
  speaker: TranscriptEntry["speaker"]; // who this turn's utterance is from
  text: string;                        // the utterance itself — state is derived, not supplied
  executionResults?: TestCaseResult[]; // only present on code-submission turns
}

export interface TurnResult {
  session: SessionState;
  transitioned: boolean;
  reason: TransitionReason | null;
  fromState: InterviewState;
  toState: InterviewState | null;
}

export function createSession(): SessionState {
  return {
    current: INTERVIEW_STATES[0],
    probeCountInCurrentState: 0,
    evidence: createEmptyEvidence(),
  };
}

// The single entry point the rest of the app calls, once per turn.
export function handleTurn(session: SessionState, input: TurnInput): TurnResult {
  const fromState = session.current;

  // Every turn produces a transcript entry, tagged with the state as it
  // stood at the start of this turn (before any transition below).
  const transcriptEntry: TranscriptEntry = {
    speaker: input.speaker,
    state: fromState,
    text: input.text,
  };

  const evidenceAfterTranscript: SessionEvidence = {
    ...session.evidence,
    transcript: [...session.evidence.transcript, transcriptEntry],
    executionResults: input.executionResults
      ? [...session.evidence.executionResults, ...input.executionResults]
      : session.evidence.executionResults,
  };

  let workingSession: SessionState = { ...session, evidence: evidenceAfterTranscript };

  // Record the probe first, so a probe on the turn that finally exceeds
  // the cap is reflected before we check whether the cap was exceeded.
  // Guard: if candidate action already fired this turn, don't also count
  // it as a probe — those are mutually exclusive readings of the same turn.
  if (input.wasProbe && !input.candidateTriggeredAdvance) {
    workingSession = recordProbe(workingSession);
  }

  const decision = evaluateTransition(workingSession, input.candidateTriggeredAdvance);

  if (decision.shouldAdvance) {
    let nextSession = applyTransition(workingSession, decision);

    nextSession = {
      ...nextSession,
      evidence: {
        ...nextSession.evidence,
        transitionLog: [
          ...nextSession.evidence.transitionLog,
          { from: fromState, to: decision.nextState, reason: decision.reason },
        ],
      },
    };

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

// Advances the session WITHOUT recording a transcript entry.
//
// handleTurn conflates two things that are usually the same event: "someone
// said something" and "the state may now change." A probe declined at the
// cap boundary is a state change with no utterance — there is nothing to
// put in the transcript — so it can't go through handleTurn without
// fabricating a turn that never happened.
//
// Transition logging stays here rather than in policy.ts or the caller,
// matching handleTurn above: policy.ts decides, stateMachine.ts records.
// No-ops (transitioned: false) if already terminal.
export function forceAdvance(
  session: SessionState,
  reason: TransitionReason
): TurnResult {
  const fromState = session.current;
  const nextState = getNextState(fromState);

  if (nextState === null) {
    return { session, transitioned: false, reason: null, fromState, toState: null };
  }

  const advanced = applyTransition(session, {
    shouldAdvance: true,
    reason,
    nextState,
  });

  return {
    session: {
      ...advanced,
      evidence: {
        ...advanced.evidence,
        transitionLog: [
          ...advanced.evidence.transitionLog,
          { from: fromState, to: nextState, reason },
        ],
      },
    },
    transitioned: true,
    reason,
    fromState,
    toState: nextState,
  };
}

export function isTerminal(session: SessionState): boolean {
  return session.current === INTERVIEW_STATES[INTERVIEW_STATES.length - 1];
}