// Output schema for probe generation.
//
// Same minimal shape rationale as advance/schema.ts — no runtime config
// dependency, so no factory function like buildScoringResponseSchema.
//
// `rationale` comes FIRST in the JSON shape the prompt asks for, mirroring
// the justification-before-score ordering used by the scoring judge: the
// model commits to why a probe is warranted before writing the probe
// itself. It is engine-internal — it is never spoken to the candidate and
// never enters the transcript. handleProbeTurn returns it to the caller so
// Day 19 disagreement analysis can see what the agent thought it was
// eliciting when it asked a given question.

import { z } from "zod";

export const ProbeResponseSchema = z.object({
  rationale: z.string().min(1),
  probe: z.string().min(1),
});

export type ProbeResponse = z.infer<typeof ProbeResponseSchema>;
