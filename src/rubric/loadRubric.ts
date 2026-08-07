// reads + validates config.json against schema.ts
// rubric.config.json contains the actual rubric data (6 categories, anchors)

import { readFileSync } from "node:fs";
import { RubricConfigSchema, type RubricConfig } from "./schema.ts";

const RUBRIC_PATH = new URL("./rubric.config.json", import.meta.url);

export function loadRubric(): RubricConfig {
  const raw = readFileSync(RUBRIC_PATH, "utf-8");
  const parsed = JSON.parse(raw);

  const result = RubricConfigSchema.safeParse(parsed);

  if (!result.success) {
    console.error("Rubric config failed validation:");
    console.error(result.error.format());
    throw new Error("Invalid rubric.config.json — see errors above.");
  }

  return result.data;
}