// Handles the three cases mechanicalAdvance.ts / detectAdvance.ts can't
// resolve on their own: clarifying-questions, complexity-discussion, and
// testing-debugging's fallback (candidate explicitly moving on despite
// failing tests). One parameterized judge call rather than three bespoke
// ones — the state-specific part is just a plugged-in description of
// what "ready to advance" means in that state.
//
// FAIL-SAFE, not fail-fast (deliberate divergence from scorer.ts):
// scorer.ts fails fast because a bad score only affects one end-of-session
// eval run. This runs mid-session, per turn — a thrown error here would
// crash a live interview. On any failure (API error, malformed JSON,
// schema validation), this defaults to `advance: false` and logs the
// failure rather than throwing. Worst case the candidate gets one extra
// probe turn or eventually hits the probe cap; that's recoverable.
//
// Reuses callGemini from evaluation/judged/scorer.ts rather than
// duplicating the API-call plumbing (model, JSON mode, fence-stripping,
// finishReason check). If callGemini isn't currently exported from
// scorer.ts, export it there first — don't fork a second copy here.
// CONFIRM this import path/export actually exists before wiring in.

import type { InterviewState } from "../states.ts";
import type { TranscriptEntry } from "../evidence.ts";
import { AdvanceJudgeResponseSchema } from "./schema.ts";
import { callGemini, stripJsonFences } from "../../evaluation/judged/scorer.ts";

// Only the three states that actually need judgment. Typed as a
// Record over a narrowed key union (not Record<InterviewState, string>)
// so it's a compile error to accidentally call this for a mechanical
// or terminal state.
const READINESS_DESCRIPTIONS: Record<
  "clarifying-questions" | "complexity-discussion" | "testing-debugging",
  string
> = {
  "clarifying-questions":
    "the candidate has asked what they consider a sufficient number of " +
    "clarifying questions about the problem and has signaled, explicitly " +
    "or implicitly, that they are ready to begin coding a solution.",
  "complexity-discussion":
    "the candidate has stated the time and space complexity of their " +
    "solution, whether or not that statement is correct.",
  "testing-debugging":
    "the candidate has explicitly indicated they are satisfied with " +
    "their solution and want to move on, EVEN THOUGH not all test cases " +
    "passed. Do not advance just because the candidate is quiet or " +
    "still actively debugging — only advance on a clear signal they are " +
    "choosing to stop here.",
};

type JudgedAdvanceState = keyof typeof READINESS_DESCRIPTIONS;

function isJudgedAdvanceState(
  state: InterviewState
): state is JudgedAdvanceState {
  return state in READINESS_DESCRIPTIONS;
}

function formatTranscript(entries: TranscriptEntry[]): string {
  return entries
    .map((e) => `${e.speaker.toUpperCase()}: ${e.text}`)
    .join("\n");
}

function buildAdvanceSystemPrompt(state: JudgedAdvanceState): string {
  return [
    "You are judging whether a mock-interview candidate is ready to move",
    "on to the next stage of the interview.",
    "",
    `Advance to the next stage only if: ${READINESS_DESCRIPTIONS[state]}`,
    "",
    "Base your judgment only on what the candidate actually said in the",
    "transcript below — do not assume readiness that wasn't stated.",
    "",
    'Respond ONLY with JSON matching this shape, no markdown fences:',
    '{ "advance": boolean, "justification": string }',
  ].join("\n");
}

function buildUserMessage(inStateTranscript: TranscriptEntry[]): string {
  return `Transcript so far in this stage:\n\n${formatTranscript(inStateTranscript)}`;
}

/**
 * Entry point called by handleTurn when detectMechanicalAdvance() returns
 * { resolved: false }. Never throws — returns false on any failure.
 */
export async function detectJudgedAdvance(
  state: InterviewState,
  inStateTranscript: TranscriptEntry[]
): Promise<boolean> {
  if (!isJudgedAdvanceState(state)) {
    // Should never be reached if detectAdvance.ts's dispatch is correct —
    // defensive guard, not a real code path.
    console.error(
      `detectJudgedAdvance called for state "${state}", which has no ` +
        `readiness description. Defaulting to advance: false.`
    );
    return false;
  }

  try {
    const systemPrompt = buildAdvanceSystemPrompt(state);
    const userMessage = buildUserMessage(inStateTranscript);

    const rawResponse = await callGemini(systemPrompt, userMessage);
    // Strip fences before parsing, same as scoreSession. Without this a
    // fenced response would fail JSON.parse and get swallowed by the
    // fail-safe below as a silent `advance: false`.
    const parsed = JSON.parse(stripJsonFences(rawResponse));
    const validated = AdvanceJudgeResponseSchema.parse(parsed);

    return validated.advance;
  } catch (err) {
    // Fail-safe: log full context, default to false rather than
    // crashing the session or silently advancing.
    console.error(
      `detectJudgedAdvance failed for state "${state}" — defaulting to ` +
        `advance: false.`,
      err
    );
    return false;
  }
}