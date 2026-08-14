// src/engine/handleProbeTurn.ts
//
// Async wrapper around handleTurn, scoped to agent-initiated probe turns —
// the counterpart to handleCandidateTurn.ts. Same reason that wrapper
// exists: something has to be computed asynchronously before handleTurn
// can run. There it was the candidateTriggeredAdvance boolean; here it's
// the probe text itself, which IS the turn's utterance.
//
// Probe turns never set candidateTriggeredAdvance — only candidate actions
// can trigger a natural advance (see policy.ts). The only way a probe turn
// moves the state is the probe cap.
//
// CAP TIMING: this declines to probe on the turn that would reach the cap,
// and force-advances instead. handleTurn's own ordering (recordProbe before
// the cap check, stateMachine.ts) would otherwise ask a question and
// transition out of the state in the same turn — the candidate's answer to
// that question would then land in the transcript tagged with the NEXT
// state, smearing state attribution in the gold-labeled eval transcripts.
// Consequence: a capped state yields cap - 1 answerable probes, not cap.
// handleTurn and policy.ts are unchanged; this timing lives entirely here.

import type { SessionState } from "./states.ts";
import { PROBE_CAPS } from "./states.ts";
import { handleTurn, forceAdvance, TurnResult } from "./stateMachine.ts";
import type { TranscriptEntry } from "./evidence.ts";
import type { Problem } from "../../problem-bank/schema.ts";
import { generateProbe } from "./probe/generateProbe.ts";
import type { ProbeResponse } from "./probe/schema.ts";

export interface ProbeTurnInput {
  problem: Problem;
}

/**
 * Discriminated rather than a bare TurnResult because the caller has to
 * know whether there is anything to say to the candidate. On
 * "advanced-without-probe" no utterance was produced and none should be
 * displayed — the session simply moved on.
 */
export type ProbeTurnOutcome =
  | { kind: "probed"; result: TurnResult; probe: ProbeResponse }
  | { kind: "advanced-without-probe"; result: TurnResult };

/**
 * Prior entries from the current state only.
 *
 * Filters by `entry.state === session.current` rather than by turn
 * boundary. Correct because INTERVIEW_STATES only walks forward and each
 * state is visited exactly once per session — the same assumption
 * handleCandidateTurn.ts's buildInStateTranscript relies on, and equally
 * unenforced by anything in the type system.
 *
 * No synthetic current-turn entry to append here, unlike the candidate
 * wrapper: the probe IS this turn's utterance and doesn't exist yet.
 */
function getInStateTranscript(session: SessionState): TranscriptEntry[] {
  return session.evidence.transcript.filter(
    (entry) => entry.state === session.current
  );
}

export async function handleProbeTurn(
  session: SessionState,
  input: ProbeTurnInput
): Promise<ProbeTurnOutcome> {
  const cap = PROBE_CAPS[session.current];

  // `+ 1` is the probe we are about to ask. If recording it would reach
  // the cap, skip it — the candidate would never get to answer.
  const probeWouldReachCap =
    cap !== undefined && session.probeCountInCurrentState + 1 >= cap;

  if (probeWouldReachCap) {
    return {
      kind: "advanced-without-probe",
      result: forceAdvance(session, "probe-cap-exceeded"),
    };
  }

  // Throws on failure by design — see generateProbe's fail-fast note.
  // Nothing is mutated before this point, so a throw leaves the session
  // exactly as it was.
  const probe = await generateProbe(
    session.current,
    getInStateTranscript(session),
    input.problem
  );

  const result = handleTurn(session, {
    candidateTriggeredAdvance: false, // only candidate actions advance naturally
    wasProbe: true,
    speaker: "interviewer",
    text: probe.probe, // rationale stays out of the transcript
  });

  return { kind: "probed", result, probe };
}
