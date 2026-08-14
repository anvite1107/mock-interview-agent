// Mocks callGemini rather than hitting the live API, same rationale as
// judgeAdvance.test.ts — the point is to pin the contract deterministically,
// not to observe one sample of nondeterministic model output.
//
// The contract under test here is the INVERSE of judgeAdvance's: probe
// generation is fail-FAST. Every malformed-output case that judgeAdvance
// swallows into `advance: false` must throw here.
//
// The problem fixture is the real two-sum.json loaded through loadProblems,
// not a hand-written literal — a hand-written Problem would silently drift
// from the schema and produce failures that look like prompt bugs.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/evaluation/judged/scorer.ts", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../../src/evaluation/judged/scorer.ts")
  >();
  return { ...actual, callGemini: vi.fn() };
});

import { callGemini } from "../../../src/evaluation/judged/scorer.ts";
import { generateProbe, isProbeableState } from "../../../src/engine/probe/generateProbe.ts";
import type { TranscriptEntry } from "../../../src/engine/evidence.ts";
import { loadProblems } from "../../../problem-bank/loadProblems.ts";

const mockCallGemini = vi.mocked(callGemini);

const TWO_SUM = loadProblems().get("two-sum")!;

const SAMPLE_TRANSCRIPT: TranscriptEntry[] = [
  { speaker: "interviewer", state: "clarifying-questions", text: "Any questions before you start?" },
  { speaker: "candidate", state: "clarifying-questions", text: "Are the numbers sorted?" },
];

const VALID_RESPONSE = JSON.stringify({
  rationale: "Candidate hasn't asked about duplicate values yet.",
  probe: "What should happen if the same number appears twice in the array?",
});

beforeEach(() => {
  mockCallGemini.mockReset();
});

describe("generateProbe — happy paths", () => {
  it("returns the validated rationale and probe", async () => {
    mockCallGemini.mockResolvedValue(VALID_RESPONSE);

    const result = await generateProbe("clarifying-questions", SAMPLE_TRANSCRIPT, TWO_SUM);

    expect(result.rationale).toBe("Candidate hasn't asked about duplicate values yet.");
    expect(result.probe).toBe(
      "What should happen if the same number appears twice in the array?"
    );
  });

  it("strips markdown fences before parsing", async () => {
    mockCallGemini.mockResolvedValue("```json\n" + VALID_RESPONSE + "\n```");

    const result = await generateProbe("coding", SAMPLE_TRANSCRIPT, TWO_SUM);
    expect(result.probe).toContain("same number appears twice");
  });

  it("handles an empty in-state transcript (agent speaks first in a new state)", async () => {
    mockCallGemini.mockResolvedValue(VALID_RESPONSE);

    await expect(generateProbe("coding", [], TWO_SUM)).resolves.toBeDefined();

    const userMessage = mockCallGemini.mock.calls[0]![1];
    expect(userMessage).toContain("(nothing said yet in this stage)");
  });
});

