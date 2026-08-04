import { describe, it, expect } from "vitest";
import { createSession, handleTurn, isTerminal } from "../../src/engine/stateMachine.js";
import type { SessionState } from "../../src/engine/states.js";

describe("createSession", () => {
  it("starts at the first state with zero probes", () => {
    const session = createSession();
    expect(session.current).toBe("problem-intro");
    expect(session.probeCountInCurrentState).toBe(0);
  });
});

describe("handleTurn — candidate-driven transition", () => {
  it("advances when candidateTriggeredAdvance is true, regardless of probe count", () => {
    const session: SessionState = { current: "clarifying-questions", probeCountInCurrentState: 1 };
    const result = handleTurn(session, { candidateTriggeredAdvance: true, wasProbe: false });

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
    const session: SessionState = { current: "coding", probeCountInCurrentState: 0 }; // cap is 2
    const result = handleTurn(session, { candidateTriggeredAdvance: false, wasProbe: true });

    expect(result.transitioned).toBe(false);
    expect(result.session.probeCountInCurrentState).toBe(1);
    expect(result.session.current).toBe("coding"); // unchanged
  });
});

describe("handleTurn — probe cap exceeded, same turn", () => {
  it("force-advances on the turn the cap is reached, not the turn after", () => {
    const session: SessionState = { current: "coding", probeCountInCurrentState: 1 }; // one below cap of 2
    const result = handleTurn(session, { candidateTriggeredAdvance: false, wasProbe: true });

    expect(result.transitioned).toBe(true);
    expect(result.reason).toBe("probe-cap-exceeded");
    expect(result.toState).toBe("testing-debugging");
    expect(result.session.probeCountInCurrentState).toBe(0); // reset on entry to new state
  });
});

describe("handleTurn — states with no probe cap never force-advance", () => {
  it("stays put indefinitely in a state with no configured cap, e.g. testing-debugging", () => {
    const session: SessionState = { current: "testing-debugging", probeCountInCurrentState: 50 };
    const result = handleTurn(session, { candidateTriggeredAdvance: false, wasProbe: true });

    expect(result.transitioned).toBe(false);
    expect(result.session.current).toBe("testing-debugging");
  });
});

describe("handleTurn — candidate action and probe on the same turn", () => {
  it("candidate action wins; the probe is not counted", () => {
    const session: SessionState = { current: "clarifying-questions", probeCountInCurrentState: 0 };
    const result = handleTurn(session, { candidateTriggeredAdvance: true, wasProbe: true });

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
    const session: SessionState = { current: "coding", probeCountInCurrentState: 1 }; // cap is 2
    const result = handleTurn(session, { candidateTriggeredAdvance: true, wasProbe: true });

    expect(result.reason).toBe("candidate-action"); // not "probe-cap-exceeded"
  });
});

describe("isTerminal", () => {
  it("returns false for any non-final state", () => {
    expect(isTerminal({ current: "coding", probeCountInCurrentState: 0 })).toBe(false);
  });

  it("returns true once the session reaches wrap-up", () => {
    expect(isTerminal({ current: "wrap-up", probeCountInCurrentState: 0 })).toBe(true);
  });
});

describe("handleTurn — terminal state", () => {
  it("does not transition further once already at wrap-up", () => {
    const session: SessionState = { current: "wrap-up", probeCountInCurrentState: 0 };
    const result = handleTurn(session, { candidateTriggeredAdvance: true, wasProbe: false });

    expect(result.transitioned).toBe(false);
    expect(result.toState).toBeNull();
  });
});