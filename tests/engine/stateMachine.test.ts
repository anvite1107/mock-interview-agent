import { describe, it, expect } from "vitest";
import { createSession, handleTurn, isTerminal } from "../../src/engine/stateMachine.ts";
import type { SessionState } from "../../src/engine/states.ts";
import { PROBE_CAPS } from "../../src/engine/states.ts";
import { createEmptyEvidence } from "../../src/engine/evidence.ts";
import type { TestCaseResult } from "../../src/engine/evidence.ts";

describe("createSession", () => {
  it("starts at the first state with zero probes", () => {
    const session = createSession();
    expect(session.current).toBe("problem-intro");
    expect(session.probeCountInCurrentState).toBe(0);
  });

  it("starts with empty evidence", () => {
    const session = createSession();
    expect(session.evidence.transcript).toEqual([]);
    expect(session.evidence.executionResults).toEqual([]);
    expect(session.evidence.transitionLog).toEqual([]);
  });
});

describe("handleTurn — candidate-driven transition", () => {
  it("advances when candidateTriggeredAdvance is true, regardless of probe count", () => {
    const session: SessionState = {
      current: "clarifying-questions",
      probeCountInCurrentState: 1,
      evidence: createEmptyEvidence(),
    };
    const result = handleTurn(session, {
      candidateTriggeredAdvance: true,
      wasProbe: false,
      speaker: "candidate",
      text: "I think I'm ready to start coding.",
    });

    expect(result.transitioned).toBe(true);
    expect(result.reason).toBe("candidate-action");
    expect(result.fromState).toBe("clarifying-questions");
    expect(result.toState).toBe("coding");
    expect(result.session.current).toBe("coding");
    expect(result.session.probeCountInCurrentState).toBe(0); // reset on entry
  });
});

describe("handleTurn — probe below cap", () => {
  it("increments probe count but does not transition when under the cap", () => {
    const session: SessionState = {
      current: "coding",
      probeCountInCurrentState: 0,
      evidence: createEmptyEvidence(),
    }; // cap is 2
    const result = handleTurn(session, {
      candidateTriggeredAdvance: false,
      wasProbe: true,
      speaker: "interviewer",
      text: "What's the time complexity of that approach?",
    });

    expect(result.transitioned).toBe(false);
    expect(result.session.probeCountInCurrentState).toBe(1);
    expect(result.session.current).toBe("coding"); // unchanged
  });
});

describe("handleTurn — probe cap exceeded, same turn", () => {
  it("force-advances on the turn the cap is reached, not the turn after", () => {
    const session: SessionState = {
      current: "coding",
      // Derived from PROBE_CAPS, not hardcoded — this test is about
      // handleTurn's ordering (recordProbe before the cap check), not about
      // any particular cap value.
      probeCountInCurrentState: PROBE_CAPS["coding"]! - 1,
      evidence: createEmptyEvidence(),
    };
    const result = handleTurn(session, {
      candidateTriggeredAdvance: false,
      wasProbe: true,
      speaker: "interviewer",
      text: "Can you walk me through an edge case?",
    });

    expect(result.transitioned).toBe(true);
    expect(result.reason).toBe("probe-cap-exceeded");
    expect(result.toState).toBe("testing-debugging");
    expect(result.session.probeCountInCurrentState).toBe(0); // reset on entry to new state
  });
});

describe("handleTurn — states with no probe cap never force-advance", () => {
  it("stays put indefinitely in a state with no configured cap, e.g. testing-debugging", () => {
    const session: SessionState = {
      current: "testing-debugging",
      probeCountInCurrentState: 50,
      evidence: createEmptyEvidence(),
    };
    const result = handleTurn(session, {
      candidateTriggeredAdvance: false,
      wasProbe: true,
      speaker: "interviewer",
      text: "Anything else you'd want to test?",
    });

    expect(result.transitioned).toBe(false);
    expect(result.session.current).toBe("testing-debugging");
  });
});

describe("handleTurn — candidate action and probe on the same turn", () => {
  it("candidate action wins; the probe is not counted", () => {
    const session: SessionState = {
      current: "clarifying-questions",
      probeCountInCurrentState: 0,
      evidence: createEmptyEvidence(),
    };
    const result = handleTurn(session, {
      candidateTriggeredAdvance: true,
      wasProbe: true,
      speaker: "candidate",
      text: "Got it, let's start coding.",
    });

    expect(result.transitioned).toBe(true);
    expect(result.reason).toBe("candidate-action");
    // if the probe had been counted before the candidate-wins check,
    // this would still be 0 after reset either way — so this test alone
    // doesn't fully prove the skip. See the follow-up test below.
  });

  it("proves the probe was actually skipped, not just reset by the transition", () => {
    // put the session one probe below cap, so if the probe WERE counted
    // (ignoring the "candidate wins" skip), evaluateTransition would still
    // see probe-cap-exceeded and give the WRONG reason.
    const session: SessionState = {
      current: "coding",
      probeCountInCurrentState: 1,
      evidence: createEmptyEvidence(),
    }; // cap is 2
    const result = handleTurn(session, {
      candidateTriggeredAdvance: true,
      wasProbe: true,
      speaker: "candidate",
      text: "I'm done, here's my submission.",
    });

    expect(result.reason).toBe("candidate-action"); // not "probe-cap-exceeded"
  });
});

