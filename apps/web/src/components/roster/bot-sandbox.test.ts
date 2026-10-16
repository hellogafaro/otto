import { describe, expect, it } from "vite-plus/test";

import {
  BOT_SANDBOX_OPTIONS,
  DEFAULT_BOT_RUNTIME_MODE,
  botSandboxChoice,
  botSandboxLabel,
} from "./bot-sandbox";

describe("botSandbox", () => {
  it("distinguishes an inherited sandbox from explicit Local", () => {
    expect(botSandboxChoice(null)).toBe("default");
    expect(botSandboxLabel("default")).toBe("Default sandbox");
    expect(botSandboxChoice("local")).toBe("local");
    expect(botSandboxChoice("vercel")).toBe("vercel");
  });

  it("always runs bots with full access", () => {
    expect(DEFAULT_BOT_RUNTIME_MODE).toBe("full-access");
  });

  it("lists the first sandbox providers", () => {
    expect(BOT_SANDBOX_OPTIONS.map((option) => option.value)).toEqual([
      "local",
      "e2b",
      "daytona",
      "vercel",
      "railway",
      "boat",
    ]);
    expect(botSandboxLabel("vercel")).toBe("Vercel Sandbox");
  });
});
