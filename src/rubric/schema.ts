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
export const RubricConfigSchema = z
  .object({
    categories: z.array(RubricCategorySchema),
  })
  .refine(
    (config) => {
      const total = config.categories.reduce((sum, c) => sum + c.weight, 0);
      // floating-point safe comparison instead of === 100
      return Math.abs(total - 100) < 0.001;
    },
    (config) => {
      const total = config.categories.reduce((sum, c) => sum + c.weight, 0);
      return { message: `Category weights must sum to 100, got ${total}` };
    }
  )
  .refine(
    (config) => {
      const ids = config.categories.map((c) => c.id);
      return new Set(ids).size === ids.length;
    },
    { message: "Category ids must be unique" }
  );

export type RubricConfig = z.infer<typeof RubricConfigSchema>;