describe("isTerminal", () => {
  it("returns false for any non-final state", () => {
    expect(
      isTerminal({ current: "coding", probeCountInCurrentState: 0, evidence: createEmptyEvidence() })
    ).toBe(false);
  });

  it("returns true once the session reaches wrap-up", () => {
    expect(
      isTerminal({ current: "wrap-up", probeCountInCurrentState: 0, evidence: createEmptyEvidence() })
    ).toBe(true);
  });
});

describe("handleTurn — terminal state", () => {
  it("does not transition further once already at wrap-up", () => {
    const session: SessionState = {
      current: "wrap-up",
      probeCountInCurrentState: 0,
      evidence: createEmptyEvidence(),
    };
    const result = handleTurn(session, {
      candidateTriggeredAdvance: true,
      wasProbe: false,
      speaker: "candidate",
      text: "Thanks for the interview!",
    });

    expect(result.transitioned).toBe(false);
    expect(result.toState).toBeNull();
  });
});

describe("handleTurn — evidence: transcript", () => {
  it("appends a transcript entry tagged with the state as of the START of the turn", () => {
    const session: SessionState = {
      current: "clarifying-questions",
      probeCountInCurrentState: 0,
      evidence: createEmptyEvidence(),
    };
    const result = handleTurn(session, {
      candidateTriggeredAdvance: true, // this turn causes a transition
      wasProbe: false,
      speaker: "candidate",
      text: "I'm ready to start coding.",
    });

    expect(result.session.evidence.transcript).toHaveLength(1);
    expect(result.session.evidence.transcript[0]).toEqual({
      speaker: "candidate",
      state: "clarifying-questions", // fromState, NOT the post-transition "coding"
      text: "I'm ready to start coding.",
    });
  });

  it("does not mutate the original session's evidence array (immutability)", () => {
    const session: SessionState = {
      current: "coding",
      probeCountInCurrentState: 0,
      evidence: createEmptyEvidence(),
    };
    const originalTranscriptRef = session.evidence.transcript;

    handleTurn(session, {
      candidateTriggeredAdvance: false,
      wasProbe: false,
      speaker: "candidate",
      text: "Let me think about this.",
    });

    expect(session.evidence.transcript).toBe(originalTranscriptRef); // untouched
    expect(session.evidence.transcript).toHaveLength(0);
  });
});

describe("handleTurn — evidence: executionResults", () => {
  it("appends executionResults when the caller provides them", () => {
    const session: SessionState = {
      current: "coding",
      probeCountInCurrentState: 0,
      evidence: createEmptyEvidence(),
    };
    const results: TestCaseResult[] = [
      { testCaseId: "core-1", tag: "core", passed: true },
      { testCaseId: "edge-1", tag: "edge", passed: false },
    ];

    const result = handleTurn(session, {
      candidateTriggeredAdvance: false,
      wasProbe: false,
      speaker: "candidate",
      text: "Here's my submission.",
      executionResults: results,
    });

    expect(result.session.evidence.executionResults).toEqual(results);
  });

  it("leaves executionResults unchanged when the turn has none", () => {
    const session: SessionState = {
      current: "clarifying-questions",
      probeCountInCurrentState: 0,
      evidence: createEmptyEvidence(),
    };
    const result = handleTurn(session, {
      candidateTriggeredAdvance: false,
      wasProbe: false,
      speaker: "candidate",
      text: "What's the input range?",
    });

    expect(result.session.evidence.executionResults).toEqual([]);
  });

  it("accumulates executionResults across multiple submission turns", () => {
    let session: SessionState = {
      current: "coding",
      probeCountInCurrentState: 0,
      evidence: createEmptyEvidence(),
    };

    const first = handleTurn(session, {
      candidateTriggeredAdvance: false,
      wasProbe: false,
      speaker: "candidate",
      text: "First attempt.",
      executionResults: [{ testCaseId: "core-1", tag: "core", passed: false }],
    });
    session = first.session;

    const second = handleTurn(session, {
      candidateTriggeredAdvance: false,
      wasProbe: false,
      speaker: "candidate",
      text: "Fixed it, resubmitting.",
      executionResults: [{ testCaseId: "core-1", tag: "core", passed: true }],
    });

    expect(second.session.evidence.executionResults).toEqual([
      { testCaseId: "core-1", tag: "core", passed: false },
      { testCaseId: "core-1", tag: "core", passed: true },
    ]);
  });
});

describe("handleTurn — evidence: transitionLog", () => {
  it("logs a transitionLog entry with from/to/reason when a transition occurs", () => {
    const session: SessionState = {
      current: "coding",
      probeCountInCurrentState: PROBE_CAPS["coding"]! - 1,
      evidence: createEmptyEvidence(),
    };
    const result = handleTurn(session, {
      candidateTriggeredAdvance: false,
      wasProbe: true,
      speaker: "interviewer",
      text: "Let's move on to testing.",
    });

    expect(result.session.evidence.transitionLog).toEqual([
      { from: "coding", to: "testing-debugging", reason: "probe-cap-exceeded" },
    ]);
  });

  it("does not log a transitionLog entry when no transition occurs", () => {
    const session: SessionState = {
      current: "coding",
      probeCountInCurrentState: 0,
      evidence: createEmptyEvidence(),
    };
    const result = handleTurn(session, {
      candidateTriggeredAdvance: false,
      wasProbe: true,
      speaker: "interviewer",
      text: "Any thoughts on complexity yet?",
    });

    expect(result.session.evidence.transitionLog).toEqual([]);
  });
});