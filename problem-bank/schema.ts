// zod schema for problem bank entries
import { z } from "zod";

export const DifficultySchema = z.enum(["easy", "medium", "hard"]);
export type Difficulty = z.infer<typeof DifficultySchema>;

export const TestCaseTagSchema = z.enum(["core", "edge"]);
export type TestCaseTag = z.infer<typeof TestCaseTagSchema>;

export const DataStructureSchema = z.enum(["flat", "tree", "linked-list"]);
export type DataStructure = z.infer<typeof DataStructureSchema>;

export const TestCaseSchema = z.object({
  id: z.string().min(1),
  input: z.array(z.unknown()),
  expectedOutput: z.unknown(),
  tag: TestCaseTagSchema,
});
export type TestCase = z.infer<typeof TestCaseSchema>;

export const ProblemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  difficulty: DifficultySchema,
  prompt: z.string().min(1),
  functionSignature: z.string().min(1),
  constraints: z.array(z.string()),
  referenceComplexity: z.object({
    time: z.string().min(1),
    space: z.string().min(1),
  }),
  inputStructures: z.array(DataStructureSchema).optional(),
  // ^ parallel to functionSignature's args, by position.
  // Omitted (undefined) means every arg is "flat" — no change needed for existing problems.
  outputStructure: DataStructureSchema.optional().default("flat"),
  testCases: z.array(TestCaseSchema).min(1),
}).superRefine((problem, ctx) => {
  const ids = new Set<string>();
  for (const tc of problem.testCases) {
    if (ids.has(tc.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate test case id "${tc.id}" in problem "${problem.id}"`,
        path: ["testCases"],
      });
    }
    ids.add(tc.id);
  }

  const hasCore = problem.testCases.some(tc => tc.tag === "core");
  const hasEdge = problem.testCases.some(tc => tc.tag === "edge");
  if (!hasCore) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Problem "${problem.id}" has no 'core' tagged test cases`,
      path: ["testCases"],
    });
  }
  if (!hasEdge) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Problem "${problem.id}" has no 'edge' tagged test cases`,
      path: ["testCases"],
    });
  }
});
export type Problem = z.infer<typeof ProblemSchema>;