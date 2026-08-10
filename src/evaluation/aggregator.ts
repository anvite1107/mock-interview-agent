// combines deterministic + judged into final 
import type { ScoringResponse, CategoryScore } from "../evaluation/judged/schema.ts";
import type { SessionEvidence, TestCaseResult } from "../../src/engine/evidence.ts";
import type { RubricConfig } from "../../src/rubric/schema.ts";

export interface AggregatedCategoryScore extends CategoryScore {
  source: "judge" | "ground-truth-override";
}

export interface AggregatedResult {
  categoryScores: AggregatedCategoryScore[];
  weightedTotal: number; // 0-100
}

// categoryId -> which TestCaseResult tag grounds it
const EXECUTION_GATED: Record<string, "core" | "edge"> = {
  "code-correctness": "core",
  "edge-case-handling": "edge",
};

// Ground-truth level supported purely by execution pass rate.
// 3 is a floor, not a ceiling — judge may still award 4/5 on top of it.
function groundTruthLevel(results: TestCaseResult[], tag: "core" | "edge"): 1 | 2 | 3 {
  const tagged = results.filter((r) => r.tag === tag);
  if (tagged.length === 0) {
    // No tagged test cases exist for this session — can't ground a claim either way.
    // Treating as level 1 (most conservative) rather than silently trusting the judge.
    return 1;
  }
  const passed = tagged.filter((r) => r.passed).length;
  if (passed === 0) return 1;
  if (passed < tagged.length) return 2;
  return 3;
}

export function aggregateScores(
  judged: ScoringResponse,
  evidence: SessionEvidence,
  rubricConfig: RubricConfig
): AggregatedResult {
  const categoryScores: AggregatedCategoryScore[] = judged.categoryScores.map(
    (score): AggregatedCategoryScore => {
      const tag = EXECUTION_GATED[score.categoryId];
      if (!tag) {
        // Not execution-gated — judge's score stands as-is.
        return { ...score, source: "judge" };
      }

      const gtLevel = groundTruthLevel(evidence.executionResults, tag);

      if (gtLevel < 3 && score.score > gtLevel) {
        // Judge claimed a level unsupported by execution — override down.
        return {
          categoryId: score.categoryId,
          score: gtLevel,
          justification: `${score.justification} [Overridden: judge scored ${score.score}/5, but execution shows ${gtLevel === 1 ? "no" : "only some"} ${tag}-tagged test cases passing, which caps this category at ${gtLevel}/5 per the rubric anchors.]`,
          source: "ground-truth-override",
        };
      }

      // All tests passed, or judge's score is already <= gtLevel — trust the judge.
      return { ...score, source: "judge" };
    }
  );

  const weightById = new Map(rubricConfig.categories.map((c) => [c.id, c.weight]));
  const weightedTotal = categoryScores.reduce((sum, s) => {
    const weight = weightById.get(s.categoryId) ?? 0;
    return sum + ((s.score - 1) / 4) * weight; // normalize 1-5 -> 0-1, then apply weight
  }, 0);

  return { categoryScores, weightedTotal };
}