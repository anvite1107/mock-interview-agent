// src/session/schema.ts
//
// The raw record of a played interview: what was said, what was submitted,
// and how the state machine moved. Deliberately contains NO scores.
//
// That omission is the point. This file is the shared input to two things
// that must not see each other's answers — the human labeler (eval-harness
// gold labels) and the agent scorer. If a session file carried the agent's
// scores, labeling from it would anchor the human to the agent and inflate
// the very agreement metric the eval is meant to measure.

import { z } from "zod";
import { INTERVIEW_STATES } from "../engine/states.ts";

/** Bump when a change would break an already-recorded session file.
 *  These are the eval corpus — they outlive any single code change. */
export const SESSION_SCHEMA_VERSION = 1;

const InterviewStateSchema = z.enum(INTERVIEW_STATES);

const TranscriptEntrySchema = z.object({
  speaker: z.enum(["interviewer", "candidate"]),
  state: InterviewStateSchema,
  text: z.string(),
});

const TransitionLogEntrySchema = z.object({
  from: InterviewStateSchema,
  to: InterviewStateSchema,
  reason: z.enum(["candidate-action", "probe-cap-exceeded"]),
});

/** Per-test-case detail from the execution harness.
 *
 *  Wider than the engine's TestCaseResult, which keeps only
 *  {testCaseId, tag, passed}. The extra fields exist for the human
 *  labeler: "edge-2 expected [] but got [0,0]" is what makes an
 *  edge-case-handling label defensible, where a bare `false` doesn't.
 *
 *  `error` and `actualOutput` are nullable rather than optional because
 *  these round-trip through JSON, where an absent key and an explicit
 *  undefined are indistinguishable on the way back in. */
const ExecutionDetailSchema = z.object({
  testCaseId: z.string(),
  tag: z.enum(["core", "edge"]),
  passed: z.boolean(),
  actualOutput: z.unknown().nullable(),
  error: z
    .object({
      type: z.enum(["timeout", "runtime-error", "syntax-error", "wrong-output"]),
      message: z.string(),
    })
    .nullable(),
  executionTimeMs: z.number(),
});

/** One /submit: the code as it stood, and how it did.
 *
 *  Every attempt is kept, not just the last. Which attempt "counts" is a
 *  scoring decision, and baking it in here would throw away the iteration
 *  history that makes a testing-debugging label judgeable. */
const SubmissionSchema = z.object({
  /** Index into `transcript` of the turn that carried this submission,
   *  so a replay can interleave submissions with the conversation. */
  turnIndex: z.number().int().min(0),
  code: z.string(),
  results: z.array(ExecutionDetailSchema),
});

export const SavedSessionSchema = z.object({
  schemaVersion: z.literal(SESSION_SCHEMA_VERSION),
  runId: z.string(),
  problemId: z.string(),
  startedAt: z.string(),
  endedAt: z.string(),
  finalState: InterviewStateSchema,
  /** False when the session was quit early rather than reaching wrap-up.
   *  Abandoned sessions are still worth keeping — they're real behavior —
   *  but the eval harness may want to exclude them. */
  completed: z.boolean(),
  transcript: z.array(TranscriptEntrySchema),
  submissions: z.array(SubmissionSchema),
  transitionLog: z.array(TransitionLogEntrySchema),
});

export type ExecutionDetail = z.infer<typeof ExecutionDetailSchema>;
export type Submission = z.infer<typeof SubmissionSchema>;
export type SavedSession = z.infer<typeof SavedSessionSchema>;
