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