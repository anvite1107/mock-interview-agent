import { describe, it, expect } from "vitest";
import { parseCommand } from "../../src/cli/commands.ts";

describe("parseCommand", () => {
  it("treats plain text as something the candidate said", () => {
    expect(parseCommand("can the array be empty?")).toEqual({
      kind: "message",
      text: "can the array be empty?",
    });
  });

  it("trims surrounding whitespace off a message", () => {
    expect(parseCommand("   thinking out loud   ")).toEqual({
      kind: "message",
      text: "thinking out loud",
    });
  });

  it("reports a blank line as empty rather than an empty message", () => {
    expect(parseCommand("")).toEqual({ kind: "empty" });
    expect(parseCommand("    ")).toEqual({ kind: "empty" });
  });

  it.each([
    ["/submit", "submit"],
    ["/code", "code"],
    ["/state", "state"],
    ["/help", "help"],
    ["/quit", "quit"],
  ])("recognizes %s", (input, kind) => {
    expect(parseCommand(input).kind).toBe(kind);
  });

  it("accepts /exit as an alias for /quit", () => {
    expect(parseCommand("/exit")).toEqual({ kind: "quit" });
  });

  it("is case-insensitive on command names", () => {
    expect(parseCommand("/SUBMIT")).toEqual({ kind: "submit" });
  });

  it("ignores trailing arguments on a command", () => {
    expect(parseCommand("/submit now please")).toEqual({ kind: "submit" });
  });

  it("reports an unknown slash word instead of recording it as dialogue", () => {
    // A typo'd command must never reach the transcript — it would read as
    // the candidate actually saying "/sbumit" in the gold corpus.
    expect(parseCommand("/sbumit")).toEqual({ kind: "unknown", name: "sbumit" });
  });

  it("treats a mid-sentence slash as ordinary text", () => {
    expect(parseCommand("it's O(n) time / O(n) space")).toEqual({
      kind: "message",
      text: "it's O(n) time / O(n) space",
    });
  });
});
