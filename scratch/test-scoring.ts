import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { z } from "zod";
import { loadRubric } from "../src/rubric/loadRubric.ts";
import {env} from "process";
import { loadProblems } from "../problem-bank/loadProblems.ts"; // adjust path if loadProblems lives elsewhere
import type { Problem } from "../problem-bank/schema.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// --- Minimal output schema for THIS scratch script only. ---
// Day 10-11 is where this gets formalized into src/judge/schema.ts
// alongside the real rubric.config.json category ids. Kept inline
// and minimal here on purpose (see: prematurely adding fields note
// from the design discussion) — we're validating the core judging
// behavior first, not the schema shape.
const CategoryScoreSchema = z.object({
  categoryId: z.string(),
  justification: z.string(),
  score: z.number().int().min(1).max(5),
});

const ScoringResponseSchema = z.object({
  categoryScores: z.array(CategoryScoreSchema).length(6),
});

type ScoringResponse = z.infer<typeof ScoringResponseSchema>;

interface TranscriptTurn {
  speaker: "interviewer" | "candidate";
  state: string;
  text: string;
}

interface TestCaseResult {
  testCaseId: string;
  tag: "core" | "edge";
  passed: boolean;
}

interface FakeSession {
  problemId: string;
  transcript: TranscriptTurn[];
  executionResults: TestCaseResult[];
}

function formatTranscript(turns: TranscriptTurn[]): string {
  return turns
    .map((t) => `[${t.state}] ${t.speaker}: ${t.text}`)
    .join("\n");
}

function formatExecutionResults(results: TestCaseResult[]): string {
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

function buildSystemPrompt(rubricConfig: unknown): string {
  return `You are an expert technical interview evaluator. You are scoring a completed coding interview transcript against a fixed rubric.

RUBRIC (JSON):
${JSON.stringify(rubricConfig, null, 2)}

INSTRUCTIONS:
1. Score all 6 categories in the rubric above.
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

Include exactly one entry per rubric category, 6 total.`;
}

function buildUserMessage(session: FakeSession, problem: Problem): string {
  const constraintsList = problem.constraints
    .map((c, i) => `${i + 1}. ${c}`)
    .join("\n");

  return `PROBLEM STATEMENT (as given to the candidate):
${problem.prompt}

STATED CONSTRAINTS (enumerate and check each one against the candidate's restatement before scoring problem-understanding):
${constraintsList}

TRANSCRIPT:
${formatTranscript(session.transcript)}

EXECUTION RESULTS:
${formatExecutionResults(session.executionResults)}

Score this interview session against the rubric.`;
}

function stripJsonFences(text: string): string {
  return text.replace(/```json|```/g, "").trim();
}

async function callGemini(
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is not set");
  }

  // Verify this is still the current model name in Google AI Studio —
  // Gemini model naming/versions shift more frequently than Anthropic's.
  const model = "gemini-3.6-flash";

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: {
        parts: [{ text: systemPrompt }],
      },
      contents: [
        {
          role: "user",
          parts: [{ text: userMessage }],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.2, // low temp: we want consistent, anchor-grounded judging, not creative variance
      },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`API error ${response.status}: ${errText}`);
  }

  const data = await response.json();

  const candidate = data.candidates?.[0];
  if (!candidate) {
    throw new Error(`No candidate in response: ${JSON.stringify(data)}`);
  }

  // Gemini can return a finishReason other than "STOP" (e.g. "MAX_TOKENS",
  // "SAFETY") — worth surfacing explicitly rather than silently returning
  // truncated/empty JSON that fails schema validation with a confusing error.
  if (candidate.finishReason && candidate.finishReason !== "STOP") {
    console.warn(`Warning: finishReason was "${candidate.finishReason}"`);
  }

  const text = candidate.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error(`No text in candidate: ${JSON.stringify(candidate)}`);
  }
  return text;
}

async function main() {
  console.log("Loading rubric...");
  const rubricConfig = loadRubric();

  console.log("Loading problems...");
  const problems = loadProblems(); // Map<string, Problem>

  console.log("Loading fake transcript...");
  const fakeSessionPath = join(__dirname, "fake-transcript.json");
  const fakeSession: FakeSession = JSON.parse(
    readFileSync(fakeSessionPath, "utf-8")
  );

  const problem = problems.get(fakeSession.problemId);
  if (!problem) {
    throw new Error(`Problem "${fakeSession.problemId}" not found in problem bank`);
  }

  const systemPrompt = buildSystemPrompt(rubricConfig);
  const userMessage = buildUserMessage(fakeSession, problem);

  console.log("Calling Gemini for scoring...");
  const rawResponse = await callGemini(systemPrompt, userMessage);

  // ... rest unchanged

  console.log("\n--- RAW RESPONSE ---");
  console.log(rawResponse);

  const cleaned = stripJsonFences(rawResponse);

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    console.error("\nFailed to parse JSON from response:", err);
    process.exit(1);
  }

  const result = ScoringResponseSchema.safeParse(parsed);
  if (!result.success) {
    console.error("\nSchema validation failed:");
    console.error(result.error.format());
    process.exit(1);
  }

  console.log("\n--- VALIDATED SCORES ---");
  for (const cat of result.data.categoryScores) {
    console.log(`\n[${cat.categoryId}] Score: ${cat.score}/5`);
    console.log(cat.justification);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});