// src/report/writeReport.ts
//
// Filesystem side of the report generator, kept apart from buildReport so
// that one stays pure and trivially testable.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { SessionReportSchema, type SessionReport } from "./schema.ts";

/**
 * Serializes a report to disk, creating parent directories as needed.
 *
 * Validates before writing even though the input is already typed: the
 * type only constrains what the compiler saw, and a report that fails its
 * own schema is worse than no report — the eval harness would reject it
 * later, after the session it describes is gone and unreproducible. Fail
 * here, where the data is still in hand.
 *
 * Pretty-printed because these get read by hand during rubric tuning.
 */
export function writeReport(report: SessionReport, outPath: string): void {
  const validated = SessionReportSchema.parse(report);

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(validated, null, 2)}\n`, "utf-8");
}
