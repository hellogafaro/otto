import { describe } from "vite-plus/test";
import * as NodeFS from "node:fs";
import { afterEach, expect, it } from "vite-plus/test";
import { BotId, ThreadId, type OttoToolReceipt } from "@otto/contracts";
import { createOttoToolRuntime } from "./otto-tool-runtime.ts";
import { makeOttoToolRuntimeTestSupport } from "./test-support/otto-tool-runtime.ts";

const { directories, workspace } = makeOttoToolRuntimeTestSupport();

describe("OttoToolRuntime", () => {
  afterEach(() => {
    for (const directory of directories) {
      NodeFS.rmSync(directory, { force: true, recursive: true });
    }

    directories.clear();
  });

  it("only exposes tools backed by the registered computer boundaries", () => {
    const runtime = createOttoToolRuntime();
    runtime.registerSession("thread-1", {
      runtimeMode: "approval-required",
      workspaceType: "local",
      workspace: workspace("bot"),
    });
    expect(runtime.toolsForThread("thread-1").map((tool) => tool.id)).toEqual(["Shell", "Read"]);
  });

  it("rejects shell working directories outside the workspace", async () => {
    const runtime = createOttoToolRuntime();
    runtime.registerSession("thread-1", {
      runtimeMode: "full-access",
      workspaceType: "local",
      workspace: workspace("cwd-bot"),
    });

    for (const cwd of ["/", ".."]) {
      const execution = {
        threadId: "thread-1",
        toolId: "Shell" as const,
        toolCallId: `tool-shell-${cwd}`,
        input: { command: "pwd", cwd },
        approvalMode: "require-grant" as const,
      };

      runtime.grantApproval(execution);
      await expect(runtime.execute(execution)).rejects.toThrow("must stay inside its workspace");
    }
  });

  it("isolates user-message failures from the current thread", async () => {
    const runtime = createOttoToolRuntime({ now: () => "2026-09-01T00:00:00.000Z" });

    const execution = {
      threadId: "thread-1",
      toolId: "SendToUser" as const,
      toolCallId: "tool-message",
      input: { message: "The export is ready." },
      approvalMode: "require-grant" as const,
    };

    runtime.registerSession("thread-1", {
      botId: BotId.make("parent"),
      runtimeMode: "full-access",
      workspaceType: "local",
      sendToUser: async () => {
        throw new Error("Message dispatch failed");
      },
    });
    runtime.grantApproval(execution);

    await expect(runtime.execute(execution)).resolves.toMatchObject({
      receiptId: "tool-message",
      toolId: "SendToUser",
      phase: "failure",
      failureCode: "internal",
      fatalToThread: false,
      summary: "Message dispatch failed",
    });
  });

  it("publishes a failure receipt when user messaging returns one", async () => {
    const receipts: OttoToolReceipt[] = [];

    const runtime = createOttoToolRuntime({
      now: () => "2026-09-01T00:00:00.000Z",
      onReceipt: (receipt) => receipts.push(receipt),
    });

    const execution = {
      threadId: "thread-1",
      toolId: "SendToUser" as const,
      toolCallId: "tool-message",
      input: { message: "The export is ready." },
      approvalMode: "require-grant" as const,
    };

    runtime.registerSession("thread-1", {
      botId: BotId.make("parent"),
      runtimeMode: "full-access",
      workspaceType: "local",
      sendToUser: async () => ({
        receiptId: "tool-message",
        toolId: "SendToUser",
        phase: "failure",
        threadId: ThreadId.make("thread-1"),
        botId: BotId.make("parent"),
        summary: "Message dispatch failed",
        failureCode: "internal",
        fatalToThread: false,
        createdAt: "2026-09-01T00:00:00.000Z",
      }),
    });
    runtime.grantApproval(execution);

    await expect(runtime.execute(execution)).resolves.toMatchObject({ phase: "failure" });
    expect(receipts.map((receipt) => receipt.phase)).toEqual(["start", "failure"]);
  });
});
