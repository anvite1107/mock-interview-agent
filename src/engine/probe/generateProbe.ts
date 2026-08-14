// Generates the interviewer's next question when a candidate turn didn't
// trigger an advance and the state needs to keep moving.
//
// Separate LLM call from advance-detection by design — "is the candidate
// done with this stage?" and "what should I ask them next?" are different
// questions, and folding them together would let a probe's phrasing leak
// into the advance verdict.
//
// FAIL-FAST (deliberate divergence from judgeAdvance.ts, which fail-safes).
// judgeAdvance can default to `advance: false` because a wrong-but-safe
// default is still a valid session state. There is no safe default probe:
// any fallback text would be a synthetic interviewer utterance that lands
// in the transcript and, later, in the Day 17-18 gold-labeled eval corpus,
// where it reads as real agent behavior rather than as an artifact of an
// API failure. Corrupting the eval corpus is worse than ending the session
// loudly, so this throws.
//
// CONTEXT SCOPE: in-state transcript + problem statement + constraints.
// The rubric is deliberately NOT passed. A generator that can see the
// rubric anchors writes leading probes ("did you consider the empty-array
// case?"), handing the candidate the exact evidence the rubric is trying
// to measure — which inflates scores in precisely the categories the
// agent-vs-gold agreement metric compares. The probe has to stay a neutral
// prompt, not a hint.

import type { InterviewState } from "../states.ts";
import type { TranscriptEntry } from "../evidence.ts";
import type { Problem } from "../../../problem-bank/schema.ts";
import { ProbeResponseSchema, type ProbeResponse } from "./schema.ts";
import { callGemini, stripJsonFences } from "../../evaluation/judged/scorer.ts";

// Only the states that can actually stall. problem-intro advances on any
// candidate message, so a probe there is unreachable; wrap-up is terminal.
// Narrowed key union rather than Record<InterviewState, string> so probing
// a non-probeable state is a compile error, same guard style as
// advance/judgeAdvance.ts's READINESS_DESCRIPTIONS.
const PROBE_INTENTS: Record<
  "clarifying-questions" | "coding" | "testing-debugging" | "complexity-discussion",
  string
> = {
  "clarifying-questions":
    "The candidate has not yet signaled they are ready to start coding. " +
    "Ask about an aspect of the problem they have not yet clarified — " +
    "input format, a constraint, or expected behavior on an unusual " +
    "input. Do not suggest an algorithm or hint at a solution approach.",
  "coding":
    "The candidate has not submitted any code yet. Ask them to narrate " +
    "where they are in their implementation or what they are currently " +
    "working through. Do not suggest an algorithm, hint at a solution, or " +
    "comment on whether their approach is correct.",
  "testing-debugging":
    "The candidate's submission still has failing test cases. Prompt them " +
    "to reason about what might be going wrong. Do not name the bug, " +
    "identify which input fails, or describe the fix.",
  "complexity-discussion":
    "The candidate has not yet stated the time and space complexity of " +
    "their solution. Prompt them to analyze it. Do not state, confirm, or " +
    "hint at the answer.",
};

export type ProbeableState = keyof typeof PROBE_INTENTS;

export function isProbeableState(state: InterviewState): state is ProbeableState {
  return state in PROBE_INTENTS;
}

function formatTranscript(entries: TranscriptEntry[]): string {
  return entries.map((e) => `${e.speaker.toUpperCase()}: ${e.text}`).join("\n");
}

function buildProbeSystemPrompt(state: ProbeableState): string {
  return [
    "You are a technical interviewer conducting a mock coding interview.",
    "The candidate has not yet done what this stage of the interview needs",
    "them to do, so you need to ask them one follow-up question to keep",
    "the interview moving.",
    "",
    `Your goal in this stage: ${PROBE_INTENTS[state]}`,
    "",
    "Rules:",
    "- Ask exactly ONE question. Not two, not a question with sub-parts.",
    "- Keep it to a sentence or two, in a natural spoken register.",
    "- Never reveal, hint at, or evaluate the correctness of a solution.",
    "- Do not restate the problem back to the candidate.",
    "- Do not repeat a question already asked in the transcript below.",
    "",
    "First write a short 'rationale' explaining what you are trying to get",
    "the candidate to demonstrate. Only then write the 'probe' — the exact",
    "words you will say to the candidate. The rationale is internal and is",
    "never shown to the candidate.",
    "",
    "Respond ONLY with JSON matching this shape, no markdown fences:",
    '{ "rationale": string, "probe": string }',
  ].join("\n");
}

function buildProbeUserMessage(
  inStateTranscript: TranscriptEntry[],
  problem: Problem
): string {
  const constraintsList = problem.constraints.map((c, i) => `${i + 1}. ${c}`).join("\n");

  // An empty in-state transcript is legitimate: the agent can be the first
  // to speak in a state it just transitioned into.
  const transcriptSection =
    inStateTranscript.length > 0
      ? formatTranscript(inStateTranscript)
      : "(nothing said yet in this stage)";

  return [
    "PROBLEM STATEMENT (as given to the candidate):",
    problem.prompt,
    "",
    "STATED CONSTRAINTS:",
    constraintsList,
    "",
    "CONVERSATION SO FAR IN THIS STAGE:",
    transcriptSection,
    "",
    "Write your next question to the candidate.",
  ].join("\n");
}

/**
 * Throws on any failure — non-probeable state, API error, malformed JSON,
 * or schema-invalid output. See the fail-fast note at the top of this file.
 */
export async function generateProbe(
  state: InterviewState,
  inStateTranscript: TranscriptEntry[],
  problem: Problem
): Promise<ProbeResponse> {
  if (!isProbeableState(state)) {
    throw new Error(
      `generateProbe called for state "${state}", which has no probe intent. ` +
        `problem-intro advances on any candidate message and wrap-up is ` +
        `terminal, so neither can stall — this indicates a caller bug.`
    );
  }

  const systemPrompt = buildProbeSystemPrompt(state);
  const userMessage = buildProbeUserMessage(inStateTranscript, problem);

  const rawResponse = await callGemini(systemPrompt, userMessage);
  const cleaned = stripJsonFences(rawResponse);

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(
      `Failed to parse JSON from probe-generation response: ${err}\n\nRaw response:\n${rawResponse}`
    );
  }

  const result = ProbeResponseSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Probe response failed schema validation: ${JSON.stringify(result.error.issues, null, 2)}`
    );
  }

  return result.data;
}
