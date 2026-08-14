// src/engine/handleCandidateTurn.ts
//
// Async wrapper around handleTurn, scoped to candidate turns only.
// handleTurn itself stays synchronous and unchanged — it still takes
// candidateTriggeredAdvance as a caller-supplied boolean, exactly as
// policy.ts's original design intended ("caller decides this"). This
// file IS that caller, for the candidate-turn case specifically.
//
// Agent/probe turns do NOT go through this wrapper — they call
// handleTurn directly with candidateTriggeredAdvance: false, since only
// candidate actions can trigger an advance (see policy.ts comments).
//
// Sequence per candidate turn:
//   1. detectMechanicalAdvance() — synchronous, no API call
//   2. if resolved: false, await detectJudgedAdvance() — one Gemini call
//   3. call handleTurn() synchronously with the resolved boolean
//
// Inline-await is intentional (confirmed) — the turn's outcome
// (transitioned or not) is needed before the agent can decide what to
// say next, so there's no meaningful way to respond to the candidate
// before this resolves anyway.

import type { SessionState } from "./states.ts";
import { handleTurn, TurnResult } from "./stateMachine.ts";
import type { TestCaseResult, TranscriptEntry } from "./evidence.ts";
import { detectMechanicalAdvance } from "./advance/detectAdvance.ts";
import { detectJudgedAdvance } from "./advance/judgeAdvance.ts";

export interface CandidateTurnInput {
  text: string;
  executionResults?: TestCaseResult[]; // this turn's submission results only, if any
}

/**
 * Builds the in-state transcript for the judge call: prior entries from
 * this state, plus a synthetic entry for the current turn (which hasn't
 * been appended to session.evidence yet — handleTurn does that).
 */
function buildInStateTranscript(
  session: SessionState,
  currentTurnText: string
): TranscriptEntry[] {
  const priorEntriesThisState = session.evidence.transcript.filter(
    (entry) => entry.state === session.current
  );

  const currentEntry: TranscriptEntry = {
    speaker: "candidate",
    state: session.current,
    text: currentTurnText,
  };

  return [...priorEntriesThisState, currentEntry];
}

export async function handleCandidateTurn(
  session: SessionState,
  input: CandidateTurnInput
): Promise<TurnResult> {
  const mechanicalResult = detectMechanicalAdvance(session.current, {
    candidateSentMessage: true, // this function is only ever called with a candidate message
    executionResults: input.executionResults,
  });

  const candidateTriggeredAdvance = mechanicalResult.resolved
    ? mechanicalResult.advance
    : await detectJudgedAdvance(
        session.current,
        buildInStateTranscript(session, input.text)
      );

  // TurnInput.executionResults is `X?` (omit-only) under
  // exactOptionalPropertyTypes — explicitly assigning `undefined` to an
  // optional field is a type error, so the key must be left out entirely
  // when there's no value, not set to undefined.
  return handleTurn(session, {
    candidateTriggeredAdvance,
    wasProbe: false, // candidate turns are never probes — probes are agent-initiated
    speaker: "candidate",
    text: input.text,
    ...(input.executionResults !== undefined
      ? { executionResults: input.executionResults }
      : {}),
  });
}