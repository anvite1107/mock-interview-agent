// calls Gemini, parses structured score output
import { buildSystemPrompt, buildUserMessage } from "./promptBuilder.ts";
import { buildScoringResponseSchema, type ScoringResponse } from "./schema.ts";
import type { SessionEvidence } from "../../engine/evidence.ts";
import type { RubricConfig } from "../../rubric/schema.ts";
import type { Problem } from "../../../problem-bank/schema.ts";

/** The subset of Gemini's generateContent response this module reads.
 *  Deliberately all-optional: it describes what we look for, not what the
 *  API guarantees. Missing fields are caught by explicit runtime throws
 *  in callGemini rather than by the type. */
interface GeminiGenerateContentResponse {
  candidates?: Array<{
    finishReason?: string;
    content?: { parts?: Array<{ text?: string }> };
  }>;
}

// Exported so the mid-session callers (advance-detection, probe-generation)
// reuse the same defensive strip rather than each deciding whether Gemini's
// JSON mode can be trusted to omit fences.
export function stripJsonFences(text: string): string {
  return text.replace(/```json|```/g, "").trim();
}

export async function callGemini(
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is not set");
  }

  // Verify this is still the current model name in Google AI Studio —
  // Gemini model naming/versions shift more frequently than Anthropic's.
  const model = "gemini-3.6-flash";

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: {
        parts: [{ text: systemPrompt }],
      },
      contents: [
        {
          role: "user",
          parts: [{ text: userMessage }],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.2, // low temp: consistent, anchor-grounded judging, not creative variance
      },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${errText}`);
  }

  // response.json() is typed `Promise<unknown>`, so the shape has to be
  // asserted before any field access. Every field is optional and the
  // guards below do the real validation — this only describes the subset
  // of Gemini's response we actually read, it doesn't assume it's present.
  const data = (await response.json()) as GeminiGenerateContentResponse;

  const candidate = data.candidates?.[0];
  if (!candidate) {
    throw new Error(`No candidate in Gemini response: ${JSON.stringify(data)}`);
  }

  // Gemini can return a finishReason other than "STOP" (e.g. "MAX_TOKENS",
  // "SAFETY") — surface it explicitly rather than silently returning
  // truncated/empty JSON that fails schema validation with a confusing error.
  if (candidate.finishReason && candidate.finishReason !== "STOP") {
    console.warn(`Warning: Gemini finishReason was "${candidate.finishReason}"`);
  }

  const text = candidate.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error(`No text in Gemini candidate: ${JSON.stringify(candidate)}`);
  }
  return text;
}

// ─── Public entry point ────────────────────────────────────
// Builds the prompt, calls Gemini, parses and validates the response.
// Fail-fast: throws on JSON-parse failure, schema-validation failure,
// or any Gemini API error. No retry.
export async function scoreSession(
  evidence: SessionEvidence,
  problem: Problem,
  rubricConfig: RubricConfig
): Promise<ScoringResponse> {
  const systemPrompt = buildSystemPrompt(rubricConfig);
  const userMessage = buildUserMessage(evidence, problem);

  const rawResponse = await callGemini(systemPrompt, userMessage);
  const cleaned = stripJsonFences(rawResponse);

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Failed to parse JSON from Gemini response: ${err}\n\nRaw response:\n${rawResponse}`);
  }

  const schema = buildScoringResponseSchema(rubricConfig);
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Judge response failed schema validation: ${JSON.stringify(result.error.format(), null, 2)}`);
  }

  return result.data;
}