describe("generateProbe — prompt contents", () => {
  beforeEach(() => {
    mockCallGemini.mockResolvedValue(VALID_RESPONSE);
  });

  it("passes the problem prompt and every constraint in the user message", async () => {
    await generateProbe("clarifying-questions", SAMPLE_TRANSCRIPT, TWO_SUM);

    const userMessage = mockCallGemini.mock.calls[0]![1];
    expect(userMessage).toContain(TWO_SUM.prompt);
    for (const constraint of TWO_SUM.constraints) {
      expect(userMessage).toContain(constraint);
    }
  });

  it("includes the in-state transcript in the user message", async () => {
    await generateProbe("clarifying-questions", SAMPLE_TRANSCRIPT, TWO_SUM);

    const userMessage = mockCallGemini.mock.calls[0]![1];
    expect(userMessage).toContain("Are the numbers sorted?");
  });

  it("sends a state-specific intent in the system prompt", async () => {
    await generateProbe("complexity-discussion", SAMPLE_TRANSCRIPT, TWO_SUM);
    const complexityPrompt = mockCallGemini.mock.calls[0]![0];

    mockCallGemini.mockClear();

    await generateProbe("testing-debugging", SAMPLE_TRANSCRIPT, TWO_SUM);
    const debuggingPrompt = mockCallGemini.mock.calls[0]![0];

    expect(complexityPrompt).toContain("time and space complexity");
    expect(debuggingPrompt).toContain("failing test cases");
    expect(complexityPrompt).not.toBe(debuggingPrompt);
  });

  it("does not leak the reference complexity to the probe generator", async () => {
    // The candidate is supposed to derive this. Passing `problem` wholesale
    // would hand the model the answer it is meant to be eliciting — same
    // leading-probe hazard as passing the rubric.
    await generateProbe("complexity-discussion", SAMPLE_TRANSCRIPT, TWO_SUM);

    const [systemPrompt, userMessage] = mockCallGemini.mock.calls[0]!;
    expect(userMessage).not.toContain(TWO_SUM.referenceComplexity.time);
    expect(systemPrompt).not.toContain(TWO_SUM.referenceComplexity.time);
  });

  it("does not leak test case inputs or expected outputs", async () => {
    await generateProbe("testing-debugging", SAMPLE_TRANSCRIPT, TWO_SUM);

    const userMessage = mockCallGemini.mock.calls[0]![1];
    for (const testCase of TWO_SUM.testCases) {
      expect(userMessage).not.toContain(testCase.id);
    }
  });
});

describe("generateProbe — fail-fast behavior", () => {
  it("throws when callGemini rejects", async () => {
    mockCallGemini.mockRejectedValue(new Error("API timeout"));

    await expect(
      generateProbe("clarifying-questions", SAMPLE_TRANSCRIPT, TWO_SUM)
    ).rejects.toThrow("API timeout");
  });

  it("throws when the response is not valid JSON", async () => {
    mockCallGemini.mockResolvedValue("not json at all {{{");

    await expect(
      generateProbe("coding", SAMPLE_TRANSCRIPT, TWO_SUM)
    ).rejects.toThrow(/Failed to parse JSON/);
  });

  it("throws when the response is valid JSON but fails schema validation", async () => {
    mockCallGemini.mockResolvedValue(JSON.stringify({ rationale: "no probe field" }));

    await expect(
      generateProbe("testing-debugging", SAMPLE_TRANSCRIPT, TWO_SUM)
    ).rejects.toThrow(/failed schema validation/);
  });

  it("throws when probe is an empty string", async () => {
    mockCallGemini.mockResolvedValue(
      JSON.stringify({ rationale: "something", probe: "" })
    );

    await expect(
      generateProbe("complexity-discussion", SAMPLE_TRANSCRIPT, TWO_SUM)
    ).rejects.toThrow(/failed schema validation/);
  });

  it("throws when rationale is an empty string", async () => {
    // Enforces the justification-before-answer contract: a blank rationale
    // means the model skipped straight to the probe.
    mockCallGemini.mockResolvedValue(
      JSON.stringify({ rationale: "", probe: "What's the complexity?" })
    );

    await expect(
      generateProbe("complexity-discussion", SAMPLE_TRANSCRIPT, TWO_SUM)
    ).rejects.toThrow(/failed schema validation/);
  });
});

describe("generateProbe — non-probeable states", () => {
  it.each(["problem-intro", "wrap-up"] as const)(
    "throws for %s without calling callGemini",
    async (state) => {
      await expect(
        generateProbe(state, SAMPLE_TRANSCRIPT, TWO_SUM)
      ).rejects.toThrow(/no probe intent/);

      expect(mockCallGemini).not.toHaveBeenCalled();
    }
  );

  it("isProbeableState narrows exactly the four stallable states", () => {
    expect(isProbeableState("clarifying-questions")).toBe(true);
    expect(isProbeableState("coding")).toBe(true);
    expect(isProbeableState("testing-debugging")).toBe(true);
    expect(isProbeableState("complexity-discussion")).toBe(true);

    expect(isProbeableState("problem-intro")).toBe(false);
    expect(isProbeableState("wrap-up")).toBe(false);
  });
});
