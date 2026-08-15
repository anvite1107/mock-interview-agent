// scratch/probe-quota.ts
//
// Asks each candidate model for one token and reports what came back:
// usable, retired, or which quota is exhausted and at what limit.
//
// Exists because Gemini's free-tier limits are per-model and undocumented
// at the point of use — the only reliable way to find out whether a model
// can generate the eval corpus is to ask it. Costs one request per model
// against that model's own daily allowance.
//
//   npx tsx --env-file-if-exists=.env scratch/probe-quota.ts

const MODELS = [
  "gemini-3.6-flash",
  "gemini-3.7-flash",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-3-flash-preview",
  "gemini-flash-latest",
  "gemini-flash-lite-latest",
  "gemini-2.5-flash-lite",
  "gemma-4-31b-it",
  "gemma-4-26b-a4b-it",
];

interface QuotaViolation {
  quotaId?: string;
  quotaValue?: string;
}

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

for (const model of MODELS) {
  const label = model.padEnd(26);

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: "say ok" }] }],
        }),
      }
    );

    if (response.ok) {
      console.log(`${label} OK — usable, quota available`);
    } else {
      const body = (await response.json()) as {
        error?: { message?: string; details?: Array<{ violations?: QuotaViolation[] }> };
      };
      const violation = body.error?.details?.find((d) => d.violations)?.violations?.[0];

      if (violation) {
        const kind = (violation.quotaId ?? "")
          .replace("GenerateRequests", "")
          .replace("PerProjectPerModel-FreeTier", "");
        console.log(`${label} ${response.status} ${kind} limit=${violation.quotaValue}`);
      } else {
        console.log(`${label} ${response.status} ${(body.error?.message ?? "").slice(0, 60)}`);
      }
    }
  } catch (err) {
    console.log(`${label} request failed: ${(err as Error).message}`);
  }

  // Spaced out so the per-minute cap doesn't mask the per-day answer.
  await new Promise((r) => setTimeout(r, 4000));
}
