import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { loadRubric } from "../src/rubric/loadRubric.ts";
import { loadProblems } from "../problem-bank/loadProblems.ts";
import { scoreSession } from "../src/evaluation/judged/scorer.ts";
import { aggregateScores } from "../src/evaluation/aggregator.ts";
import type { SessionEvidence, TranscriptEntry, TestCaseResult } from "../src/engine/evidence.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface FakeSession {
  problemId: string;
  transcript: TranscriptEntry[];
  executionResults: TestCaseResult[];
}

async function main() {
  const rubricConfig = loadRubric();
  const problems = loadProblems();

  const fixturePath = join(__dirname, "fake-transcript-buggy-edge.json");
  const fake: FakeSession = JSON.parse(readFileSync(fixturePath, "utf-8"));

  const problem = problems.get(fake.problemId);
  if (!problem) throw new Error(`Problem "${fake.problemId}" not found`);

  const evidence: SessionEvidence = {
    transcript: fake.transcript,
    executionResults: fake.executionResults,
    transitionLog: [], // not needed for scoring
  };

  console.log("Calling Gemini judge...");
  const judged = await scoreSession(evidence, problem, rubricConfig);

  console.log("\n--- RAW JUDGE SCORES ---");
  for (const c of judged.categoryScores) {
    console.log(`[${c.categoryId}] ${c.score}/5 — ${c.justification.slice(0, 100)}...`);
  }

  const aggregated = aggregateScores(judged, evidence, rubricConfig);

  console.log("\n--- AGGREGATED SCORES ---");
  for (const c of aggregated.categoryScores) {
    console.log(`[${c.categoryId}] ${c.score}/5 (source: ${c.source})`);
  }

  console.log(`\n--- WEIGHTED TOTAL: ${aggregated.weightedTotal.toFixed(1)}/100 ---`);

  const overridden = aggregated.categoryScores.filter((c) => c.source === "ground-truth-override");
  console.log(`\n${overridden.length} categor${overridden.length === 1 ? "y" : "ies"} overridden by ground truth.`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});