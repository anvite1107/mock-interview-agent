// src/session/store.ts
//
// Filesystem layout for played sessions.
//
//   sessions/
//     run-001/
//       candidate.py    the file the candidate edits and /submit runs
//       session.json    transcript + submissions, no scores
//       gold.json       human labels, written by `label`
//       report.json     agent scores, written by `score`
//
// Not dot-prefixed and not gitignored: these files ARE the eval corpus,
// so they're meant to be committed and diffed, not treated as scratch.

import { readdirSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SavedSessionSchema, type SavedSession } from "./schema.ts";

const SESSIONS_DIR = "sessions";

export interface SessionPaths {
  runId: string;
  dir: string;
  candidateFile: string;
  sessionFile: string;
  goldFile: string;
  reportFile: string;
}

export function pathsFor(runId: string, sessionsDir: string = SESSIONS_DIR): SessionPaths {
  const dir = join(sessionsDir, runId);
  return {
    runId,
    dir,
    candidateFile: join(dir, "candidate.py"),
    sessionFile: join(dir, "session.json"),
    goldFile: join(dir, "gold.json"),
    reportFile: join(dir, "report.json"),
  };
}

/**
 * Next free run id, zero-padded so `ls` and tab-completion stay ordered.
 *
 * Derived from the highest existing id rather than from a count, so
 * deleting run-002 doesn't cause the next run to collide with run-003.
 */
export function nextRunId(sessionsDir: string = SESSIONS_DIR): string {
  if (!existsSync(sessionsDir)) return "run-001";

  const highest = readdirSync(sessionsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => /^run-(\d+)$/.exec(e.name))
    .reduce((max, match) => {
      if (match === null) return max;
      const n = Number.parseInt(match[1]!, 10);
      return n > max ? n : max;
    }, 0);

  return `run-${String(highest + 1).padStart(3, "0")}`;
}

/**
 * Every run directory that actually holds a session, oldest id first.
 *
 * Filters on session.json rather than on directory name: a run dir created
 * by a crash before the first write is not a session, and batch commands
 * shouldn't report it as a failure every time they run.
 */
export function listRuns(sessionsDir: string = SESSIONS_DIR): SessionPaths[] {
  if (!existsSync(sessionsDir)) return [];

  return readdirSync(sessionsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^run-\d+$/.test(e.name))
    .map((e) => pathsFor(e.name, sessionsDir))
    .filter((paths) => existsSync(paths.sessionFile))
    .sort((a, b) => a.runId.localeCompare(b.runId));
}

export function createRunDir(paths: SessionPaths): void {
  mkdirSync(paths.dir, { recursive: true });
}

export function writeSession(session: SavedSession, paths: SessionPaths): void {
  // Validate on the way out: a malformed session file is unrecoverable
  // once the interview it describes is over.
  const validated = SavedSessionSchema.parse(session);
  writeFileSync(paths.sessionFile, `${JSON.stringify(validated, null, 2)}\n`, "utf-8");
}

export function readSession(paths: SessionPaths): SavedSession {
  if (!existsSync(paths.sessionFile)) {
    throw new Error(
      `No session file at ${paths.sessionFile}. Run an interview for ${paths.runId} first.`
    );
  }
  return SavedSessionSchema.parse(JSON.parse(readFileSync(paths.sessionFile, "utf-8")));
}

/**
 * Resolves whatever the user typed on the command line to a run.
 * Accepts a bare id ("run-004") or a path ("sessions/run-004"), since
 * both are things you'd naturally have on your clipboard.
 */
export function resolveRun(arg: string, sessionsDir: string = SESSIONS_DIR): SessionPaths {
  const runId = arg.replace(/\/+$/, "").split("/").pop() ?? arg;
  if (!/^run-\d+$/.test(runId)) {
    throw new Error(`"${arg}" doesn't look like a run id (expected e.g. run-004).`);
  }
  return pathsFor(runId, sessionsDir);
}
