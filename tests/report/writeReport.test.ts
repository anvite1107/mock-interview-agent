import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadRubric } from "../../src/rubric/loadRubric.ts";
import { loadProblems } from "../../problem-bank/loadProblems.ts";
import { buildReport } from "../../src/report/buildReport.ts";
import { writeReport } from "../../src/report/writeReport.ts";
import { SessionReportSchema, type SessionReport } from "../../src/report/schema.ts";
import type { SessionState } from "../../src/engine/states.ts";

const rubricConfig = loadRubric();
const problem = loadProblems().get("two-sum")!;

const session: SessionState = {
  current: "wrap-up",
  probeCountInCurrentState: 0,
  evidence: { transcript: [], executionResults: [], transitionLog: [] },
};

const aggregated = {
  categoryScores: rubricConfig.categories.map((c) => ({
    categoryId: c.id,
    score: 3,
    justification: `stub justification for ${c.id}`,
    source: "judge" as const,
  })),
  weightedTotal: 50,
};

function makeReport(): SessionReport {
  return buildReport(session, aggregated, problem, rubricConfig, {
    generatedAt: "2026-08-15T12:00:00.000Z",
  });
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "report-test-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("writeReport", () => {
  it("writes a report that round-trips back through the schema", () => {
    const outPath = join(dir, "session.json");
    const report = makeReport();

    writeReport(report, outPath);

    const parsed = SessionReportSchema.parse(JSON.parse(readFileSync(outPath, "utf-8")));
    expect(parsed).toEqual(report);
  });

  it("creates missing parent directories", () => {
    const outPath = join(dir, "runs", "2026-08-15", "session.json");

    writeReport(makeReport(), outPath);

    expect(existsSync(outPath)).toBe(true);
  });

  it("throws without writing anything when the report fails its own schema", () => {
    const outPath = join(dir, "session.json");
    const broken = makeReport();
    // Out of the 1-5 anchor range — the kind of drift that would make the
    // eval harness reject this file long after the session is gone.
    broken.scores.categories[0]!.score = 9;

    expect(() => writeReport(broken, outPath)).toThrow();
    expect(existsSync(outPath)).toBe(false);
  });
});
