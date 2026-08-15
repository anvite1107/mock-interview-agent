import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nextRunId, pathsFor, resolveRun, readSession, writeSession } from "../../src/session/store.ts";
import type { SavedSession } from "../../src/session/schema.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sessions-test-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("nextRunId", () => {
  it("starts at run-001 when the sessions directory does not exist yet", () => {
    expect(nextRunId(join(dir, "does-not-exist"))).toBe("run-001");
  });

  it("increments past the highest existing run", () => {
    mkdirSync(join(dir, "run-001"));
    mkdirSync(join(dir, "run-002"));
    expect(nextRunId(dir)).toBe("run-003");
  });

  it("does not reuse an id after an earlier run is deleted", () => {
    // Counting directories instead of reading the max would return
    // run-002 here and collide with the existing one.
    mkdirSync(join(dir, "run-001"));
    mkdirSync(join(dir, "run-002"));
    rmSync(join(dir, "run-001"), { recursive: true });

    expect(nextRunId(dir)).toBe("run-003");
  });

  it("ignores directories that are not runs", () => {
    mkdirSync(join(dir, "run-004"));
    mkdirSync(join(dir, "notes"));
    writeFileSync(join(dir, "README.md"), "x");

    expect(nextRunId(dir)).toBe("run-005");
  });

  it("keeps zero padding past nine", () => {
    mkdirSync(join(dir, "run-009"));
    expect(nextRunId(dir)).toBe("run-010");
  });
});

describe("resolveRun", () => {
  it("accepts a bare run id", () => {
    expect(resolveRun("run-004", dir).runId).toBe("run-004");
  });

  it("accepts a path, since that's what tab-completion gives you", () => {
    expect(resolveRun("sessions/run-004", dir).runId).toBe("run-004");
    expect(resolveRun("sessions/run-004/", dir).runId).toBe("run-004");
  });

  it("rejects something that isn't a run id", () => {
    expect(() => resolveRun("banana", dir)).toThrow(/doesn't look like a run id/);
  });
});

describe("session round-trip", () => {
  const session: SavedSession = {
    schemaVersion: 1,
    runId: "run-001",
    problemId: "two-sum",
    startedAt: "2026-08-15T12:00:00.000Z",
    endedAt: "2026-08-15T12:30:00.000Z",
    finalState: "wrap-up",
    completed: true,
    transcript: [{ speaker: "candidate", state: "coding", text: "(submits code)" }],
    submissions: [
      {
        turnIndex: 0,
        code: "def solution(nums, target):\n    return []\n",
        results: [
          {
            testCaseId: "core-1",
            tag: "core",
            passed: false,
            actualOutput: [],
            error: { type: "wrong-output", message: "Expected [0,1], got []" },
            executionTimeMs: 12,
          },
        ],
      },
    ],
    transitionLog: [{ from: "coding", to: "testing-debugging", reason: "candidate-action" }],
  };

  it("writes and reads back an identical session", () => {
    const paths = pathsFor("run-001", dir);
    mkdirSync(paths.dir, { recursive: true });

    writeSession(session, paths);

    expect(readSession(paths)).toEqual(session);
  });

  it("gives a pointed error when the session file is missing", () => {
    expect(() => readSession(pathsFor("run-042", dir))).toThrow(/Run an interview for run-042/);
  });

  it("refuses to write a session that fails its own schema", () => {
    const paths = pathsFor("run-001", dir);
    mkdirSync(paths.dir, { recursive: true });
    const broken = structuredClone(session);
    // @ts-expect-error deliberately invalid: exercises the write-time guard
    broken.finalState = "not-a-state";

    expect(() => writeSession(broken, paths)).toThrow();
  });
});
