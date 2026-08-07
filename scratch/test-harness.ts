// scratch/test-harness.ts (throwaway, not part of the real test suite yet)
import { runSubmission } from "../src/execution/harness.ts";
import { loadProblems } from "../problem-bank/loadProblems.ts";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main() {
  const problems = loadProblems();
  const twoSum = problems.get("two-sum")!;

  const goodCode = `
def solution(nums, target):
    seen = {}
    for i, n in enumerate(nums):
        if target - n in seen:
            return sorted([seen[target - n], i])
        seen[n] = i
`;

  const buggyCode = `
def solution(nums, target):
    return [0, 0]  # always wrong
`;

  const syntaxErrorCode = `
def solution(nums, target)
    return [0, 1]
`; // missing colon after function signature — deliberate syntax error

  const timeoutCode = `
def solution(nums, target):
    while True:
        pass
`; // infinite loop — should be killed by the harness's timeout

  console.log("=== Known-good submission ===");
  console.log(await runSubmission(goodCode, twoSum));

  console.log("=== Known-buggy submission ===");
  console.log(await runSubmission(buggyCode, twoSum));

  console.log("=== Syntax-error submission ===");
  console.log(await runSubmission(syntaxErrorCode, twoSum));

  console.log("=== Timeout submission ===");
  console.log(await runSubmission(timeoutCode, twoSum, 2000)); // short timeout so this doesn't hang your test run
}

main();