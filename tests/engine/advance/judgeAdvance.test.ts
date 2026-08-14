// Mocks callGemini rather than hitting the live API — proves the
// fail-safe contract (never throws, defaults to advance:false on any
// failure) deterministically, same rationale as aggregator.test.ts using
// hand-constructed inputs instead of live LLM runs.
//
// IMPORTANT: the vi.mock path below is relative to THIS file, not to
// judgedAdvance.ts. Confirm it resolves to the real scorer.ts location —
// adjust if tests/ doesn't mirror src/ 1:1 or a tsconfig path alias is
// in play.

import { describe, it, expect, vi, beforeEach } from "vitest";

// Spread the real module rather than returning a bare { callGemini }:
// judgeAdvance.ts also imports stripJsonFences from here, and a partial
// mock would leave it undefined at call time.
vi.mock("../../../src/evaluation/judged/scorer.ts", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../../src/evaluation/judged/scorer.ts")
  >();
  return { ...actual, callGemini: vi.fn() };
});

import { callGemini } from "../../../src/evaluation/judged/scorer.ts";
import { detectJudgedAdvance } from "../../../src/engine/advance/judgeAdvance.ts";
import type { TranscriptEntry } from "../../../src/engine/evidence.ts";

const mockCallGemini = vi.mocked(callGemini);

const SAMPLE_TRANSCRIPT: TranscriptEntry[] = [
  { speaker: "interviewer", state: "clarifying-questions", text: "Any questions?" },
  { speaker: "candidate", state: "clarifying-questions", text: "Nope, I'm ready to code." },
];

beforeEach(() => {
  mockCallGemini.mockReset();
});

describe("detectJudgedAdvance — happy paths", () => {
  it("returns true when the judge returns advance: true", async () => {
    mockCallGemini.mockResolvedValue(
      JSON.stringify({ advance: true, justification: "Candidate signaled readiness." })
    );

    const result = await detectJudgedAdvance("clarifying-questions", SAMPLE_TRANSCRIPT);
    expect(result).toBe(true);
  });

  it("returns false when the judge returns advance: false", async () => {
    mockCallGemini.mockResolvedValue(
      JSON.stringify({ advance: false, justification: "Candidate still asking questions." })
    );

    const result = await detectJudgedAdvance("clarifying-questions", SAMPLE_TRANSCRIPT);
    expect(result).toBe(false);
  });
});

describe("detectJudgedAdvance — fail-safe behavior", () => {
  it("returns false (does not throw) when callGemini rejects", async () => {
    mockCallGemini.mockRejectedValue(new Error("API timeout"));

    const result = await detectJudgedAdvance("complexity-discussion", SAMPLE_TRANSCRIPT);
    expect(result).toBe(false);
  });

  it("returns false (does not throw) when the response is not valid JSON", async () => {
    mockCallGemini.mockResolvedValue("not json at all {{{");

    const result = await detectJudgedAdvance("complexity-discussion", SAMPLE_TRANSCRIPT);
    expect(result).toBe(false);
  });

  it("returns false (does not throw) when the response is valid JSON but fails schema validation", async () => {
    // missing required "justification" field, "advance" wrong type
    mockCallGemini.mockResolvedValue(JSON.stringify({ advance: "yes" }));

    const result = await detectJudgedAdvance("testing-debugging", SAMPLE_TRANSCRIPT);
    expect(result).toBe(false);
  });

  it("returns false (does not throw) when justification is an empty string", async () => {
    mockCallGemini.mockResolvedValue(JSON.stringify({ advance: true, justification: "" }));

    const result = await detectJudgedAdvance("testing-debugging", SAMPLE_TRANSCRIPT);
    expect(result).toBe(false);
  });

  it("returns false without calling callGemini for a non-judged state (defensive guard)", async () => {
    // "coding" is a valid InterviewState, so this needs no ts-expect-error —
    // the guard exists precisely because the signature accepts states that
    // READINESS_DESCRIPTIONS has no entry for. Runtime path, not a type hole.
    const result = await detectJudgedAdvance("coding", SAMPLE_TRANSCRIPT);

    expect(result).toBe(false);
    expect(mockCallGemini).not.toHaveBeenCalled();
  });
});