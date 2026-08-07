// problem-bank/loadProblems.ts
import { readdirSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import { join, basename, dirname } from "path";
import { ProblemSchema, type Problem } from "./schema.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PROBLEMS_DIR = join(__dirname, "problems");

export function loadProblems(problemsDir: string = PROBLEMS_DIR): Map<string, Problem> {
  const files = readdirSync(problemsDir).filter(f => f.endsWith(".json"));

  const errors: string[] = [];
  const problems = new Map<string, Problem>();

  for (const file of files) {
    const filePath = join(problemsDir, file);
    const expectedId = basename(file, ".json");

    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(filePath, "utf-8"));
    } catch (err) {
      errors.push(`${file}: failed to parse JSON — ${(err as Error).message}`);
      continue;
    }

    const result = ProblemSchema.safeParse(raw);
    if (!result.success) {
      const issues = result.error.issues
        .map(i => `  - [${i.path.join(".")}] ${i.message}`)
        .join("\n");
      errors.push(`${file}: schema validation failed\n${issues}`);
      continue;
    }

    const problem = result.data;

    if (problem.id !== expectedId) {
      errors.push(
        `${file}: filename does not match id — filename implies "${expectedId}", but id is "${problem.id}"`
      );
      continue;
    }

    if (problems.has(problem.id)) {
      errors.push(`${file}: duplicate problem id "${problem.id}" (already loaded from another file)`);
      continue;
    }

    problems.set(problem.id, problem);
  }

  if (errors.length > 0) {
    throw new Error(
      `loadProblems: ${errors.length} problem file(s) failed validation:\n\n${errors.join("\n\n")}`
    );
  }

  return problems;
}