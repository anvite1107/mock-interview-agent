# Mock Interview Agent

An agent that runs a technical coding interview end to end — asks clarifying
questions, probes when an answer is thin, runs the candidate's code against real test
cases, and scores the session against a weighted rubric.

The part worth arguing about is the scoring. An LLM asked to grade an interview will
agree with whatever it just read, so two things push against that:

- **Execution is ground truth.** Code correctness and edge-case handling are gated on
  actual Python test results, not on the judge's opinion. If the judge awards 4/5 for
  correctness on code that fails core tests, the aggregator overrides it down and says
  so in the justification (`src/evaluation/aggregator.ts`).
- **Justification comes before the score.** Both the judge prompt and the human
  labeling CLI require writing the reasoning first. A number chosen first tends to get
  justified after the fact — by a person as much as by a model.

Whether any of that works is an empirical question, which is what the eval harness is
for: it measures how often the agent's scores agree with hand-written human labels.

## Setup

```bash
npm install
echo "GEMINI_API_KEY=your-key-here" > .env
```

Python 3 must be on PATH — the execution harness shells out to it.

> **Quota — read this before generating the corpus.** The Gemini free tier caps requests
> at roughly **4–5 per minute and 20 per day, per model**. One interview makes 10–15
> calls, so a free key buys about **1.5 sessions a day**; the 18-session corpus needs
> ~200 calls. Measured on `gemini-3.6-flash` and `gemini-3.7-flash` — same 20/day
> allowance on both, so switching models does not get around it. **Generating the corpus
> requires billing enabled on the Google Cloud project** (~200 flash-tier calls, i.e.
> cents).
>
> `callGemini` does what it can either way: it paces calls below the per-minute limit
> (`GEMINI_MAX_RPM`, default 4) and retries 429/5xx honouring the API's own `retryDelay`.
> Neither helps against a daily cap. `GEMINI_MODEL` overrides the model.

## Commands

```bash
npm run interview [problem-id]   # play a session yourself
npm run replay <persona-id>      # play a scripted persona; --all for the whole corpus
npm run label:order              # runs still needing labels, in shuffled order
npm run label <run-id>           # hand-label a session, blind to agent scores
npm run score <run-id>           # run the scoring pipeline; --all for every run
npm run eval                     # agent-vs-gold agreement across the corpus
```

Each run writes to `sessions/run-NNN/`:

| file           | written by             | contains                                  |
| -------------- | ---------------------- | ----------------------------------------- |
| `candidate.py` | you, or a persona      | the code under test                       |
| `session.json` | `interview` / `replay` | transcript + submissions, **no scores**   |
| `gold.json`    | `label`                | human scores + justifications             |
| `report.json`  | `score`                | agent scores + justifications             |

`session.json` carrying no scores is a design constraint, not an oversight. It's the
shared input to two things that must not see each other's answers — the human labeler
and the agent scorer. `label` never reads `report.json` even when one exists.

## The evaluation corpus

`eval-harness/personas/` holds 18 scripted candidates covering all 11 problems, spanning
strong, mixed, weak, and abandoned-partway sessions. Replaying one drives the **real**
engine — real Gemini probes, real Python execution, real state transitions — with only
the candidate's turns predetermined.

A persona describes behavior and nothing else:

```jsonc
{
  "id": "hedges-then-recovers",
  "problemId": "two-sum",
  "notes": "Hedges constantly. First submission's inner loop starts at i, so an
            element can pair with itself. Diagnoses it correctly from the failure
            output and rewrites as a hash map.",
  "turns": [ { "kind": "say", ... }, { "kind": "code", ... }, { "kind": "submit" } ]
}
```

There are deliberately **no target scores** anywhere in a persona file. Recording one
would make labeling an act of recall rather than a reading of the transcript.

To sanity-check the corpus without spending an hour of API calls:

```bash
npx tsx scratch/verify-corpus.ts   # core/edge tallies for every persona's code
```

### Known limitation: the labels are author-generated

The person who writes the persona scripts also writes the gold labels, so a gold label
is partly recall of authorial intent rather than a fully independent reading of the
evidence. **The agreement figure this produces is an upper bound.**

The protection the architecture was built for is intact — the labeler never sees the
agent's scores. What's weakened is different: when the agent and the label disagree,
there are two explanations and they're hard to tell apart. Either the agent misread the
transcript, or the transcript doesn't actually exhibit what its author meant it to and
the agent read it correctly.

Four things blunt this, and the fourth is just honesty:

1. Persona files record behavior, never target scores.
2. Author the corpus first, label later, on a different day and in shuffled run order.
3. `label` renders only the transcript and execution summary — the same view the judge
   gets. Persona files stay out of that path entirely.
4. This section exists.

The cheap check on whether it mattered: hand-play two or three sessions with
`npm run interview` and compare agreement on those against the scripted fifteen. A sharp
divergence means the authored corpus is flattering the agent.

## Measuring agreement

```bash
npm run replay -- --all    # generate the corpus
npm run label:order        # what to label next, shuffled — work down this list
npm run label run-007      # ... repeat, ideally on a different day than authoring
npm run score -- --all
npm run eval
```

`label:order` exists because labeling sequentially is labeling in authoring order, which
is where recall of what each persona was written to do is strongest. It shuffles from a
fixed seed and drops runs already labeled, so re-running it mid-session continues the
same sequence rather than reshuffling.

`eval` reports, per rubric category and overall:

- **exact agreement** — agent and human picked the same 1–5 level
- **within-1 agreement** — they picked adjacent levels

Within-1 carries most of the signal. On a five-point rubric two careful graders
routinely land one level apart on the same evidence, so exact agreement alone understates
a judge that is working. A large gap between the two rates is itself a finding: the judge
has the right shape but is reading the anchors half a level off, which is an
anchor-wording problem rather than a judging problem.

Runs missing a gold label or a report are **excluded and listed**, never silently
dropped — a quietly shrinking denominator is the easiest way to publish a flattering
number by accident.

Every run also writes `eval-harness/results/eval-<timestamp>.json`, carrying the full
per-pair comparison: both scores, the signed delta, and both justifications side by side.
That file is the input to anchor tuning — percentages say how many categories disagreed,
not which ones or why. Keeping the files lets a tuning pass be diffed against its
baseline, so a reworded anchor can be shown to have helped rather than just moved the
disagreements somewhere else.

`gold.json` records which rubric categories it was written against, so re-scoring after
a rubric change warns instead of silently comparing labels from two different rubrics.

## Layout

```
problem-bank/     11 problems, each with 6-8 core/edge test cases
src/rubric/       6 weighted categories with per-level anchor descriptions
src/execution/    sandboxed Python runner (subprocess, timeout, output capture)
src/engine/       interview state machine, probe generation, advance detection
src/evaluation/   LLM judge + the aggregator that lets execution override it
src/report/       session report generation
src/cli/          interview / replay / label / score commands
eval-harness/     personas, gold-label schema, agreement metrics, runEval
```

The interview walks a fixed sequence of states — problem intro, clarifying questions,
coding, testing and debugging, complexity discussion, wrap-up. Most transitions are
mechanical (any message advances the intro; any submission advances coding); the ones
that need judgment call an LLM, and per-state probe caps stop a stage from stalling.
