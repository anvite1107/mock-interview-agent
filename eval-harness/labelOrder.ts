#!/usr/bin/env node
// eval-harness/labelOrder.ts
//
// Prints the runs still needing gold labels, in a shuffled order.
//
// Labeling sequentially — run-001, run-002, ... — is labeling in authoring
// order, which is where recall of what each persona was written to do is
// strongest. Since the corpus author is also the labeler, that recall is
// the main thing standing between a gold label and an independent reading
// of the transcript. Shuffling doesn't remove the problem, but it is the
// cheapest thing that reduces it.
//
// The order is derived from a seed rather than from Math.random so a
// labeling session can be resumed across days and pick up the same
// sequence. Pass a seed to get a different one:
//
//   npm run label:order
//   npm run label:order 7

import { stdout, stderr, argv, exit } from "node:process";
import { existsSync } from "node:fs";
import { listRuns } from "../src/session/store.ts";
import { readGoldIfPresent } from "./loadGold.ts";

/** mulberry32 — a small deterministic PRNG. Any seeded generator would do;
 *  this one is short enough to read and has no dependency. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export function runLabelOrder(seedArg: string | undefined): void {
  const seed = seedArg === undefined ? 1 : Number.parseInt(seedArg, 10);
  if (!Number.isInteger(seed)) {
    throw new Error(`"${seedArg}" isn't a seed — pass a whole number, or nothing for the default.`);
  }

  const runs = listRuns();
  if (runs.length === 0) {
    throw new Error("No sessions in sessions/. Play or replay some first.");
  }

  const unlabeled = runs.filter((paths) => !existsSync(paths.goldFile));
  const labeled = runs.length - unlabeled.length;

  stdout.write(`\n── Labeling order (seed ${seed}) ──\n`);
  stdout.write(`  ${labeled}/${runs.length} labeled\n\n`);

  if (unlabeled.length === 0) {
    stdout.write("  Everything is labeled. Next: npm run score -- --all, then npm run eval\n\n");
    return;
  }

  // Shuffle the full run list, then filter — so already-labeled runs drop
  // out without shifting the positions of the ones that remain. Re-running
  // mid-session continues the same sequence instead of reshuffling it.
  const order = shuffled(runs, makeRandom(seed)).filter((paths) => !existsSync(paths.goldFile));

  for (const [index, paths] of order.entries()) {
    stdout.write(`  ${String(index + 1).padStart(2)}. npm run label ${paths.runId}\n`);
  }

  stdout.write(
    `\n  Don't read report.json or the persona files first — ` +
      `both defeat the point of the label.\n\n`
  );
}

/** Guards against a run being labeled twice under different rubrics, which
 *  readGoldIfPresent would surface as a validation error much later. */
export function labeledRunIds(): string[] {
  return listRuns()
    .filter((paths) => readGoldIfPresent(paths.goldFile) !== null)
    .map((paths) => paths.runId);
}

if (import.meta.url === `file://${argv[1]}`) {
  try {
    runLabelOrder(argv[2]);
  } catch (err) {
    stderr.write(`\n${err instanceof Error ? err.message : String(err)}\n\n`);
    exit(1);
  }
}
