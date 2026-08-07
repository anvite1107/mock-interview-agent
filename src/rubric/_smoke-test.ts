import { loadRubric } from "./loadRubric.ts";

const rubric = loadRubric();
console.log(`Loaded ${rubric.categories.length} categories:`);
rubric.categories.forEach((c) => console.log(`- ${c.id} (${c.weight}%)`));