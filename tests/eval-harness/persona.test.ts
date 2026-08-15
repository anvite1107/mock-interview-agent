import { describe, it, expect } from "vitest";
import {
  PersonaSchema,
  PERSONA_SCHEMA_VERSION,
  loadPersona,
  listPersonaIds,
} from "../../eval-harness/personaSchema.ts";
import { loadProblems } from "../../problem-bank/loadProblems.ts";

function persona(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: PERSONA_SCHEMA_VERSION,
    id: "test-persona",
    problemId: "two-sum",
    notes: "Behavioral description, no target scores.",
    turns: [
      { kind: "say", text: "Can I assume the input fits in memory?" },
      { kind: "code", file: "test-persona.v1.py" },
      { kind: "submit" },
    ],
    ...overrides,
  };
}

describe("PersonaSchema", () => {
  it("accepts a well-formed persona", () => {
    expect(PersonaSchema.safeParse(persona()).success).toBe(true);
  });

  it("rejects a non-kebab-case id", () => {
    expect(PersonaSchema.safeParse(persona({ id: "Test_Persona" })).success).toBe(false);
  });

  it("rejects an unknown turn kind", () => {
    const result = PersonaSchema.safeParse(
      persona({ turns: [{ kind: "shout", text: "hello" }] })
    );
    expect(result.success).toBe(false);
  });

  it("rejects a code turn pointing at a path rather than a bare filename", () => {
    const result = PersonaSchema.safeParse(
      persona({ turns: [{ kind: "code", file: "../../etc/passwd.py" }, { kind: "submit" }] })
    );
    expect(result.success).toBe(false);
  });

  it("rejects a code turn that isn't a .py file", () => {
    const result = PersonaSchema.safeParse(
      persona({ turns: [{ kind: "code", file: "solution.txt" }, { kind: "submit" }] })
    );
    expect(result.success).toBe(false);
  });

  // Submitting the seeded stub fails every test case for a reason that has
  // nothing to do with the candidate being modeled.
  it("rejects a submit before any code turn", () => {
    const result = PersonaSchema.safeParse(
      persona({ turns: [{ kind: "say", text: "here goes" }, { kind: "submit" }] })
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.format())).toMatch(/before any code turn/);
    }
  });

  it("rejects turns scheduled after a quit", () => {
    const result = PersonaSchema.safeParse(
      persona({
        turns: [
          { kind: "say", text: "I'm stuck" },
          { kind: "quit" },
          { kind: "say", text: "never reached" },
        ],
      })
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.format())).toMatch(/turns after its quit/);
    }
  });

  it("accepts a quit as the final turn", () => {
    const result = PersonaSchema.safeParse(
      persona({ turns: [{ kind: "say", text: "I'm stuck" }, { kind: "quit" }] })
    );
    expect(result.success).toBe(true);
  });

  it("rejects an empty turn list", () => {
    expect(PersonaSchema.safeParse(persona({ turns: [] })).success).toBe(false);
  });

  // The whole point of the format: nothing on disk says what a session
  // should score, so labeling can't be recall of a target.
  it("has no field for expected scores", () => {
    const shape = PersonaSchema.safeParse(persona());
    expect(shape.success).toBe(true);
    if (shape.success) {
      expect(Object.keys(shape.data)).toEqual([
        "schemaVersion",
        "id",
        "problemId",
        "notes",
        "turns",
      ]);
    }
  });
});

describe("the committed persona corpus", () => {
  const ids = listPersonaIds();
  const problems = loadProblems();

  it("has personas to replay", () => {
    expect(ids.length).toBeGreaterThan(0);
  });

  it.each(ids)("%s loads, resolves its code files, and names a real problem", (id) => {
    const loaded = loadPersona(id);

    expect(problems.has(loaded.problemId)).toBe(true);

    for (const turn of loaded.turns) {
      if (turn.kind !== "code") continue;
      expect(loaded.code.get(turn.file)).toBeTypeOf("string");
      expect(loaded.code.get(turn.file)!.length).toBeGreaterThan(0);
    }
  });

  it("covers every problem in the bank at least once", () => {
    const covered = new Set(ids.map((id) => loadPersona(id).problemId));
    const uncovered = [...problems.keys()].filter((p) => !covered.has(p));
    expect(uncovered).toEqual([]);
  });
});
