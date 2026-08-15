// eval-harness/goldSchema.ts
//
// Human reference labels for a played session — the "gold" half of the
// agent-vs-gold agreement metric.
//
// Lives under eval-harness/ rather than src/ because these are evaluation
// artifacts, not runtime inputs: nothing the agent does at interview time
// reads them.

import { z } from "zod";

export const GOLD_SCHEMA_VERSION = 1;

export const GoldLabelsSchema = z.object({
  schemaVersion: z.literal(GOLD_SCHEMA_VERSION),
  runId: z.string(),
  problemId: z.string(),
  labeledAt: z.string(),
  /** Recorded so a disagreement can be traced back to the rubric wording
   *  that produced it. Day 19 tunes anchors; without this, labels from
   *  before and after a tuning pass are indistinguishable. */
  rubricCategoryIds: z.array(z.string()),
  categories: z.array(
    z.object({
      categoryId: z.string(),
      /** Written before the score is chosen, mirroring the constraint the
       *  judge prompt puts on the model. A number picked first tends to
       *  get justified after the fact — by a person as much as by an LLM. */
      justification: z.string(),
      score: z.number().int().min(1).max(5),
    })
  ),
});

export type GoldLabels = z.infer<typeof GoldLabelsSchema>;
