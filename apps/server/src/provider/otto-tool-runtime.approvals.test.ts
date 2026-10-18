import { describe } from "vite-plus/test";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { BotId, type OttoToolReceipt } from "@otto/contracts";
import { createOttoToolRuntime } from "./otto-tool-runtime.ts";
import { makeOttoToolRuntimeTestSupport } from "./test-support/otto-tool-runtime.ts";

const { directories, workspace, workspaceRoot } = makeOttoToolRuntimeTestSupport();

vi.mock("@mastra/core/workspace", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mastra/core/workspace")>();

  return { ...actual, createWorkspaceTools: vi.fn(actual.createWorkspaceTools) };
});

describe("OttoToolRuntime", () => {
  afterEach(() => {
    for (const directory of directories) {
      NodeFS.rmSync(directory, { force: true, recursive: true });
    }

    directories.clear();
  });

  it("exposes one direct, approval-free memory tool", async () => {
    const memory = vi.fn(async () => ({ saved: true }));
    const runtime = createOttoToolRuntime();
    runtime.registerSession("thread-memory", {
      runtimeMode: "full-access",
      workspaceType: "none",
      memoryHandlers: {
        memory_update: memory,
      },
    });

    expect(runtime.toolsForThread("thread-memory").map((tool) => tool.id)).toEqual([
      "memory_update",
    ]);

    const write = {
      threadId: "thread-memory",
      toolId: "memory_update" as const,
      toolCallId: "memory-write",
      input: { changes: [{ action: "add", id: null, scope: "person", text: "Prefers vim." }] },
      approvalMode: "require-grant" as const,
    };

    await expect(
      runtime.requiresApproval("thread-memory", "memory_update", write.input),
    ).resolves.toBe(false);
    await expect(runtime.execute(write)).resolves.toEqual({ saved: true });
    expect(memory).toHaveBeenCalledOnce();
  });

  it("runs a skill proposal only with a person's grant, as that person, even with full access", async () => {
    const proposeSkill = vi.fn(async () => ({ saved: true }));
    const runtime = createOttoToolRuntime();
    runtime.registerSession("thread-skill", {
      runtimeMode: "full-access",
      workspaceType: "none",
      catalogHandlers: { skill_create: proposeSkill },
    });

    const execution = {
      threadId: "thread-skill",
      toolId: "skill_create" as const,
      toolCallId: "skill-1",
      input: {
        name: "weekly-report",
        description: "Writes the Monday report.",
        instructions: "Group last week's tasks by project.",
        visibility: "organization",
        reason: "Asked three Mondays in a row.",
      },
      approvalMode: "require-grant" as const,
    };

    const responder = { personId: "user-ana", displayName: "Ana", canWrite: true } as never;

    await expect(runtime.execute(execution)).rejects.toThrow("requires approval");
    runtime.grantApproval({ ...execution, responder });
    await expect(runtime.execute(execution)).resolves.toEqual({ saved: true });
    expect(proposeSkill).toHaveBeenCalledWith(expect.objectContaining({ responder }));
    await expect(runtime.execute(execution)).rejects.toThrow("requires approval");
  });

  it("requires an exact one-shot grant for local shell commands", async () => {
    const receipts: OttoToolReceipt[] = [];
    const runtime = createOttoToolRuntime({ onReceipt: (receipt) => receipts.push(receipt) });
    runtime.registerSession("thread-1", {
      runtimeMode: "full-access",
      workspaceType: "local",
      workspace: workspace("shell"),
    });

    const execution = {
      threadId: "thread-1",
      toolId: "shell" as const,
      toolCallId: "tool-1",
      input: { command: "pwd" },
      approvalMode: "require-grant" as const,
    };

    await expect(runtime.execute(execution)).rejects.toThrow("requires approval");
    expect(receipts.map((receipt) => receipt.phase)).toEqual(["start", "failure"]);
    expect(receipts[1]).toMatchObject({ failureCode: "denied", fatalToThread: false });
    receipts.length = 0;
    runtime.grantApproval({ ...execution, input: { command: "echo wrong" } });
    await expect(runtime.execute(execution)).rejects.toThrow("requires approval");
    receipts.length = 0;
    runtime.grantApproval({ ...execution, input: { command: " pwd " } });
    await expect(runtime.execute(execution)).resolves.toBeDefined();
    expect(receipts.map((receipt) => receipt.phase)).toEqual(["start", "success"]);
    await expect(runtime.execute(execution)).rejects.toThrow("requires approval");

    runtime.grantApproval({
      ...execution,
      toolCallId: "tool-null-cwd",
      input: { command: "pwd", cwd: null },
    });
    await expect(
      runtime.execute({
        ...execution,
        toolCallId: "tool-null-cwd",
        input: { command: "pwd" },
      }),
    ).resolves.toBeDefined();

    runtime.grantApproval({
      ...execution,
      toolCallId: "tool-undefined-cwd",
      input: { command: "pwd" },
    });
    await expect(
      runtime.execute({
        ...execution,
        toolCallId: "tool-undefined-cwd",
        input: { command: "pwd", cwd: undefined },
      }),
    ).resolves.toBeDefined();
  });

  it("runs every shell command in a cloud sandbox without approval", async () => {
    const runtime = createOttoToolRuntime();
    runtime.registerSession("thread-cloud", {
      runtimeMode: "approval-required",
      workspaceType: "cloud",
      workspace: workspace("shell"),
    });

    for (const command of ["rm -rf build", "cat .env", "git push origin main"]) {
      await expect(
        runtime.execute({
          threadId: "thread-cloud",
          toolId: "shell",
          toolCallId: command,
          input: { command },
          approvalMode: "require-grant",
        }),
      ).resolves.toBeDefined();
    }
  });

  it("normalizes nullable optional fields consistently for approval and execution", async () => {
    const runtime = createOttoToolRuntime();
    runtime.registerSession("nullable-shell", {
      runtimeMode: "full-access",
      workspaceType: "local",
      workspace: workspace("nullable-shell"),
    });

    const execution = {
      threadId: "nullable-shell",
      toolId: "shell" as const,
      toolCallId: "nullable-command",
      input: { command: "pwd", cwd: null },
      approvalMode: "require-grant" as const,
    };

    await expect(
      runtime.requiresApproval(execution.threadId, execution.toolId, execution.input),
    ).resolves.toBe(true);
    runtime.grantApproval(execution);
    await expect(runtime.execute(execution)).resolves.toBeDefined();
    await expect(runtime.execute(execution)).rejects.toThrow("requires approval");
  });

  it("rejects excess properties and preserves memory input validation", async () => {
    const runtime = createOttoToolRuntime();
    const memory = vi.fn();
    runtime.registerSession("memory-boundary", {
      runtimeMode: "full-access",
      workspaceType: "none",
      memoryHandlers: { memory_update: memory },
    });

    await expect(
      runtime.execute({
        threadId: "memory-boundary",
        toolId: "memory_update",
        toolCallId: "invalid-memory",
        approvalMode: "require-grant",
        input: { changes: [{ action: "add", text: "Remember this.", extra: true }] },
      }),
    ).rejects.toThrow();
    expect(memory).not.toHaveBeenCalled();
    expect(() =>
      runtime.grantApproval({
        threadId: "memory-boundary",
        toolId: "shell",
        toolCallId: "extra-command",
        input: { command: "pwd", extra: null },
      }),
    ).not.toThrow();
    expect(() =>
      runtime.grantApproval({
        threadId: "memory-boundary",
        toolId: "shell",
        toolCallId: "extra-command",
        input: { command: "pwd", extra: "unexpected" },
      }),
    ).toThrow();
  });

  it("runs catalog MCP handlers without approval and forwards progress", async () => {
    const handler = vi.fn(async ({ emitProgress }) => {
      await emitProgress("Reconnecting MCP server 'search'.");

      return { name: "search", connected: true };
    });

    const onProgress = vi.fn();
    const runtime = createOttoToolRuntime({ onProgress });
    runtime.registerSession("thread-mcp", {
      runtimeMode: "full-access",
      workspaceType: "none",
      catalogHandlers: { connection_check: handler },
    });

    const execution = {
      threadId: "thread-mcp",
      toolId: "connection_check" as const,
      toolCallId: "tool-restart",
      input: { id: "search", action: "reconnect" },
      approvalMode: "require-grant" as const,
    };

    await expect(runtime.execute(execution)).resolves.toEqual({
      name: "search",
      connected: true,
    });
    expect(onProgress).toHaveBeenCalledWith({
      threadId: "thread-mcp",
      toolId: "connection_check",
      toolCallId: "tool-restart",
      summary: "Reconnecting MCP server 'search'.",
    });
  });

  it("tests an MCP connection without approval", async () => {
    const testConnection = vi.fn(async () => ({ connected: true }));
    const runtime = createOttoToolRuntime();
    runtime.registerSession("thread-mcp-test", {
      runtimeMode: "full-access",
      workspaceType: "none",
      catalogHandlers: { connection_check: testConnection },
    });

    const execution = {
      threadId: "thread-mcp-test",
      toolId: "connection_check" as const,
      toolCallId: "tool-test-mcp",
      input: { id: "search", action: "test" },
      approvalMode: "require-grant" as const,
    };

    await expect(runtime.execute(execution)).resolves.toEqual({ connected: true });
    expect(testConnection).toHaveBeenCalledOnce();
  });

  it("allows a safe read without approval and rejects path traversal", async () => {
    const runtime = createOttoToolRuntime();
    const bot = workspace("read");
    NodeFS.writeFileSync(NodePath.join(workspaceRoot(bot), "report.txt"), "report");
    NodeFS.writeFileSync(NodePath.join(workspaceRoot(bot), "..", "outside.txt"), "secret");
    runtime.registerSession("thread-1", {
      runtimeMode: "full-access",
      workspaceType: "local",
      workspace: bot,
    });

    await expect(
      runtime.execute({
        threadId: "thread-1",
        toolId: "read",
        toolCallId: "tool-read",
        input: { path: "report.txt" },
        approvalMode: "require-grant",
      }),
    ).resolves.toBeDefined();
    await expect(
      runtime.execute({
        threadId: "thread-1",
        toolId: "read",
        toolCallId: "tool-read-outside",
        input: { path: "../outside.txt" },
        approvalMode: "require-grant",
      }),
    ).rejects.toThrow();
  });

  it("edits a file by exact replacement and refuses missing, repeated and outside text", async () => {
    const runtime = createOttoToolRuntime();
    const bot = workspace("edit");
    const file = NodePath.join(workspaceRoot(bot), "notes.md");
    const outside = NodePath.join(workspaceRoot(bot), "..", "outside.txt");
    NodeFS.writeFileSync(file, "one\ntwo\ntwo\nthree\n");
    NodeFS.writeFileSync(outside, "secret");
    runtime.registerSession("thread-edit", {
      runtimeMode: "full-access",
      workspaceType: "local",
      workspace: bot,
    });

    const edit = (
      toolCallId: string,
      path: string,
      edits: ReadonlyArray<{ oldText: string; newText: string }>,
    ) =>
      runtime.execute({
        threadId: "thread-edit",
        toolId: "edit",
        toolCallId,
        input: { path, edits },
        approvalMode: "require-grant",
      });

    await expect(
      edit("edit-ok", "notes.md", [
        { oldText: "one", newText: "uno" },
        { oldText: "three", newText: "tres\ncuatro" },
      ]),
    ).resolves.toEqual({
      path: "notes.md",
      edits: 2,
      changedLines: [
        { from: 1, to: 1 },
        { from: 4, to: 5 },
      ],
    });
    expect(NodeFS.readFileSync(file, "utf8")).toBe("uno\ntwo\ntwo\ntres\ncuatro\n");

    await expect(
      edit("edit-repeated", "notes.md", [
        { oldText: "two", newText: "dos" },
        { oldText: "nine", newText: "nueve" },
      ]),
    ).resolves.toMatchObject({
      error: {
        code: "no_unique_match",
        misses: [
          { edit: 0, matches: 2 },
          { edit: 1, matches: 0 },
        ],
      },
    });
    expect(NodeFS.readFileSync(file, "utf8")).toBe("uno\ntwo\ntwo\ntres\ncuatro\n");

    await expect(
      edit("edit-outside", "../outside.txt", [{ oldText: "secret", newText: "leaked" }]),
    ).rejects.toThrow();
    expect(NodeFS.readFileSync(outside, "utf8")).toBe("secret");
  });

  it("keeps plugin inspection read-only and requires one-shot grants for install and removal", async () => {
    const search = vi.fn(async () => ({ plugins: [] }));
    const install = vi.fn(async () => ({ installed: true }));
    const uninstall = vi.fn(async () => ({ removed: true }));
    const runtime = createOttoToolRuntime();
    runtime.registerSession("thread-plugins", {
      runtimeMode: "full-access",
      workspaceType: "none",
      catalogHandlers: {
        connection_search: search,
        connection_create: install,
        connection_delete: uninstall,
      },
    });

    await expect(
      runtime.execute({
        threadId: "thread-plugins",
        toolId: "connection_search",
        toolCallId: "tool-search",
        input: { query: "web" },
        approvalMode: "require-grant",
      }),
    ).resolves.toEqual({ plugins: [] });

    for (const [toolId, input] of [
      ["connection_create", { pluginId: "exa" }],
      ["connection_delete", { id: "exa" }],
    ] as const) {
      const execution = {
        threadId: "thread-plugins",
        toolId,
        toolCallId: `tool-${toolId}`,
        input,
        approvalMode: "require-grant" as const,
      };

      await expect(runtime.execute(execution)).rejects.toThrow("requires approval");
      runtime.grantApproval(execution);
      await expect(runtime.execute(execution)).resolves.toBeDefined();
      await expect(runtime.execute(execution)).rejects.toThrow("requires approval");
    }
  });

  it("invalidates approvals when the thread workspace changes", async () => {
    const runtime = createOttoToolRuntime();
    const original = workspace("original");
    const replacement = workspace("replacement");
    runtime.registerSession("thread-1", {
      runtimeMode: "full-access",
      workspaceType: "local",
      workspace: original,
    });

    const execution = {
      threadId: "thread-1",
      toolId: "shell" as const,
      toolCallId: "tool-shell",
      input: { command: "touch approved.txt" },
      approvalMode: "require-grant" as const,
    };

    runtime.grantApproval(execution);
    runtime.registerSession("thread-1", {
      runtimeMode: "full-access",
      workspaceType: "local",
      workspace: replacement,
    });

    await expect(runtime.execute(execution)).rejects.toThrow("requires approval");
    await expect(replacement.filesystem?.readFile("approved.txt")).rejects.toThrow();
  });

  it("reacts to a message without approval", async () => {
    const reactToMessage = vi.fn(async () => ({ status: "applied", changed: true }));
    const runtime = createOttoToolRuntime();
    runtime.registerSession("thread-reaction", {
      botId: BotId.make("parent"),
      runtimeMode: "full-access",
      workspaceType: "none",
      reactToMessage,
    });

    const execution = {
      threadId: "thread-reaction",
      toolId: "message_react" as const,
      toolCallId: "reaction-1",
      input: { messageId: "message-1", emoji: "👍", action: "add" as const },
      approvalMode: "require-grant" as const,
    };

    await expect(runtime.execute(execution)).resolves.toMatchObject({ status: "applied" });
    expect(reactToMessage).toHaveBeenCalledWith(execution.input, execution.toolCallId);
  });
});
