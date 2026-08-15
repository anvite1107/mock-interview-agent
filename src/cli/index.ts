#!/usr/bin/env node
// entry point for running a mock interview session
//
// Four commands, deliberately separate rather than one flow with flags:
//
//   interview [problem-id]   play a session, write a scoreless session.json
//   replay <persona-id>      play a scripted persona through the same loop
//   label <run-id>           add human gold labels, blind to agent scores
//   score <run-id>           run the agent's scoring pipeline, write report.json
//
// The split exists so labeling can happen without having seen the agent's
// output — see src/cli/label.ts.

import { argv, stderr, exit } from "node:process";
import { runInterview } from "./interview.ts";
import { runReplay } from "./replay.ts";
import { runLabel } from "./label.ts";
import { runScore } from "./score.ts";

const USAGE = [
  "Usage:",
  "  npm run interview [problem-id]   play a session (random problem if omitted)",
  "  npm run replay <persona-id>      play a persona script; --all for the corpus",
  "  npm run label <run-id>           label it by hand, before seeing agent scores",
  "  npm run score <run-id>           run the agent's scoring pipeline; --all for every run",
  "  npm run eval                     agent-vs-gold agreement across the corpus",
  "",
  "Run ids look like run-004; a path such as sessions/run-004 works too.",
].join("\n");

async function main(): Promise<void> {
  const [command, arg] = argv.slice(2);

  switch (command) {
    case "interview":
      await runInterview(arg !== undefined ? { problemId: arg } : {});
      return;

    case "replay":
      if (arg === undefined) throw new Error(`replay needs a persona id or --all.\n\n${USAGE}`);
      await runReplay(arg);
      return;

    case "label":
      if (arg === undefined) throw new Error(`label needs a run id.\n\n${USAGE}`);
      await runLabel(arg);
      return;

    case "score":
      if (arg === undefined) throw new Error(`score needs a run id or --all.\n\n${USAGE}`);
      await runScore(arg);
      return;

    default:
      throw new Error(
        command === undefined ? USAGE : `Unknown command "${command}".\n\n${USAGE}`
      );
  }
}

main().catch((err: unknown) => {
  stderr.write(`\n${err instanceof Error ? err.message : String(err)}\n\n`);
  exit(1);
});
