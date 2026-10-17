import * as NodeFS from "node:fs";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { BotId, type OttoToolReceipt } from "@otto/contracts";
import { createOttoToolRuntime } from "./otto-tool-runtime.ts";
import { makeOttoToolRuntimeTestSupport } from "./test-support/otto-tool-runtime.ts";

const { directories, workspace } = makeOttoToolRuntimeTestSupport();

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

  it("hands work to another bot without asking for approval", async () => {
    const send = vi.fn(async () => ({ delivered: true }));
    const runtime = createOttoToolRuntime();
    runtime.registerSession("thread-delegated", {
      runtimeMode: "full-access",
      workspaceType: "local",
      workspace: workspace("delegated"),
      delegation: {
        depth: 0,
        activeDelegations: 0,
        access: {
          sandbox: "local",
          runtimeMode: "full-access",
          enabledMcpServerIds: [],
          disabledMcpServerIds: [],
        },
        send,
      },
    });
    expect(runtime.toolsForThread("thread-delegated").map((tool) => tool.id)).toContain("delegate");

    const execution = {
      threadId: "thread-delegated",
      toolId: "delegate" as const,
      toolCallId: "tool-send",
      input: {
        botId: BotId.make("child-bot"),
        task: "Research the issue.",
        expectedResult: "Return the cause.",
      },
      approvalMode: "require-grant" as const,
    };

    await expect(
      runtime.requiresApproval("thread-delegated", "delegate", execution.input),
    ).resolves.toBe(false);
    await expect(runtime.execute(execution)).resolves.toEqual({ delivered: true });
    expect(send).toHaveBeenCalledOnce();
  });

  it("runs typed durable bot controls through the delegation backend", async () => {
    const create = vi.fn(async () => ({ botId: "bot-research" }));
    const check = vi.fn(async () => ({ state: "ready" }));
    const send = vi.fn(async () => ({ delivered: true }));
    const stop = vi.fn(async () => ({ stopped: true }));
    const runtime = createOttoToolRuntime();
    runtime.registerSession("thread-controls", {
      runtimeMode: "full-access",
      workspaceType: "local",
      delegation: {
        depth: 0,
        activeDelegations: 0,
        access: {
          sandbox: "local",
          runtimeMode: "full-access",
          enabledMcpServerIds: [],
          disabledMcpServerIds: [],
        },
        create,
        check,
        send,
        stop,
      },
    });

    const execute = <Input>(toolId: "bot_create" | "delegate_check", input: Input) =>
      runtime.execute({
        threadId: "thread-controls",
        toolId,
        toolCallId: `tool-${toolId}`,
        input,
        approvalMode: "require-grant",
      });

    await expect(execute("bot_create", { name: "Research" })).resolves.toEqual({
      botId: "bot-research",
    });
    await expect(execute("delegate_check", { botId: "bot-research" })).resolves.toEqual({
      state: "ready",
    });

    await expect(
      runtime.execute({
        threadId: "thread-controls",
        toolId: "delegate",
        toolCallId: "tool-message",
        input: {
          botId: BotId.make("bot-research"),
          task: "Compare flights.",
          expectedResult: "Return a short comparison.",
        },
        approvalMode: "require-grant",
      }),
    ).resolves.toEqual({ delivered: true });

    const stopExecution = {
      threadId: "thread-controls",
      toolId: "delegate_stop" as const,
      toolCallId: "tool-stop",
      input: { botId: BotId.make("bot-research") },
      approvalMode: "require-grant" as const,
    };

    await expect(runtime.execute(stopExecution)).rejects.toThrow("requires approval");
    runtime.grantApproval(stopExecution);
    await expect(runtime.execute(stopExecution)).resolves.toBeDefined();

    expect(send).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
  });

  it("returns nonfatal receipts when durable bot controls fail", async () => {
    const fail = vi.fn(async () => {
      throw new Error("Bot backend unavailable.");
    });

    const receipts: OttoToolReceipt[] = [];
    const runtime = createOttoToolRuntime({ onReceipt: (receipt) => receipts.push(receipt) });
    runtime.registerSession("thread-control-failures", {
      botId: BotId.make("bot-parent"),
      runtimeMode: "full-access",
      workspaceType: "local",
      delegation: {
        depth: 0,
        activeDelegations: 0,
        access: {
          sandbox: "local",
          runtimeMode: "full-access",
          enabledMcpServerIds: [],
          disabledMcpServerIds: [],
        },
        create: fail,
        check: fail,
        send: vi.fn(),
        stop: fail,
      },
    });

    for (const execution of [
      {
        threadId: "thread-control-failures",
        toolId: "bot_create" as const,
        toolCallId: "create-failure",
        input: { name: "Research" },
        approvalMode: "require-grant" as const,
      },
      {
        threadId: "thread-control-failures",
        toolId: "delegate_check" as const,
        toolCallId: "check-failure",
        input: { botId: BotId.make("bot-research") },
        approvalMode: "require-grant" as const,
      },
      {
        threadId: "thread-control-failures",
        toolId: "delegate_stop" as const,
        toolCallId: "stop-failure",
        input: { botId: BotId.make("bot-research") },
        approvalMode: "require-grant" as const,
      },
    ]) {
      if (execution.toolId === "delegate_stop") runtime.grantApproval(execution);
      receipts.length = 0;
      await expect(runtime.execute(execution)).resolves.toMatchObject({
        receiptId: execution.toolCallId,
        toolId: execution.toolId,
        phase: "failure",
        threadId: "thread-control-failures",
        botId: "bot-parent",
        summary: "Bot backend unavailable.",
        failureCode: "internal",
        fatalToThread: false,
      });
      expect(receipts.map((receipt) => receipt.phase)).toEqual(["start", "failure"]);
    }
  });

  it("isolates delegation failures from the parent thread", async () => {
    const runtime = createOttoToolRuntime();

    const execution = {
      threadId: "thread-1",
      toolId: "delegate" as const,
      toolCallId: "tool-delegate",
      input: {
        botId: BotId.make("reviewer"),
        task: "Review the patch",
        expectedResult: "A verdict",
      },
      approvalMode: "require-grant" as const,
    };

    runtime.registerSession("thread-1", {
      botId: BotId.make("parent"),
      runtimeMode: "full-access",
      workspaceType: "local",
      delegation: {
        depth: 0,
        activeDelegations: 0,
        access: {
          sandbox: "local",
          runtimeMode: "full-access",
          enabledMcpServerIds: [],
          disabledMcpServerIds: [],
        },
        send: async () => {
          throw new Error("Provider unavailable");
        },
      },
    });
    runtime.grantApproval(execution);

    await expect(runtime.execute(execution)).resolves.toMatchObject({
      phase: "failure",
      failureCode: "internal",
      fatalToThread: false,
      billedBotId: "reviewer",
      summary: "Provider unavailable",
    });
  });
});
