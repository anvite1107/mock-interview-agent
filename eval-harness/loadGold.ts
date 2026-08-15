// eval-harness/loadGold.ts
//
// Reads gold label files back off disk. Separate from goldSchema.ts for the
// same reason loadRubric.ts is separate from rubric/schema.ts: the schema is
// the contract, the loader is the I/O.

import { existsSync, readFileSync } from "node:fs";
import { GoldLabelsSchema, type GoldLabels } from "./goldSchema.ts";
import type { RubricConfig } from "../src/rubric/schema.ts";

/** Null when the run hasn't been labeled yet — the common case during
 *  corpus building, and not an error worth throwing over. */
export function readGoldIfPresent(goldFile: string): GoldLabels | null {
  if (!existsSync(goldFile)) return null;

  const result = GoldLabelsSchema.safeParse(JSON.parse(readFileSync(goldFile, "utf-8")));
  if (!result.success) {
    throw new Error(
      `${goldFile} failed validation:\n${JSON.stringify(result.error.format(), null, 2)}`
    );
  }
  return result.data;
}

/**
 * Whether a gold label was written against the rubric currently on disk.
 *
 * Day 19 tunes rubric anchors, which is exactly when this starts mattering:
 * a label written against the old category set is not comparable to a score
 * produced under the new one, and averaging the two together quietly
 * corrupts the agreement figure. goldSchema.ts records rubricCategoryIds
 * for this check specifically.
 *
 * Only the category SET is compared, not the anchor text. Reworded anchors
 * are the normal Day 19 activity and don't invalidate a label; added,
 * removed or renamed categories do.
 */
export function rubricDrift(
  gold: GoldLabels,
  rubricConfig: RubricConfig
): { drifted: boolean; message: string | null } {
  const current = new Set(rubricConfig.categories.map((c) => c.id));
  const labeled = new Set(gold.rubricCategoryIds);

  const missing = [...labeled].filter((id) => !current.has(id));
  const added = [...current].filter((id) => !labeled.has(id));

  if (missing.length === 0 && added.length === 0) {
    return { drifted: false, message: null };
  }

  const parts: string[] = [];
  if (missing.length > 0) parts.push(`labeled against now-absent ${missing.join(", ")}`);
  if (added.length > 0) parts.push(`rubric has new ${added.join(", ")}`);

  return {
    drifted: true,
    message: `${gold.runId} gold labels predate the current rubric (${parts.join("; ")}) — relabel before trusting agreement on this run.`,
  };
}
