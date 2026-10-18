import { describe, expect, it } from "vite-plus/test";

import { ProviderDriverKind } from "@otto/contracts";

import {
  applyBotPromptCommand,
  botPromptCommandTrigger,
  providerCommandPrompt,
} from "./bot-prompt-commands.logic";

describe("botPromptCommandTrigger", () => {
  it("opens the skill picker for a $ token anywhere in the draft", () => {
    expect(botPromptCommandTrigger("please $rev", 11)).toEqual({
      kind: "skill",
      query: "rev",
      rangeStart: 7,
      rangeEnd: 11,
    });
  });

  it("opens the command picker only for a / that starts a line", () => {
    expect(botPromptCommandTrigger("/comp", 5)?.kind).toBe("slash-command");
    expect(botPromptCommandTrigger("and/or", 6)).toBeNull();
  });

  it("reads a bare /model as a command, not the classic model picker", () => {
    expect(botPromptCommandTrigger("/model", 6)).toEqual({
      kind: "slash-command",
      query: "model",
      rangeStart: 0,
      rangeEnd: 6,
    });
  });

  it("picks the name after /invite only at the start of the message", () => {
    expect(botPromptCommandTrigger("/invite @an", 11)).toEqual({
      kind: "invite",
      query: "an",
      rangeStart: 0,
      rangeEnd: 11,
    });
    expect(botPromptCommandTrigger("hi\n/invite @an", 15)?.kind).not.toBe("invite");
  });

  it("stays closed for @ mentions and plain text", () => {
    expect(botPromptCommandTrigger("ask @sc", 7)).toBeNull();
    expect(botPromptCommandTrigger("hello", 5)).toBeNull();
  });
});

describe("applyBotPromptCommand", () => {
  it("replaces the typed token and parks the caret after the inserted text", () => {
    const draft = "run $rev now";
    const trigger = botPromptCommandTrigger(draft, 8)!;
    expect(applyBotPromptCommand(draft, trigger, "$review ")).toEqual({
      text: "run $review now",
      caret: 12,
    });
  });

  it("inserts a slash command at the start of the draft", () => {
    const trigger = botPromptCommandTrigger("/co", 3)!;
    expect(applyBotPromptCommand("/co", trigger, "/compact ")).toEqual({
      text: "/compact ",
      caret: 9,
    });
  });
});

describe("providerCommandPrompt", () => {
  it("sends a prefixed provider command under its own name", () => {
    const claude = ProviderDriverKind.make("claudeAgent");

    expect(providerCommandPrompt("/claude:model opus", claude)).toBe("/model opus");
    expect(providerCommandPrompt("note\n/claude:new", claude)).toBe("note\n/new");
    expect(providerCommandPrompt("/claude:review", claude)).toBe("/claude:review");
    expect(providerCommandPrompt("/codex:model", claude)).toBe("/codex:model");
  });
});
