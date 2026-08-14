// Output schema for the judged-advance check. Deliberately minimal
// compared to evaluation/judged/schema.ts's buildScoringResponseSchema —
// there's no rubric-category-set to validate against here, just a single
// boolean verdict + justification. No factory function needed since this
// schema's shape doesn't depend on any runtime config (unlike the scoring
// schema, which depends on rubric.config.json's category list).

import { z } from "zod";

export const AdvanceJudgeResponseSchema = z.object({
  advance: z.boolean(),
  justification: z.string().min(1),
});

export type AdvanceJudgeResponse = z.infer<typeof AdvanceJudgeResponseSchema>;