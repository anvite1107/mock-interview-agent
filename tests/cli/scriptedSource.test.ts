import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stdout } from "node:process";
import { createScriptedTurnSource } from "../../src/cli/replay.ts";
import { PERSONA_SCHEMA_VERSION, type LoadedPersona } from "../../eval-harness/personaSchema.ts";

let dir: string;
let candidateFile: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "scripted-source-"));
  candidateFile = join(dir, "candidate.py");
  // The source echoes turns for the replay log; tests don't need the noise.
  vi.spyOn(stdout, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

function makePersona(turns: LoadedPersona["turns"], code: Record<string, string> = {}): LoadedPersona {
  return {
    schemaVersion: PERSONA_SCHEMA_VERSION,
    id: "fixture",
    problemId: "two-sum",
    notes: "fixture",
    turns,
    code: new Map(Object.entries(code)),
  };
}

describe("createScriptedTurnSource", () => {
  it("yields say turns in order", async () => {
    const source = createScriptedTurnSource(
      makePersona([
        { kind: "say", text: "first" },
        { kind: "say", text: "second" },
      ]),
      candidateFile
    );

    expect(await source.next()).toBe("first");
    expect(await source.next()).toBe("second");
  });

  it("emits the literal slash commands, so they flow through parseCommand", async () => {
    const source = createScriptedTurnSource(
      makePersona(
        [
          { kind: "code", file: "a.py" },
          { kind: "submit" },
          { kind: "quit" },
        ],
        { "a.py": "def two_sum(nums, target): return []\n" }
      ),
      candidateFile
    );

    expect(await source.next()).toBe("/submit");
    expect(await source.next()).toBe("/quit");
  });

  // A person editing their file isn't taking a turn; inventing a transcript
  // entry for it would put words in the record that were never spoken.
  it("writes the candidate file on a code turn without yielding a turn", async () => {
    const code = "def two_sum(nums, target):\n    return []\n";
    const source = createScriptedTurnSource(
      makePersona(
        [
          { kind: "code", file: "a.py" },
          { kind: "say", text: "done" },
        ],
        { "a.py": code }
      ),
      candidateFile
    );

    expect(existsSync(candidateFile)).toBe(false);
    expect(await source.next()).toBe("done");
    expect(readFileSync(candidateFile, "utf-8")).toBe(code);
  });

  it("applies consecutive code turns in order, last one winning", async () => {
    const source = createScriptedTurnSource(
      makePersona(
        [
          { kind: "code", file: "v1.py" },
          { kind: "code", file: "v2.py" },
          { kind: "submit" },
        ],
        { "v1.py": "# first\n", "v2.py": "# second\n" }
      ),
      candidateFile
    );

    expect(await source.next()).toBe("/submit");
    expect(readFileSync(candidateFile, "utf-8")).toBe("# second\n");
  });

  it("rewrites the candidate file on a later revision", async () => {
    const source = createScriptedTurnSource(
      makePersona(
        [
          { kind: "code", file: "v1.py" },
          { kind: "submit" },
          { kind: "code", file: "v2.py" },
          { kind: "submit" },
        ],
        { "v1.py": "# buggy\n", "v2.py": "# fixed\n" }
      ),
      candidateFile
    );

    await source.next();
    expect(readFileSync(candidateFile, "utf-8")).toBe("# buggy\n");
    await source.next();
    expect(readFileSync(candidateFile, "utf-8")).toBe("# fixed\n");
  });

  // Null is how the interview loop learns the script ran out; it ends the
  // session early and saves it with completed: false.
  it("returns null once exhausted, and stays null", async () => {
    const source = createScriptedTurnSource(
      makePersona([{ kind: "say", text: "only" }]),
      candidateFile
    );

    expect(await source.next()).toBe("only");
    expect(await source.next()).toBeNull();
    expect(await source.next()).toBeNull();
  });

  it("returns null when the script ends on a trailing code turn", async () => {
    const source = createScriptedTurnSource(
      makePersona([{ kind: "code", file: "a.py" }], { "a.py": "# x\n" }),
      candidateFile
    );

    expect(await source.next()).toBeNull();
    expect(readFileSync(candidateFile, "utf-8")).toBe("# x\n");
  });

  describe("remaining()", () => {
    it("reports unconsumed turns, which is how a desync gets surfaced", async () => {
      const source = createScriptedTurnSource(
        makePersona([
          { kind: "say", text: "one" },
          { kind: "say", text: "two" },
          { kind: "say", text: "three" },
        ]),
        candidateFile
      );

      expect(source.remaining()).toBe(3);
      await source.next();
      expect(source.remaining()).toBe(2);
    });

    it("reaches zero on a fully consumed script and never goes negative", async () => {
      const source = createScriptedTurnSource(
        makePersona([{ kind: "say", text: "one" }]),
        candidateFile
      );

      await source.next();
      await source.next();
      await source.next();
      expect(source.remaining()).toBe(0);
    });
  });
});
