// Mocks generateProbe (not callGemini) — this file tests the WIRING and
// the cap-timing decision, which are pure logic. generateProbe's own
// contract is covered in tests/engine/probe/generateProbe.test.ts.
//
// The behavior most worth pinning here: handleProbeTurn declines to probe
// on the turn that would reach the cap, and force-advances instead. That
// keeps every probe that IS asked answerable inside its own state, so
// transcript state-tags stay clean for gold labeling.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/engine/probe/generateProbe.ts", () => ({
  generateProbe: vi.fn(),
}));

import { generateProbe } from "../../src/engine/probe/generateProbe.ts";
import { handleProbeTurn } from "../../src/engine/handleProbeTurn.ts";
import { forceAdvance } from "../../src/engine/stateMachine.ts";
import { createEmptyEvidence } from "../../src/engine/evidence.ts";
import type { SessionState, InterviewState } from "../../src/engine/states.ts";
import { PROBE_CAPS } from "../../src/engine/states.ts";
import { loadProblems } from "../../problem-bank/loadProblems.ts";

const mockGenerateProbe = vi.mocked(generateProbe);

const TWO_SUM = loadProblems().get("two-sum")!;

const PROBE = {
  rationale: "Candidate hasn't mentioned duplicates.",
  probe: "What if the same number shows up twice?",
};

function sessionIn(state: InterviewState, probeCount = 0): SessionState {
  return {
    current: state,
    probeCountInCurrentState: probeCount,
    evidence: createEmptyEvidence(),
  };
}

/**
 * A session sitting exactly one probe below the cap — the next probe would
 * reach it, so handleProbeTurn should decline and advance instead.
 *
 * Derived from PROBE_CAPS rather than hardcoded so retuning a cap doesn't
 * silently turn these into "probes normally" tests that still pass for the
 * wrong reason.
 */
function atCapBoundary(state: InterviewState): SessionState {
  const cap = PROBE_CAPS[state];
  if (cap === undefined) {
    throw new Error(`atCapBoundary called for uncapped state "${state}"`);
  }
  return sessionIn(state, cap - 1);
}

beforeEach(() => {
  mockGenerateProbe.mockReset();
  mockGenerateProbe.mockResolvedValue(PROBE);
});

describe("handleProbeTurn — probing below the cap", () => {
  it("returns kind 'probed' with the generated probe", async () => {
    const outcome = await handleProbeTurn(sessionIn("clarifying-questions", 0), {
      problem: TWO_SUM,
    });

    expect(outcome.kind).toBe("probed");
    if (outcome.kind !== "probed") throw new Error("unreachable");
    expect(outcome.probe).toEqual(PROBE);
  });

  it("appends the probe text as an interviewer transcript entry", async () => {
    const outcome = await handleProbeTurn(sessionIn("clarifying-questions", 0), {
      problem: TWO_SUM,
    });

    const transcript = outcome.result.session.evidence.transcript;
    expect(transcript).toHaveLength(1);
    expect(transcript[0]).toEqual({
      speaker: "interviewer",
      state: "clarifying-questions",
      text: PROBE.probe,
    });
  });

  it("keeps the rationale out of the transcript", async () => {
    const outcome = await handleProbeTurn(sessionIn("clarifying-questions", 0), {
      problem: TWO_SUM,
    });

    const joined = outcome.result.session.evidence.transcript
      .map((e) => e.text)
      .join("\n");
    expect(joined).not.toContain(PROBE.rationale);
  });

  it("increments the probe count and does not transition", async () => {
    const outcome = await handleProbeTurn(sessionIn("clarifying-questions", 0), {
      problem: TWO_SUM,
    });

    expect(outcome.result.session.probeCountInCurrentState).toBe(1);
    expect(outcome.result.transitioned).toBe(false);
    expect(outcome.result.session.current).toBe("clarifying-questions");
  });

  it("passes only the current state's transcript entries to generateProbe", async () => {
    const session: SessionState = {
      current: "coding",
      probeCountInCurrentState: 0,
      evidence: {
        ...createEmptyEvidence(),
        transcript: [
          { speaker: "candidate", state: "clarifying-questions", text: "earlier stage" },
          { speaker: "interviewer", state: "coding", text: "this stage" },
        ],
      },
    };

    await handleProbeTurn(session, { problem: TWO_SUM });

    const inStateTranscript = mockGenerateProbe.mock.calls[0]![1];
    expect(inStateTranscript).toHaveLength(1);
    expect(inStateTranscript[0]!.text).toBe("this stage");
  });

  it("probes indefinitely in an uncapped state", async () => {
    // testing-debugging is deliberately uncapped (see states.ts). This test
    // documents that choice: it will keep probing rather than force-advance.
    expect(PROBE_CAPS["testing-debugging"]).toBeUndefined();

    const outcome = await handleProbeTurn(sessionIn("testing-debugging", 47), {
      problem: TWO_SUM,
    });

    expect(outcome.kind).toBe("probed");
    expect(outcome.result.transitioned).toBe(false);
  });
});

