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

/** How many times a rate-limited or transiently-failed call is retried
 *  before the error is allowed through to the caller's own fail-fast or
 *  fail-safe handling. */
const MAX_ATTEMPTS = 6;

/**
 * Requests per minute this process will allow itself.
 *
 * Defaults to the Gemini free tier's limit. Retrying after a 429 is not
 * enough on its own: a batch replay makes calls continuously, so the quota
 * is already exhausted by the time the next request goes out, and sessions
 * die on the fail-fast probe path rather than merely running slowly.
 * Pacing below the cap means the 429 path stays what it should be — a
 * backstop, not the normal flow.
 *
 * Raise it with GEMINI_MAX_RPM on a paid key; 0 disables pacing entirely.
 */
const MAX_RPM = Number.parseInt(process.env.GEMINI_MAX_RPM ?? "4", 10);
const MIN_INTERVAL_MS = MAX_RPM > 0 ? Math.ceil(60_000 / MAX_RPM) : 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Serializes every Gemini call in this process and spaces them out.
 *
 * A chained promise rather than a token bucket because the calls are
 * already sequential in practice — one interview turn at a time — and a
 * chain gives strict FIFO ordering for free. Concurrent callers queue
 * instead of bursting past the limit.
 */
let queueTail: Promise<unknown> = Promise.resolve();
let lastCallStartedAt = 0;

function paced<T>(call: () => Promise<T>): Promise<T> {
  const scheduled = queueTail.then(async () => {
    if (MIN_INTERVAL_MS > 0) {
      const waitMs = lastCallStartedAt + MIN_INTERVAL_MS - Date.now();
      if (waitMs > 0) await sleep(waitMs);
    }
    lastCallStartedAt = Date.now();
    return call();
  });

  // The tail must not reject, or one failed call poisons every queued one
  // behind it. Errors still reach the caller through `scheduled`.
  queueTail = scheduled.catch(() => undefined);
  return scheduled;
}

/**
 * How long Gemini asked us to wait, in ms, or null if it didn't say.
 *
 * A 429 body carries a RetryInfo detail with a duration string like "55s".
 * Honouring it beats guessing: the free tier's window is per-minute, so an
 * exponential backoff starting in the low hundreds of ms burns most of its
 * attempts before the quota could possibly have refilled.
 */
function parseRetryDelayMs(errorBody: string): number | null {
  const match = /"retryDelay"\s*:\s*"([0-9.]+)s"/.exec(errorBody);
  if (match === null) return null;

  const seconds = Number.parseFloat(match[1]!);
  return Number.isFinite(seconds) ? Math.ceil(seconds * 1000) : null;
}

/**
 * Retryable means "the same request might work later".
 *
 * 429 is the free tier's requests-per-minute cap, which a batch replay hits
 * constantly — 18 personas at roughly a dozen calls each is well past five
 * a minute. 5xx is a transient server fault. Everything else (a bad key, a
 * malformed request) fails identically no matter how many times it's sent,
 * so retrying it only delays the error.
 */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * One Gemini call, retried through rate limits.
 *
 * The retry sits BELOW each caller's error policy rather than replacing it:
 * generateProbe is still fail-fast and detectJudgedAdvance is still
 * fail-safe once the attempts are exhausted. This only stops a
 * requests-per-minute cap from being indistinguishable from a real failure,
 * which on the free tier is otherwise the common case rather than the rare
 * one.
 */
export async function callGemini(
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await paced(() => callGeminiOnce(systemPrompt, userMessage));
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      const retryable = err instanceof GeminiHttpError && isRetryableStatus(err.status);
      if (!retryable || attempt === MAX_ATTEMPTS) throw lastError;

      // Fall back to exponential backoff only when the API didn't say.
      const waitMs =
        (err instanceof GeminiHttpError ? parseRetryDelayMs(err.body) : null) ??
        Math.min(2 ** attempt * 1000, 60_000);

      console.warn(
        `Gemini returned ${(err as GeminiHttpError).status}; ` +
          `retrying in ${Math.round(waitMs / 1000)}s (attempt ${attempt}/${MAX_ATTEMPTS})`
      );
      await sleep(waitMs);
    }
  }

  // Unreachable: the loop either returns or throws.
  throw lastError ?? new Error("callGemini exhausted its attempts without an error");
}

/** Carries the status code and body so the retry logic can tell a rate
 *  limit apart from a bad API key without re-parsing a message string. */
class GeminiHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string
  ) {
    super(`Gemini API error ${status}: ${body}`);
    this.name = "GeminiHttpError";
  }
}

async function callGeminiOnce(
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is not set");
  }

  // Verify this is still the current model name in Google AI Studio —
  // Gemini model naming/versions shift more frequently than Anthropic's.
  //
  // Overridable because generating the eval corpus is bounded by the free
  // tier's DAILY request cap (20/day/model as of writing) rather than by
  // anything about the model's quality. Measured: gemini-3.6-flash and
  // gemini-3.7-flash carry the same 20/day allowance, so switching between
  // them buys one extra session, not a corpus — that needs billing enabled.
  const model = process.env.GEMINI_MODEL ?? "gemini-3.6-flash";

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
    throw new GeminiHttpError(response.status, await response.text());
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