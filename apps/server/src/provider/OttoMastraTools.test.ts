import { probeTool } from "./test-support/toolProbe.ts";
import { toolRuntimeFixture } from "./test-support/toolRuntimeFixture.ts";
import { OTTO_TOOL_CATALOG } from "@otto/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { createOttoToolRuntime } from "./OttoToolRuntime.ts";
import { createOttoMastraTools } from "./OttoMastraTools.ts";

describe("createOttoMastraTools", () => {
  it("builds every registered Otto tool schema", () => {
    const runtime = toolRuntimeFixture({
      toolsForThread: () => OTTO_TOOL_CATALOG,
      requiresApproval: vi.fn(async () => false),
      execute: vi.fn(async () => ({ ok: true })),
    });

    const tools = createOttoMastraTools("thread-all-tools", runtime);

    expect(Object.keys(tools)).toEqual(OTTO_TOOL_CATALOG.map((definition) => definition.id));
  });

  it("passes an exact call identity and approval mode to the runtime", async () => {
    const execute = vi.fn(async () => ({ ok: true }));

    const runtime = toolRuntimeFixture({
      toolsForThread: () => [OTTO_TOOL_CATALOG[0]!],
      requiresApproval: vi.fn(async () => true),
      execute,
    });

    const shell = probeTool(createOttoMastraTools("thread-1", runtime).Shell);

    if (!shell?.execute) throw new Error("Shell tool is unavailable.");

    await expect(
      shell.execute({ command: "pwd" }, { agent: { toolCallId: "tool-1" } } as never),
    ).resolves.toEqual({ ok: true });
    expect(execute).toHaveBeenCalledWith({
      threadId: "thread-1",
      toolId: "Shell",
      toolCallId: "tool-1",
      input: { command: "pwd" },
      approvalMode: "require-grant",
    });
    await expect(shell.execute({ command: "pwd" }, {} as never)).rejects.toThrow(
      "has no call identity",
    );
  });

  it("builds registered memory handlers as Mastra tools", async () => {
    const memoryHandler = vi.fn(async () => ({ saved: true }));
    const runtime = createOttoToolRuntime();
    runtime.registerSession("thread-memory", {
      runtimeMode: "full-access",
      workspaceType: "none",
      memoryHandlers: {
        memory: memoryHandler,
      },
    });

    const memory = probeTool(createOttoMastraTools("thread-memory", runtime).memory);

    if (!memory?.execute) throw new Error("Memory tool is unavailable.");

    await expect(
      memory.execute(
        {
          target: "user",
          operations: [{ action: "add", content: "The user prefers vim." }],
        },
        {
          agent: { toolCallId: "memory-1" },
        } as never,
      ),
    ).resolves.toEqual({ saved: true });
    expect(memoryHandler).toHaveBeenCalledOnce();
  });
});
