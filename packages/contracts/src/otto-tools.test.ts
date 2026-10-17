import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  OTTO_DELEGATION_CONTEXT_MAX_CHARS,
  OTTO_TOOL_CATALOG,
  OttoToolReceipt,
  ottoToolApprovalForInput,
  ottoToolRequiresApproval,
  decodeOttoToolInput,
  filterOttoTools,
} from "./otto-tools.ts";

describe("Otto tool contracts", () => {
  it("includes the M2-T6 catalog ids and rejects invalid inputs", () => {
    for (const id of [
      "web_search",
      "web_fetch",
      "image_create",
      "AddMcpServer",
      "UninstallMcpServer",
      "RemoveMcpAccount",
      "RenameMcpAccount",
      "SetMcpInstructions",
      "library_create",
      "library_read",
      "library_update",
      "search",
      "skill_read",
    ] as const) {
      expect(OTTO_TOOL_CATALOG.some((tool) => tool.id === id)).toBe(true);
    }

    expect(() => decodeOttoToolInput("web_search", { query: "" })).toThrow();
    expect(() => decodeOttoToolInput("web_fetch", { url: "file:///secret" })).toThrow();
    expect(() =>
      decodeOttoToolInput("image_create", { operation: "generate", prompt: "" }),
    ).toThrow();
    expect(() =>
      decodeOttoToolInput("AddMcpServer", { serverId: "x", name: "x", transport: "stdio" }),
    ).toThrow();
    expect(() =>
      decodeOttoToolInput("AddMcpServer", { serverId: "x", name: "x", transport: "url" }),
    ).toThrow();
    expect(() => decodeOttoToolInput("RenameMcpAccount", { serverId: "x" })).toThrow();
    expect(() =>
      decodeOttoToolInput("AddMcpServer", {
        serverId: "x",
        name: "x",
        transport: "url",
        url: "https://user:pass@example.com",
      }),
    ).toThrow();
  });
  it("only returns implemented tools for available computer boundaries", () => {
    expect(
      filterOttoTools({
        capabilities: new Set(["bot-workspace"]),
        workspaceType: "none",
        localFullAccess: false,
        implementedTools: new Set(["shell", "web_search"]),
      }).map((tool) => tool.id),
    ).toEqual(["web_search"]);
    expect(OTTO_TOOL_CATALOG.find((tool) => tool.id === "AuthenticateMcpServer")?.approval).toBe(
      "secrets",
    );
    expect(OTTO_TOOL_CATALOG.find((tool) => tool.id === "RestartMcpServers")?.approval).toBe(
      "production",
    );
    expect(OTTO_TOOL_CATALOG.find((tool) => tool.id === "InstallPlugin")?.approval).toBe(
      "production",
    );
    expect(OTTO_TOOL_CATALOG.find((tool) => tool.id === "UninstallPlugin")?.approval).toBe(
      "delete",
    );
    expect(OTTO_TOOL_CATALOG.find((tool) => tool.id === "connection_search")?.approval).toBe(
      "none",
    );
    expect(OTTO_TOOL_CATALOG.find((tool) => tool.id === "GetPlugin")?.approval).toBe("none");
    expect(OTTO_TOOL_CATALOG.find((tool) => tool.id === "GetMcpServerStatus")?.approval).toBe(
      "none",
    );
    expect(OTTO_TOOL_CATALOG.find((tool) => tool.id === "TestMcpServer")?.approval).toBe(
      "production",
    );
    expect(OTTO_TOOL_CATALOG.find((tool) => tool.id === "ReconnectMcpServer")?.approval).toBe(
      "production",
    );
  });

  it("accepts catalog-owned plugin inputs and rejects model-supplied recipes", () => {
    expect(decodeOttoToolInput("InstallPlugin", { pluginId: "exa" })).toEqual({
      pluginId: "exa",
    });
    expect(() =>
      decodeOttoToolInput("InstallPlugin", {
        pluginId: "exa",
        url: "https://attacker.example/mcp",
      }),
    ).toThrow();
    expect(() => decodeOttoToolInput("connection_search", { query: "web", limit: 51 })).toThrow();
  });

  it("hides delegate at delegation limits", () => {
    const context = {
      capabilities: new Set(["bot-workspace"] as const),
      workspaceType: "local" as const,
      localFullAccess: false,
      implementedTools: new Set(["delegate"]),
    };

    expect(
      filterOttoTools({ ...context, delegationDepth: 1, activeDelegations: 2 }).map(
        (tool) => tool.id,
      ),
    ).toEqual(["delegate"]);
    expect(filterOttoTools({ ...context, delegationDepth: 2, activeDelegations: 2 })).toEqual([]);
    expect(filterOttoTools({ ...context, delegationDepth: 1, activeDelegations: 3 })).toEqual([]);
  });

  it("takes only the brief, so the target bot runs with its own settings", () => {
    const input = {
      botId: "bot-research",
      task: "Compare three flights.",
      expectedResult: "A short comparison with sources.",
    };

    expect(decodeOttoToolInput("delegate", input)).toEqual(input);

    for (const policy of [
      { depth: 2 },
      { approvalCeiling: "send" },
      { allowedToolIds: ["read"] },
      { runtimeMode: "full-access" },
      { keep: true },
      { deadline: "2026-10-17T00:00:00.000Z" },
    ]) {
      expect(() => decodeOttoToolInput("delegate", { ...input, ...policy })).toThrow();
    }

    expect(OTTO_TOOL_CATALOG.find((tool) => tool.id === "delegate")?.approval).toBe("send");
  });

  it("bounds the context a bot hands to a child and rejects oversized context", () => {
    const input = {
      botId: "bot-research",
      task: "Compare three flights.",
      expectedResult: "A short comparison with sources.",
    };

    const context = "x".repeat(OTTO_DELEGATION_CONTEXT_MAX_CHARS);
    expect(decodeOttoToolInput("delegate", { ...input, context })).toMatchObject({ context });
    expect(
      decodeOttoToolInput("MessageAgent", { ...input, context: "Prefers morning flights." }),
    ).toMatchObject({ context: "Prefers morning flights." });
    expect(() => decodeOttoToolInput("delegate", { ...input, context: `${context}x` })).toThrow(
      `at most ${OTTO_DELEGATION_CONTEXT_MAX_CHARS} characters`,
    );
  });

  it("types durable bot management without bypassing send or cancellation approval", () => {
    expect(decodeOttoToolInput("bot_create", { name: "Research" })).toEqual({
      name: "Research",
    });
    expect(decodeOttoToolInput("delegate_check", { botId: "bot-research" })).toEqual({
      botId: "bot-research",
    });
    expect(decodeOttoToolInput("delegate_stop", { botId: "bot-research" })).toEqual({
      botId: "bot-research",
    });
    expect(OTTO_TOOL_CATALOG.find((tool) => tool.id === "MessageAgent")?.approval).toBe("send");
    expect(OTTO_TOOL_CATALOG.find((tool) => tool.id === "delegate_stop")?.approval).toBe("delete");
  });

  it("decodes message_post input and posts without approval", () => {
    expect(decodeOttoToolInput("message_post", { text: "The export is ready." })).toEqual({
      text: "The export is ready.",
    });
    expect(() => decodeOttoToolInput("message_post", { text: "" })).toThrow();
    expect(OTTO_TOOL_CATALOG.find((tool) => tool.id === "message_post")?.approval).toBe("none");
  });

  it("decodes only narrow bot profile fields", () => {
    expect(
      decodeOttoToolInput("bot_update", {
        name: "Researcher",
        label: null,
        description: "Checks primary sources.",
      }),
    ).toEqual({
      name: "Researcher",
      label: null,
      description: "Checks primary sources.",
    });
    expect(() => decodeOttoToolInput("bot_update", {})).toThrow();
    expect(() =>
      decodeOttoToolInput("bot_update", {
        name: "Researcher",
        botId: "another-bot",
      }),
    ).toThrow();
    expect(() =>
      decodeOttoToolInput("bot_update", {
        name: "Researcher",
        groupId: "another-group",
      }),
    ).toThrow();
  });

  it("validates message reactions and keeps them approval-gated", () => {
    const input = { messageId: "message-1", emoji: "👍", action: "add" as const };
    expect(decodeOttoToolInput("message_react", input)).toEqual(input);
    expect(() => decodeOttoToolInput("message_react", { ...input, action: "toggle" })).toThrow();
    expect(OTTO_TOOL_CATALOG.find((tool) => tool.id === "message_react")?.approval).toBe("send");
  });

  it("never lets full access bypass protected commands or paths", () => {
    const shell = OTTO_TOOL_CATALOG.find((tool) => tool.id === "shell")!;

    expect(ottoToolApprovalForInput(shell, { command: "git push origin main" })).toBe("production");
    expect(
      ottoToolRequiresApproval(
        shell,
        { localFullAccess: true },
        { command: "git push origin main" },
      ),
    ).toBe(true);
    expect(
      ottoToolRequiresApproval(shell, { localFullAccess: true }, { command: "rm -rf build" }),
    ).toBe(true);
  });

  it("decodes non-fatal typed receipts", () => {
    const decode = Schema.decodeUnknownSync(OttoToolReceipt);
    expect(
      decode({
        receiptId: "receipt-1",
        toolId: "shell",
        phase: "failure",
        threadId: "thread-1",
        createdAt: "2026-08-31T00:00:00.000Z",
      }),
    ).toMatchObject({ fatalToThread: false });
    expect(() =>
      decode({
        receiptId: "receipt-2",
        toolId: "shell",
        phase: "failure",
        threadId: "thread-1",
        fatalToThread: true,
        createdAt: "2026-08-31T00:00:00.000Z",
      }),
    ).toThrow();
  });
});
