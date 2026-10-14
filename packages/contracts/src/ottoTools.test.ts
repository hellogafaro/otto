import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  OTTO_DELEGATION_CONTEXT_MAX_CHARS,
  OTTO_TOOL_CATALOG,
  OttoToolReceipt,
  ottoToolApprovalForInput,
  ottoToolRequiresApproval,
  copyDirectionForTool,
  decodeOttoToolInput,
  filterOttoTools,
} from "./ottoTools.ts";

describe("Otto tool contracts", () => {
  it("includes the M2-T6 catalog ids and rejects invalid inputs", () => {
    for (const id of [
      "WebSearch",
      "WebFetch",
      "GenerateImage",
      "AddMcpServer",
      "UninstallMcpServer",
      "RemoveMcpAccount",
      "RenameMcpAccount",
      "SetMcpInstructions",
      "SaveToLibrary",
      "ListLibrary",
      "ReadLibraryFile",
      "UpdateLibraryDocument",
      "ListSkills",
      "ReadSkillFile",
    ] as const) {
      expect(OTTO_TOOL_CATALOG.some((tool) => tool.id === id)).toBe(true);
    }

    expect(() => decodeOttoToolInput("WebSearch", { query: "" })).toThrow();
    expect(() => decodeOttoToolInput("WebFetch", { url: "file:///secret" })).toThrow();
    expect(() =>
      decodeOttoToolInput("GenerateImage", { operation: "generate", prompt: "" }),
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
  it("validates copy direction and rejects incomplete input", () => {
    expect(copyDirectionForTool("CopyToBox")).toEqual({
      from: "user-computer",
      to: "bot-workspace",
    });
    expect(copyDirectionForTool("CopyFromBox")).toEqual({
      from: "bot-workspace",
      to: "user-computer",
    });
    expect(() => decodeOttoToolInput("CopyToBox", { path: "/tmp/report" })).toThrow();
  });

  it("only returns implemented tools for available computer boundaries", () => {
    expect(
      filterOttoTools({
        capabilities: new Set(["bot-workspace", "user-computer"]),
        workspaceType: "local",
        hasUserComputer: false,
        localFullAccess: false,
        implementedTools: new Set(["Shell", "ExternalShell", "CopyToBox"]),
      }).map((tool) => tool.id),
    ).toEqual(["Shell"]);
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
    expect(OTTO_TOOL_CATALOG.find((tool) => tool.id === "SearchPlugins")?.approval).toBe("none");
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
    expect(() => decodeOttoToolInput("SearchPlugins", { query: "web", limit: 51 })).toThrow();
  });

  it("hides SendToAgent at delegation limits", () => {
    const context = {
      capabilities: new Set(["bot-workspace"] as const),
      workspaceType: "local" as const,
      hasUserComputer: false,
      localFullAccess: false,
      implementedTools: new Set(["SendToAgent"]),
    };

    expect(
      filterOttoTools({ ...context, delegationDepth: 1, activeDelegations: 2 }).map(
        (tool) => tool.id,
      ),
    ).toEqual(["SendToAgent"]);
    expect(filterOttoTools({ ...context, delegationDepth: 2, activeDelegations: 2 })).toEqual([]);
    expect(filterOttoTools({ ...context, delegationDepth: 1, activeDelegations: 3 })).toEqual([]);
  });

  it("hides Task inside a worker and validates worker inputs", () => {
    const context = {
      capabilities: new Set(["bot-workspace"] as const),
      workspaceType: "local" as const,
      hasUserComputer: false,
      localFullAccess: false,
      implementedTools: new Set(["Task", "CheckSubagent", "MessageSubagent", "StopSubagent"]),
    };

    expect(filterOttoTools({ ...context, workerDepth: 0 }).map((tool) => tool.id)).toEqual([
      "Task",
      "CheckSubagent",
      "MessageSubagent",
      "StopSubagent",
    ]);
    expect(filterOttoTools({ ...context, workerDepth: 1 }).map((tool) => tool.id)).toEqual([
      "CheckSubagent",
      "MessageSubagent",
      "StopSubagent",
    ]);

    for (const toolId of ["Task", "CheckSubagent", "MessageSubagent", "StopSubagent"] as const) {
      expect(OTTO_TOOL_CATALOG.find((tool) => tool.id === toolId)?.approval).toBe("none");
    }

    expect(decodeOttoToolInput("Task", { task: "Summarize", background: true })).toEqual({
      task: "Summarize",
      background: true,
    });
    expect(() => decodeOttoToolInput("Task", { task: "  " })).toThrow();
    expect(() => decodeOttoToolInput("CheckSubagent", {})).toThrow();
    expect(() => decodeOttoToolInput("MessageSubagent", { workerId: "worker-1" })).toThrow();
  });

  it("decodes the approval limit and keeps escalation fields server-owned", () => {
    const input = {
      botId: "bot-research",
      task: "Compare three flights.",
      expectedResult: "A short comparison with sources.",
      approvalCeiling: "send" as const,
    };

    expect(decodeOttoToolInput("SendToAgent", input)).toMatchObject(input);
    expect(() => decodeOttoToolInput("SendToAgent", { ...input, depth: 2 })).toThrow();
    expect(() =>
      decodeOttoToolInput("SendToAgent", {
        ...input,
        hasUserComputer: true,
      }),
    ).toThrow();
    expect(OTTO_TOOL_CATALOG.find((tool) => tool.id === "SendToAgent")?.approval).toBe("send");
  });

  it("bounds the context a bot hands to a child and rejects oversized context", () => {
    const input = {
      botId: "bot-research",
      task: "Compare three flights.",
      expectedResult: "A short comparison with sources.",
    };

    const context = "x".repeat(OTTO_DELEGATION_CONTEXT_MAX_CHARS);
    expect(decodeOttoToolInput("SendToAgent", { ...input, context })).toMatchObject({ context });
    expect(
      decodeOttoToolInput("MessageAgent", { ...input, context: "Prefers morning flights." }),
    ).toMatchObject({ context: "Prefers morning flights." });
    expect(() => decodeOttoToolInput("SendToAgent", { ...input, context: `${context}x` })).toThrow(
      `at most ${OTTO_DELEGATION_CONTEXT_MAX_CHARS} characters`,
    );
  });

  it("types durable bot management without bypassing send or cancellation approval", () => {
    expect(decodeOttoToolInput("CreateAgent", { name: "Research" })).toEqual({
      name: "Research",
    });
    expect(decodeOttoToolInput("CheckAgent", { botId: "bot-research" })).toEqual({
      botId: "bot-research",
    });
    expect(decodeOttoToolInput("StopAgent", { botId: "bot-research" })).toEqual({
      botId: "bot-research",
    });
    expect(OTTO_TOOL_CATALOG.find((tool) => tool.id === "MessageAgent")?.approval).toBe("send");
    expect(OTTO_TOOL_CATALOG.find((tool) => tool.id === "StopAgent")?.approval).toBe("delete");
  });

  it("decodes SendToUser input and keeps it approval-gated", () => {
    expect(decodeOttoToolInput("SendToUser", { message: "The export is ready." })).toEqual({
      message: "The export is ready.",
    });
    expect(() => decodeOttoToolInput("SendToUser", { message: "" })).toThrow();
    expect(OTTO_TOOL_CATALOG.find((tool) => tool.id === "SendToUser")?.approval).toBe("send");
  });

  it("decodes only narrow bot profile fields", () => {
    expect(
      decodeOttoToolInput("UpdateBotProfile", {
        name: "Researcher",
        label: null,
        description: "Checks primary sources.",
      }),
    ).toEqual({
      name: "Researcher",
      label: null,
      description: "Checks primary sources.",
    });
    expect(() => decodeOttoToolInput("UpdateBotProfile", {})).toThrow();
    expect(() =>
      decodeOttoToolInput("UpdateBotProfile", {
        name: "Researcher",
        botId: "another-bot",
      }),
    ).toThrow();
    expect(() =>
      decodeOttoToolInput("UpdateBotProfile", {
        name: "Researcher",
        groupId: "another-group",
      }),
    ).toThrow();
  });

  it("validates message reactions and keeps them approval-gated", () => {
    const input = { messageId: "message-1", emoji: "👍", action: "add" as const };
    expect(decodeOttoToolInput("ReactToMessage", input)).toEqual(input);
    expect(() => decodeOttoToolInput("ReactToMessage", { ...input, action: "toggle" })).toThrow();
    expect(OTTO_TOOL_CATALOG.find((tool) => tool.id === "ReactToMessage")?.approval).toBe("send");
  });

  it("never lets full access bypass protected commands or paths", () => {
    const shell = OTTO_TOOL_CATALOG.find((tool) => tool.id === "ExternalShell")!;
    const read = OTTO_TOOL_CATALOG.find((tool) => tool.id === "ExternalRead")!;
    const copyFromBox = OTTO_TOOL_CATALOG.find((tool) => tool.id === "CopyFromBox")!;

    const copyInput = {
      sourcePath: "/project/.env",
      destinationPath: "/tmp/exported-env",
    };

    expect(ottoToolApprovalForInput(shell, { command: "git push origin main" })).toBe("production");
    expect(
      ottoToolRequiresApproval(
        shell,
        { localFullAccess: true },
        { command: "git push origin main" },
      ),
    ).toBe(true);
    expect(
      ottoToolRequiresApproval(read, { localFullAccess: true }, { path: "/project/.env" }),
    ).toBe(true);
    expect(ottoToolApprovalForInput(copyFromBox, copyInput)).toBe("secrets");
    expect(ottoToolRequiresApproval(copyFromBox, { localFullAccess: true }, copyInput)).toBe(true);
  });

  it("decodes non-fatal typed receipts", () => {
    const decode = Schema.decodeUnknownSync(OttoToolReceipt);
    expect(
      decode({
        receiptId: "receipt-1",
        toolId: "Shell",
        phase: "failure",
        threadId: "thread-1",
        createdAt: "2026-08-31T00:00:00.000Z",
      }),
    ).toMatchObject({ fatalToThread: false });
    expect(() =>
      decode({
        receiptId: "receipt-2",
        toolId: "Shell",
        phase: "failure",
        threadId: "thread-1",
        fatalToThread: true,
        createdAt: "2026-08-31T00:00:00.000Z",
      }),
    ).toThrow();
  });
});
