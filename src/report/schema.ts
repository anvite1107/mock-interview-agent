// src/report/schema.ts
//
// The session report shape — the end-of-session artifact produced from an
// AggregatedResult plus the session's own evidence.
//
// This is OUTPUT, so validating it on the way out would normally be
// pointless. The schema exists because the report is also INPUT later:
// the eval harness (agent-vs-gold agreement scoring) reads these files
// back off disk, and a validated parse there beats trusting a JSON blob
// whose producer may have drifted. `schemaVersion` is what lets that
// harness notice drift instead of silently mis-scoring.

import { z } from "zod";
import { INTERVIEW_STATES } from "../engine/states.ts";
import type { TranscriptEntry, TestCaseResult, TransitionLogEntry } from "../engine/evidence.ts";

/** Bump when a change would break a previously-written report file.
 *  Additive optional fields don't need a bump; renames and removals do. */
export const REPORT_SCHEMA_VERSION = 1;

const InterviewStateSchema = z.enum(INTERVIEW_STATES);

// ─── Mirrors of evidence.ts ───────────────────────────────
// evidence.ts declares these as plain TS interfaces with no zod
// counterpart, so there's nothing to reuse — they're re-declared here.
// The Exact<> guards below make drift between the two a compile error
// rather than a runtime surprise in the eval harness.
const TranscriptEntrySchema = z.object({
  speaker: z.enum(["interviewer", "candidate"]),
  state: InterviewStateSchema,
  text: z.string(),
});

const TestCaseResultSchema = z.object({
  testCaseId: z.string(),
  tag: z.enum(["core", "edge"]),
  passed: z.boolean(),
});

const TransitionLogEntrySchema = z.object({
  from: InterviewStateSchema,
  to: InterviewStateSchema,
  reason: z.enum(["candidate-action", "probe-cap-exceeded"]),
});

type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

// These are type-level assertions only — they exist to fail `tsc`, and
// have no runtime meaning beyond three unused booleans.
const _transcriptEntryInSync: Exact<z.infer<typeof TranscriptEntrySchema>, TranscriptEntry> = true;
const _testCaseResultInSync: Exact<z.infer<typeof TestCaseResultSchema>, TestCaseResult> = true;
const _transitionLogInSync: Exact<z.infer<typeof TransitionLogEntrySchema>, TransitionLogEntry> = true;
void _transcriptEntryInSync, _testCaseResultInSync, _transitionLogInSync;

// ─── Report pieces ────────────────────────────────────────

/** A scored category, denormalized with its rubric label and weight so a
 *  report file is self-describing — readable without also loading the
 *  rubric config that produced it. */
const ReportCategoryScoreSchema = z.object({
  categoryId: z.string(),
  label: z.string(),
  weight: z.number(),
  score: z.number().int().min(1).max(5),
  justification: z.string(),
  /** "ground-truth-override" means execution results capped the judge's
   *  score — see aggregator.ts. Surfaced rather than buried because it's
   *  the most load-bearing thing the scoring pipeline does. */
  source: z.enum(["judge", "ground-truth-override"]),
});

const ExecutionTallySchema = z.object({
  passed: z.number().int().min(0),
  total: z.number().int().min(0),
});

export const SessionReportSchema = z.object({
  schemaVersion: z.literal(REPORT_SCHEMA_VERSION),
  generatedAt: z.string(),

  problem: z.object({
    id: z.string(),
    title: z.string(),
    difficulty: z.enum(["easy", "medium", "hard"]),
    referenceComplexity: z.object({ time: z.string(), space: z.string() }),
  }),

  scores: z.object({
    /** 0-100, weighted across categories. Carried at full precision —
     *  rounding is a presentation decision, left to consumers. */
    weightedTotal: z.number(),
    categories: z.array(ReportCategoryScoreSchema),
    /** Convenience projection of categories[].source — saves every
     *  consumer re-deriving the same filter. */
    overriddenCategoryIds: z.array(z.string()),
  }),

  execution: z.object({
    core: ExecutionTallySchema,
    edge: ExecutionTallySchema,
    results: z.array(TestCaseResultSchema),
  }),

  flow: z.object({
    finalState: InterviewStateSchema,
    /** Whether the session actually reached the terminal state, as
     *  opposed to being abandoned partway. */
    completed: z.boolean(),
    statesReached: z.array(InterviewStateSchema),
    /** How many transitions were probe-cap forced rather than earned by a
     *  candidate action — a blunt "did this interview flow naturally"
     *  signal for eval. */
    forcedAdvanceCount: z.number().int().min(0),
    transitions: z.array(TransitionLogEntrySchema),
  }),

  transcript: z.array(TranscriptEntrySchema),
});

export type ReportCategoryScore = z.infer<typeof ReportCategoryScoreSchema>;
export type SessionReport = z.infer<typeof SessionReportSchema>;