describe("handleProbeTurn — declining to probe at the cap boundary", () => {
  it("advances without probing when this probe would reach the cap", async () => {
    const outcome = await handleProbeTurn(atCapBoundary("clarifying-questions"), {
      problem: TWO_SUM,
    });

    expect(outcome.kind).toBe("advanced-without-probe");
    expect(outcome.result.transitioned).toBe(true);
    expect(outcome.result.toState).toBe("coding");
    expect(outcome.result.reason).toBe("probe-cap-exceeded");
  });

  it("does not call generateProbe when declining", async () => {
    await handleProbeTurn(atCapBoundary("clarifying-questions"), { problem: TWO_SUM });
    expect(mockGenerateProbe).not.toHaveBeenCalled();
  });

  it("adds no transcript entry when declining", async () => {
    const outcome = await handleProbeTurn(atCapBoundary("clarifying-questions"), {
      problem: TWO_SUM,
    });

    expect(outcome.result.session.evidence.transcript).toHaveLength(0);
  });

  it("logs the forced transition for eval-harness visibility", async () => {
    const outcome = await handleProbeTurn(atCapBoundary("coding"), { problem: TWO_SUM });

    expect(outcome.result.session.evidence.transitionLog).toEqual([
      { from: "coding", to: "testing-debugging", reason: "probe-cap-exceeded" },
    ]);
  });

  it("resets the probe count for the new state", async () => {
    const outcome = await handleProbeTurn(atCapBoundary("coding"), { problem: TWO_SUM });

    expect(outcome.result.session.current).toBe("testing-debugging");
    expect(outcome.result.session.probeCountInCurrentState).toBe(0);
  });

  // Walks a state from a fresh session, counting probes actually asked
  // before it advances.
  async function countProbesUntilAdvance(state: InterviewState): Promise<number> {
    let session = sessionIn(state, 0);
    let probesAsked = 0;

    while (session.current === state) {
      const outcome = await handleProbeTurn(session, { problem: TWO_SUM });
      if (outcome.kind === "probed") probesAsked++;
      session = outcome.result.session;
    }

    return probesAsked;
  }

  it("asks exactly 3 answerable probes in clarifying-questions", async () => {
    // The intended interview behavior, pinned as a concrete number rather
    // than as a formula over PROBE_CAPS — this is the thing that would be
    // wrong if someone "fixed" the off-by-one in states.ts by lowering the
    // cap back to 3.
    expect(await countProbesUntilAdvance("clarifying-questions")).toBe(3);
  });

  it("asks exactly 2 answerable probes in coding and complexity-discussion", async () => {
    expect(await countProbesUntilAdvance("coding")).toBe(2);
    expect(await countProbesUntilAdvance("complexity-discussion")).toBe(2);
  });

  it("keeps every capped state at cap - 1 answerable probes", async () => {
    for (const [state, cap] of Object.entries(PROBE_CAPS)) {
      const asked = await countProbesUntilAdvance(state as InterviewState);
      expect(asked, `state "${state}"`).toBe(cap - 1);
    }
  });
});

describe("handleProbeTurn — fail-fast propagation", () => {
  it("propagates a generateProbe throw rather than swallowing it", async () => {
    mockGenerateProbe.mockRejectedValue(new Error("Gemini API error 503"));

    await expect(
      handleProbeTurn(sessionIn("clarifying-questions", 0), { problem: TWO_SUM })
    ).rejects.toThrow("Gemini API error 503");
  });

  it("leaves the session untouched when generateProbe throws", async () => {
    mockGenerateProbe.mockRejectedValue(new Error("boom"));

    const session = sessionIn("clarifying-questions", 0);
    await expect(handleProbeTurn(session, { problem: TWO_SUM })).rejects.toThrow();

    expect(session.probeCountInCurrentState).toBe(0);
    expect(session.evidence.transcript).toHaveLength(0);
  });
});

describe("forceAdvance", () => {
  it("advances and logs without recording a transcript entry", () => {
    const result = forceAdvance(sessionIn("coding", 1), "probe-cap-exceeded");

    expect(result.transitioned).toBe(true);
    expect(result.fromState).toBe("coding");
    expect(result.toState).toBe("testing-debugging");
    expect(result.session.evidence.transcript).toHaveLength(0);
    expect(result.session.evidence.transitionLog).toHaveLength(1);
  });

  it("no-ops at the terminal state", () => {
    const result = forceAdvance(sessionIn("wrap-up", 0), "probe-cap-exceeded");

    expect(result.transitioned).toBe(false);
    expect(result.toState).toBeNull();
    expect(result.reason).toBeNull();
    expect(result.session.current).toBe("wrap-up");
    expect(result.session.evidence.transitionLog).toHaveLength(0);
  });
});
