// zod schema + inferred types

import { z } from "zod";

// ─── GroundedBy ───────────────────────────────────────────
// What kind of evidence backs a category's score.
// The engine branches on this to decide what to feed the scorer:
// execution results, reference-answer comparison, or raw transcript text.
export const GroundedBySchema = z.enum([
  "stated-words",         // Problem understanding
  "reference-comparison",  // Approach correctness
  "stated-complexity",     // Complexity analysis
  "execution:edge",        // Edge-case handling
  "execution:core",        // Code correctness
  "narration-structure",   // Communication
]);

export type GroundedBy = z.infer<typeof GroundedBySchema>;


// ─── Anchors ──────────────────────────────────────────────
// One observable-behavior description per score level (1-5).
// Object shape (not array) so a missing/misnamed level fails
// validation loudly instead of silently shifting indices.
export const AnchorsSchema = z.object({
  1: z.string(),
  2: z.string(),
  3: z.string(),
  4: z.string(),
  5: z.string(),
});

export type Anchors = z.infer<typeof AnchorsSchema>;


// ─── RubricCategory ───────────────────────────────────────
// One scored dimension of the rubric (e.g. "Problem understanding").
export const RubricCategorySchema = z.object({
  id: z
    .string()
    .regex(/^[a-z0-9-]+$/, "id must be kebab-case (lowercase letters, digits, hyphens only)"),            
// stable machine-readable key, e.g. "problem-understanding"
  label: z.string(),         // human-readable name, e.g. "Problem understanding"
  weight: z.number().positive(),        // percentage weight, e.g. 15 (validated as a whole later)
  groundedBy: GroundedBySchema,
  anchors: AnchorsSchema,
});

export type RubricCategory = z.infer<typeof RubricCategorySchema>;


// ─── RubricConfig ─────────────────────────────────────────
// The full rubric: a list of categories whose weights must sum to 100.
const RubricConfigShape = z.object({
  categories: z.array(RubricCategorySchema),
});

type RubricConfigInput = z.infer<typeof RubricConfigShape>;

export const RubricConfigSchema = RubricConfigShape.superRefine(
  (config: RubricConfigInput, ctx) => {
    const total = config.categories.reduce((sum, c) => sum + c.weight, 0);
    if (Math.abs(total - 100) >= 0.001) {
      ctx.addIssue({
        code: "custom",
        message: `Category weights must sum to 100, got ${total}`,
        path: ["categories"],
      });
    }

    const ids = config.categories.map((c) => c.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: "custom",
        message: "Category ids must be unique",
        path: ["categories"],
      });
    }
  }
);

export type RubricConfig = z.infer<typeof RubricConfigSchema>;