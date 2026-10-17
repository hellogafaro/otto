import { describe } from "vite-plus/test";
import * as NodeFS from "node:fs";
import { afterEach, expect, it } from "vite-plus/test";
import { BotId, ThreadId, type OttoToolReceipt } from "@otto/contracts";
import { createOttoToolRuntime } from "./otto-tool-runtime.ts";
import { makeOttoToolRuntimeTestSupport } from "./test-support/otto-tool-runtime.ts";

const { directories, workspace, workspaceRoot } = makeOttoToolRuntimeTestSupport();

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
    expect(runtime.toolsForThread("thread-1").map((tool) => tool.id)).toEqual([
      "shell",
      "read",
      "edit",
    ]);
  });

  it("reads a window of lines with offset and limit", async () => {
    const runtime = createOttoToolRuntime();
    const computer = workspace("read-window");
    NodeFS.writeFileSync(`${workspaceRoot(computer)}/notes.txt`, "one\ntwo\nthree\nfour\n");
    runtime.registerSession("thread-1", {
      runtimeMode: "full-access",
      workspaceType: "local",
      workspace: computer,
    });

    const execution = {
      threadId: "thread-1",
      toolId: "read" as const,
      toolCallId: "tool-read",
      input: { path: "notes.txt", offset: 2, limit: 2 },
      approvalMode: "require-grant" as const,
    };

    runtime.grantApproval(execution);
    const output = JSON.stringify(await runtime.execute(execution));

    expect([output.includes("two"), output.includes("three"), output.includes("four")]).toEqual([
      true,
      true,
      false,
    ]);
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
        toolId: "shell" as const,
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
      toolId: "message_post" as const,
      toolCallId: "tool-message",
      input: { text: "The export is ready." },
      approvalMode: "require-grant" as const,
    };

    runtime.registerSession("thread-1", {
      botId: BotId.make("parent"),
      runtimeMode: "full-access",
      workspaceType: "local",
      postToChat: async () => {
        throw new Error("Message dispatch failed");
      },
    });
    runtime.grantApproval(execution);

    await expect(runtime.execute(execution)).resolves.toMatchObject({
      receiptId: "tool-message",
      toolId: "message_post",
      phase: "failure",
      failureCode: "internal",
      fatalToThread: false,
      summary: "Message dispatch failed",
    });
  });

  it("attaches files read from the bot's computer to the posted message", async () => {
    const posted: Array<{
      text: string;
      files: ReadonlyArray<{ name: string; bytes: Uint8Array }>;
    }> = [];

    const runtime = createOttoToolRuntime({ now: () => "2026-09-01T00:00:00.000Z" });
    const computer = workspace("post-files");
    NodeFS.writeFileSync(`${workspaceRoot(computer)}/shot.png`, "png-bytes");

    const execution = {
      threadId: "thread-1",
      toolId: "message_post" as const,
      toolCallId: "tool-message-files",
      input: { text: "Here it is.", files: [{ path: "shot.png" }] },
      approvalMode: "require-grant" as const,
    };

    runtime.registerSession("thread-1", {
      botId: BotId.make("parent"),
      runtimeMode: "full-access",
      workspaceType: "local",
      workspace: computer,
      postToChat: async (request) => {
        posted.push(request);

        return {
          receiptId: "tool-message-files",
          toolId: "message_post",
          phase: "success",
          threadId: ThreadId.make("thread-1"),
          botId: BotId.make("parent"),
          summary: "Posted.",
          fatalToThread: false,
          createdAt: "2026-09-01T00:00:00.000Z",
        };
      },
    });
    runtime.grantApproval(execution);

    await expect(runtime.execute(execution)).resolves.toMatchObject({ phase: "success" });
    expect(posted.map(({ text, files }) => [text, files.map((file) => file.name)])).toEqual([
      ["Here it is.", ["shot.png"]],
    ]);
    expect(new TextDecoder().decode(posted[0]!.files[0]!.bytes)).toBe("png-bytes");
  });

  it("publishes a failure receipt when user messaging returns one", async () => {
    const receipts: OttoToolReceipt[] = [];

    const runtime = createOttoToolRuntime({
      now: () => "2026-09-01T00:00:00.000Z",
      onReceipt: (receipt) => receipts.push(receipt),
    });

    const execution = {
      threadId: "thread-1",
      toolId: "message_post" as const,
      toolCallId: "tool-message",
      input: { text: "The export is ready." },
      approvalMode: "require-grant" as const,
    };

    runtime.registerSession("thread-1", {
      botId: BotId.make("parent"),
      runtimeMode: "full-access",
      workspaceType: "local",
      postToChat: async () => ({
        receiptId: "tool-message",
        toolId: "message_post",
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
