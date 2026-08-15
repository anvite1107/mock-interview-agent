// src/cli/turnSource.ts
//
// Where the candidate's half of a session comes from.
//
// The interview loop doesn't care whether a turn was typed by a person or
// read out of a persona script — it only needs the next line, or null when
// there are no more. Everything on the interviewer's side (probe
// generation, the state machine, the execution harness) runs identically
// either way, which is the point: a replayed session is a real session,
// not a simulation of one.

import { createInterface } from "node:readline/promises";
import { once } from "node:events";
import { stdin, stdout } from "node:process";

export interface TurnSource {
  /** The next line the candidate "typed", or null when input is exhausted.
   *  Null ends the session early — see runInterview's quitEarly handling. */
  next(): Promise<string | null>;
  close(): void;
}

/**
 * A real person at a terminal.
 *
 * rl.question() does NOT reject when readline closes — its promise simply
 * never settles. Awaiting it bare means that on Ctrl-D (or any piped
 * stdin reaching EOF) the loop parks forever, node finds an empty event
 * loop, and the process exits 0 having silently discarded the session.
 * Racing the close event turns that into an ordinary end-of-input.
 */
export function createInteractiveTurnSource(): TurnSource {
  const rl = createInterface({ input: stdin, output: stdout });

  return {
    next: () =>
      Promise.race([
        rl.question("candidate> "),
        once(rl, "close").then(() => null),
      ]),
    close: () => rl.close(),
  };
}
