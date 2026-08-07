// src/execution/harness.ts

import { spawn } from "child_process";
import { writeFile, mkdtemp, rm } from "fs/promises";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { tmpdir } from "os";
import type { Problem, TestCase, DataStructure } from "../../problem-bank/schema.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);


export interface ExecutionRequest {
  candidateCode: string;
  testCase: TestCase;
  inputStructures: DataStructure[] | undefined;   
  outputStructure: DataStructure | undefined;      
  timeoutMs: number;
}

export interface ExecutionResult {
  testCaseId: string;
  tag: "core" | "edge";
  passed: boolean;
  actualOutput?: unknown;                          
  error: {
    type: "timeout" | "runtime-error" | "syntax-error" | "wrong-output";
    message: string;
  } | undefined;                                    
  executionTimeMs: number;
}

const RUNNER_PATH = join(__dirname, "runner.py");

/**
 * Runs a candidate submission against every test case for a problem.
 * Performs a single syntax precheck first; if that fails, every test case
 * is returned as a syntax-error without spawning per-test-case processes.
 */
export async function runSubmission(
  candidateCode: string,
  problem: Problem,
  timeoutMs: number = 5000
): Promise<ExecutionResult[]> {
  const tempDir = await mkdtemp(join(tmpdir(), "mock-interview-"));
  const candidatePath = join(tempDir, "candidate.py");

  try {
    await writeFile(candidatePath, candidateCode, "utf-8");

    const syntaxError = await checkSyntax(candidatePath, timeoutMs);
    if (syntaxError) {
      return problem.testCases.map(tc => ({
        testCaseId: tc.id,
        tag: tc.tag,
        passed: false,
        error: { type: "syntax-error" as const, message: syntaxError },
        executionTimeMs: 0,
      }));
    }

    const results: ExecutionResult[] = [];
    for (const testCase of problem.testCases) {
      const result = await runTestCase({
        candidateCode,
        testCase,
        inputStructures: problem.inputStructures,
        outputStructure: problem.outputStructure,
        timeoutMs,
      }, candidatePath);
      results.push(result);
    }

    return results;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function checkSyntax(candidatePath: string, timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    const proc = spawn("python3", ["-m", "py_compile", candidatePath], {
      timeout: timeoutMs,
    });

    let stderr = "";
    proc.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

    proc.on("close", (code) => {
      resolve(code === 0 ? null : stderr.trim() || "Syntax check failed");
    });

    proc.on("error", (err) => {
      resolve(`Failed to run syntax check: ${err.message}`);
    });
  });
}

function runTestCase(
  request: ExecutionRequest,
  candidatePath: string
): Promise<ExecutionResult> {
  return new Promise((resolve) => {
    const startTime = Date.now();

    const proc = spawn("python3", [RUNNER_PATH, candidatePath], {
      timeout: request.timeoutMs,
      cwd: join(__dirname), // so runner.py can import deserialize.py via relative import
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    proc.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

    proc.on("error", (err) => {
      resolve({
        testCaseId: request.testCase.id,
        tag: request.testCase.tag,
        passed: false,
        error: { type: "runtime-error", message: `Failed to spawn process: ${err.message}` },
        executionTimeMs: Date.now() - startTime,
      });
    });

    proc.on("close", (code, signal) => {
      const executionTimeMs = Date.now() - startTime;

      if (signal === "SIGTERM" || code === null) {
        resolve({
          testCaseId: request.testCase.id,
          tag: request.testCase.tag,
          passed: false,
          error: { type: "timeout", message: `Execution exceeded ${request.timeoutMs}ms` },
          executionTimeMs,
        });
        return;
      }

      let parsed: { output?: unknown; error?: { type: string; message: string }; candidateStdout?: string };
      try {
        parsed = JSON.parse(stdout.trim());
      } catch {
        resolve({
          testCaseId: request.testCase.id,
          tag: request.testCase.tag,
          passed: false,
          error: {
            type: "runtime-error",
            message: `Failed to parse runner output. stdout: ${stdout} stderr: ${stderr}`,
          },
          executionTimeMs,
        });
        return;
      }

      if (parsed.error) {
        resolve({
          testCaseId: request.testCase.id,
          tag: request.testCase.tag,
          passed: false,
          error: { type: "runtime-error", message: parsed.error.message },
          executionTimeMs,
        });
        return;
      }

      const passed = deepEqual(parsed.output, request.testCase.expectedOutput);
      resolve({
        testCaseId: request.testCase.id,
        tag: request.testCase.tag,
        passed,
        actualOutput: parsed.output,
        error: passed
          ? undefined
          : { type: "wrong-output", message: `Expected ${JSON.stringify(request.testCase.expectedOutput)}, got ${JSON.stringify(parsed.output)}` },
        executionTimeMs,
      });
    });

    // stdin: send the test case input + structure metadata to the runner
    proc.stdin.write(JSON.stringify({
      input: request.testCase.input,
      inputStructures: request.inputStructures,
      outputStructure: request.outputStructure,
    }));
    proc.stdin.end();
  });
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}