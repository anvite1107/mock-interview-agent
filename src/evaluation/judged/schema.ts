import { z } from "zod";
import type { RubricConfig } from "../../rubric/schema.ts";

// ─── CategoryScore ────────────────────────────────────────
// One judge-produced score for a single rubric category.
export const CategoryScoreSchema = z.object({
  categoryId: z.string(),
  justification: z.string(),
  score: z.number().int().min(1).max(5),
});

export type CategoryScore = z.infer<typeof CategoryScoreSchema>;

// ─── ScoringResponse ──────────────────────────────────────
// The judge's full response: one CategoryScore per rubric category.
// categoryId validity/coverage can't be checked statically — the set
// of valid ids only exists once rubric.config.json is loaded — so this
// is a factory, not a static export. Call it with the loaded RubricConfig.
const ScoringResponseShape = z.object({
  categoryScores: z.array(CategoryScoreSchema),
});

type ScoringResponseInput = z.infer<typeof ScoringResponseShape>;

export function buildScoringResponseSchema(rubricConfig: RubricConfig) {
  const validIds = rubricConfig.categories.map((c) => c.id);
  const validIdSet = new Set(validIds);

  return ScoringResponseShape.superRefine(
    (data: ScoringResponseInput, ctx) => {
      const seenIds = data.categoryScores.map((c) => c.categoryId);

      // Every categoryId must be a real rubric category.
      seenIds.forEach((id, i) => {
        if (!validIdSet.has(id)) {
          ctx.addIssue({
            code: "custom",
            message: `Unknown categoryId "${id}" — not present in rubric config`,
            path: ["categoryScores", i, "categoryId"],
          });
        }
      });

      // No duplicate categoryIds.
      if (new Set(seenIds).size !== seenIds.length) {
        ctx.addIssue({
          code: "custom",
          message: "categoryScores contains duplicate categoryId values",
          path: ["categoryScores"],
        });
      }

      // Every rubric category must be covered exactly once.
      const missing = validIds.filter((id) => !seenIds.includes(id));
      if (missing.length > 0) {
        ctx.addIssue({
          code: "custom",
          message: `Missing scores for category ids: ${missing.join(", ")}`,
          path: ["categoryScores"],
        });
      }
    }
  );
}

export type ScoringResponse = ScoringResponseInput;