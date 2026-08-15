// src/cli/commands.ts
//
// Parses a line the candidate typed. Pure and separate from the session
// loop so the dispatch table is unit-testable without a TTY.

export type CandidateCommand =
  | { kind: "message"; text: string }
  | { kind: "submit" }
  | { kind: "code" }
  | { kind: "state" }
  | { kind: "help" }
  | { kind: "quit" }
  | { kind: "empty" }
  | { kind: "unknown"; name: string };

const KNOWN: Record<string, CandidateCommand> = {
  submit: { kind: "submit" },
  code: { kind: "code" },
  state: { kind: "state" },
  help: { kind: "help" },
  quit: { kind: "quit" },
  exit: { kind: "quit" },
};

/**
 * Slash-prefixed words are commands; everything else is something the
 * candidate said.
 *
 * An unrecognized slash word is NOT treated as a message. Silently
 * recording "/sbumit" as interview dialogue would put a typo in the
 * transcript and, later, in the gold corpus — where it reads as the
 * candidate actually saying that.
 */
export function parseCommand(raw: string): CandidateCommand {
  const trimmed = raw.trim();

  if (trimmed.length === 0) return { kind: "empty" };
  if (!trimmed.startsWith("/")) return { kind: "message", text: trimmed };

  const name = trimmed.slice(1).split(/\s+/)[0]!.toLowerCase();
  return KNOWN[name] ?? { kind: "unknown", name };
}

export const HELP_TEXT = [
  "  /submit   run the code in your candidate file against the test cases",
  "  /code     print the path to your candidate file again",
  "  /state    show the current interview stage",
  "  /help     show this list",
  "  /quit     end the session early (the transcript is still saved)",
  "",
  "  anything else you type is said to the interviewer.",
].join("\n");
