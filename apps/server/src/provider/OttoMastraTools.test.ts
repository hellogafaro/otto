import { probeTool } from "./test-support/toolProbe.ts";
import { toolRuntimeFixture } from "./test-support/toolRuntimeFixture.ts";
import { OTTO_TOOL_CATALOG, OttoToolInputSchemas } from "@otto/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";
import type { JSONSchema } from "zod/v4/core";

import { createOttoToolRuntime } from "./OttoToolRuntime.ts";
import { createOttoMastraTools, foldConstraintAllOf } from "./OttoMastraTools.ts";

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

  it("keeps checked string fields as plain strings with their pattern", () => {
    const webFetch = Schema.toStandardJSONSchemaV1(OttoToolInputSchemas.WebFetch)["~standard"];
    // SAFETY: Effect's Standard JSON Schema output for draft-07 is a JSON Schema object.
    const generated = webFetch.jsonSchema.input({ target: "draft-07" }) as JSONSchema.JSONSchema;

    const imported = z.toJSONSchema(
      z.fromJSONSchema(foldConstraintAllOf(generated), { defaultTarget: "draft-7" }),
    );

    expect(imported.properties?.url).toEqual({ type: "string", pattern: "^https?:\\/\\/" });
    expect(
      foldConstraintAllOf({ type: "integer", allOf: [{ minimum: 1 }, { maximum: 50 }] }),
    ).toEqual({ type: "integer", minimum: 1, maximum: 50 });
    expect(foldConstraintAllOf({ allOf: [{ type: "string" }, { minLength: 1 }] })).toEqual({
      allOf: [{ type: "string" }, { minLength: 1 }],
    });
  });

  it("lets undecodable input reach execute instead of failing the turn in the approval check", async () => {
    const runtime = toolRuntimeFixture({
      toolsForThread: () => OTTO_TOOL_CATALOG.filter((definition) => definition.id === "WebFetch"),
      requiresApproval: vi.fn(async () => {
        throw new Error("Expected string");
      }),
      execute: vi.fn(async () => ({ ok: true })),
    });

    const webFetch = probeTool(createOttoMastraTools("thread-fetch", runtime).WebFetch);

    await expect(webFetch.needsApprovalFn({ url: {} })).resolves.toBe(false);
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
