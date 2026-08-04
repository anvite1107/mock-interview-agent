// validate rubric.config.json against schema, independence checks
// tests/rubric/schema.test.ts
import { describe, it, expect } from "vitest";
import { RubricConfigSchema, RubricCategorySchema } from "../../src/rubric/schema.js";
import rubricConfig from "../../src/rubric/rubric.config.json" with { type: "json" } ;

// A minimal valid category, so each bad-case test only has to break ONE field
// and doesn't also fail for unrelated reasons.
const baseCategory = {
  id: "test-category",
  label: "Test Category",
  weight: 100,
  groundedBy: "stated-words",
  anchors: {
    1: "Level 1 anchor text",
    2: "Level 2 anchor text",
    3: "Level 3 anchor text",
    4: "Level 4 anchor text",
    5: "Level 5 anchor text",
  },
};

describe("GroundedBySchema (via RubricCategorySchema)", () => {
  it("rejects a groundedBy value outside the fixed 6-value enum", () => {
    const badCategory = { ...baseCategory, groundedBy: "vibes" };

    const result = RubricCategorySchema.safeParse(badCategory);

    expect(result.success).toBe(false);
    if (!result.success) {
      // assert on the actual issue, not just that parsing failed —
      // otherwise this test would still pass if a different field broke first
      const issue = result.error.issues.find((i) => i.path.includes("groundedBy"));
      expect(issue).toBeDefined();
      expect(issue?.message).toMatch(/invalid option/i); // adjust to your zod version's actual message
    }
  });
});

describe("RubricCategorySchema.id (kebab-case)", () => {
  it("rejects an id with spaces or uppercase, e.g. 'Problem Understanding'", () => {
    const badCategory = { ...baseCategory, id: "Problem Understanding" };

    const result = RubricCategorySchema.safeParse(badCategory);

    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.includes("id"));
      expect(issue).toBeDefined();
      expect(issue?.message).toMatch(/kebab-case/i);
    }
  });
  // same shape as above: safeParse a baseCategory with a bad `id`,
  // assert success:false, find the issue where path includes "id",
  // assert message matches your regex-failure message
});

describe("AnchorsSchema completeness", () => {
  it("rejects a category missing anchor level 3", () => {
    // destructure out key "3" into a throwaway var, keep the rest
    const { 3: _omitted, ...remainingAnchors } = baseCategory.anchors;

    const badCategory = { ...baseCategory, anchors: remainingAnchors };

    const result = RubricCategorySchema.safeParse(badCategory);

    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.includes("anchors"));
      expect(issue).toBeDefined();
      // confirm the real zod message before trusting this — likely something
      // like "Required" with path ["anchors", "3"]
    }
  });
});

describe("RubricConfigSchema — weight sum", () => {
  it("rejects categories whose weights sum to 97, not 100", () => {
    const badConfig = { categories: [
        { ...baseCategory, weight: 50 },
        { ...baseCategory, id: "another-category", weight: 47 },
      ],
    };

    const result = RubricConfigSchema.safeParse(badConfig);

    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.includes("categories"));
      expect(issue).toBeDefined();
      expect(issue?.message).toMatch(/sum to 100/i);
    }
  });
  // same shape as above: build { categories: [...] } with weights that don't sum to 100,
  // safeParse against RubricConfigSchema, assert failure,
  // assert the superRefine issue message contains something like "sum to 100"
});
  
describe("RubricConfigSchema — unique ids", () => {
  it("rejects two categories sharing the same id", () => {
    const badConfig = { categories: [
        { ...baseCategory, id: "communication", weight: 50 },
        { ...baseCategory, id: "communication", weight: 50 },
      ],
    };
    const result = RubricConfigSchema.safeParse(badConfig);

    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.includes("categories"));
      expect(issue).toBeDefined();
      expect(issue?.message).toMatch(/unique/i);
    }
  });
  // two categories both with id: "communication", safeParse, assert failure,
  // assert the superRefine issue message contains "duplicate" (or whatever yours says)
});


describe("RubricConfigSchema — happy path", () => {
  it("accepts the real rubric.config.json as valid", () => {
    const result = RubricConfigSchema.safeParse(rubricConfig);

    expect(result.success).toBe(true);
    // this is the assertion your smoke test never actually made —
    // now it's a real regression check, not just eyeballed console output
  });
});