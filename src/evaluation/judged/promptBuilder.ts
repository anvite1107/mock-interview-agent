// assembles rubric + transcript → Gemini prompt
import type { SessionEvidence, TranscriptEntry, TestCaseResult } from "../../engine/evidence.ts";
import type { RubricConfig } from "../../rubric/schema.ts";
import type { Problem } from "../../../problem-bank/schema.ts";

// ─── Transcript formatting ────────────────────────────────
export function formatTranscript(turns: TranscriptEntry[]): string {
  return turns
    .map((t) => `[${t.state}] ${t.speaker}: ${t.text}`)
    .join("\n");
}

// ─── Execution results formatting ─────────────────────────
export function formatExecutionResults(results: TestCaseResult[]): string {
  const core = results.filter((r) => r.tag === "core");
  const edge = results.filter((r) => r.tag === "edge");
  const corePassed = core.filter((r) => r.passed).length;
  const edgePassed = edge.filter((r) => r.passed).length;

  const lines = results.map(
    (r) => `- ${r.testCaseId} (${r.tag}): ${r.passed ? "PASSED" : "FAILED"}`
  );

  return [
    `Core test cases: ${corePassed}/${core.length} passed`,
    `Edge test cases: ${edgePassed}/${edge.length} passed`,
    "",
    "Detail:",
    ...lines,
  ].join("\n");
}

// ─── System prompt ─────────────────────────────────────────
export function buildSystemPrompt(rubricConfig: RubricConfig): string {
  return `You are an expert technical interview evaluator. You are scoring a completed coding interview transcript against a fixed rubric.

RUBRIC (JSON):
${JSON.stringify(rubricConfig, null, 2)}

INSTRUCTIONS:
1. Score all ${rubricConfig.categories.length} categories in the rubric above.
2. For EACH category, first write a "justification" — a short paragraph grounded in SPECIFIC moments from the transcript and, where relevant, the execution results provided. Only after writing the justification, assign a "score" from 1-5 using the anchor descriptions for that category.
3. Do not let strong performance in one category inflate your score in another. In particular: a candidate narrating their thought process while debugging is not the same as correctly handling the edge case they are debugging. Score edge-case handling and code correctness primarily off the execution results, not off how confidently the candidate talks.
4. Ground "edge-case handling" and "code correctness" in the provided execution results (pass/fail per test case), not just the conversation.
5. For "problem-understanding" specifically: the user message includes a numbered list of STATED CONSTRAINTS from the original problem. Before scoring, check the candidate's restatement against EACH numbered constraint individually. If the candidate's restatement omits any one of these constraints, this is a factual gap — even if the rest of their restatement sounds confident or complete. Do not assume a constraint was covered just because the candidate's overall summary sounded thorough.
6. Respond with ONLY a single JSON object, no markdown code fences, no preamble, no text outside the JSON. The JSON must match this exact shape:

{
  "categoryScores": [
    { "categoryId": "string (must match a rubric category id)", "justification": "string", "score": 1-5 }
  ]
}

Include exactly one entry per rubric category, ${rubricConfig.categories.length} total.`;
}

// ─── User message ───────────────────────────────────────────
export function buildUserMessage(evidence: SessionEvidence, problem: Problem): string {
  const constraintsList = problem.constraints
    .map((c, i) => `${i + 1}. ${c}`)
    .join("\n");

  return `PROBLEM STATEMENT (as given to the candidate):
${problem.prompt}

STATED CONSTRAINTS (enumerate and check each one against the candidate's restatement before scoring problem-understanding):
${constraintsList}

TRANSCRIPT:
${formatTranscript(evidence.transcript)}

EXECUTION RESULTS:
${formatExecutionResults(evidence.executionResults)}

Score this interview session against the rubric.`;
}