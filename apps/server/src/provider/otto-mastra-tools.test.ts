import { probeTool } from "./test-support/tool-probe.ts";
import { toolRuntimeFixture } from "./test-support/tool-runtime-fixture.ts";
import { OTTO_TOOL_CATALOG, OttoToolInputSchemas } from "@otto/contracts";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import type { Tool } from "@mastra/core/tools";
import { describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";
import type { JSONSchema } from "zod/v4/core";

import { createOttoToolRuntime } from "./otto-tool-runtime.ts";
import { createOttoMastraTools, foldConstraintAllOf } from "./otto-mastra-tools.ts";

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

  it("gives every Otto tool an object input schema, as model APIs require", () => {
    const runtime = toolRuntimeFixture({
      toolsForThread: () => OTTO_TOOL_CATALOG,
      requiresApproval: vi.fn(async () => false),
      execute: vi.fn(async () => ({ ok: true })),
    });

    const nonObjectTools = Object.entries(createOttoMastraTools("thread-schemas", runtime))
      .map(([toolId, tool]) => {
        // SAFETY: createOttoMastraTools always builds a Mastra tool whose inputSchema is zod.
        const schema = z.toJSONSchema((tool as { inputSchema: z.ZodType }).inputSchema);
        const roots = schema.anyOf ?? [schema];

        return {
          toolId,
          types: roots.map((root) => (Predicate.isBoolean(root) ? root : root.type)),
        };
      })
      .filter(({ types }) => types.some((type) => type !== "object"));

    expect(nonObjectTools).toEqual([]);
  });

  it("passes an exact call identity and approval mode to the runtime", async () => {
    const execute = vi.fn(async () => ({ ok: true }));

    const runtime = toolRuntimeFixture({
      toolsForThread: () => [OTTO_TOOL_CATALOG[0]!],
      requiresApproval: vi.fn(async () => true),
      execute,
    });

    const shell = probeTool(createOttoMastraTools("thread-1", runtime).shell);

    if (!shell?.execute) throw new Error("Shell tool is unavailable.");

    await expect(
      shell.execute({ command: "pwd" }, { agent: { toolCallId: "tool-1" } } as never),
    ).resolves.toEqual({ ok: true });
    expect(execute).toHaveBeenCalledWith({
      threadId: "thread-1",
      toolId: "shell",
      toolCallId: "tool-1",
      input: { command: "pwd" },
      approvalMode: "require-grant",
    });
    await expect(shell.execute({ command: "pwd" }, {} as never)).rejects.toThrow(
      "has no call identity",
    );
  });

  it("shows a screenshot read from the computer to the model as an image", () => {
    const runtime = toolRuntimeFixture({
      toolsForThread: () => OTTO_TOOL_CATALOG,
      requiresApproval: vi.fn(async () => false),
      execute: vi.fn(async () => ({ ok: true })),
    });

    type ReadOutput =
      | string
      | { __workspaceMedia: true; text: string; mediaType: string; data: string };

    // SAFETY: the read tool is a Mastra tool and toModelOutput is part of its shape.
    const read = createOttoMastraTools("thread-read", runtime).read as {
      toModelOutput?: (output: ReadOutput) => ReturnType<NonNullable<Tool["toModelOutput"]>>;
    };

    expect(
      read.toModelOutput?.({
        __workspaceMedia: true,
        text: "/tmp/page.png (4 bytes, image/png)",
        mediaType: "image/png",
        data: "iVBO",
      }),
    ).toEqual({
      type: "content",
      value: [
        { type: "text", text: "/tmp/page.png (4 bytes, image/png)" },
        { type: "image-data", data: "iVBO", mediaType: "image/png" },
      ],
    });
    expect(read.toModelOutput?.("notes.txt (5 bytes)\nhello")).toBeUndefined();
  });

  it("keeps checked string fields as plain strings with their pattern", () => {
    const webFetch = Schema.toStandardJSONSchemaV1(OttoToolInputSchemas.web_fetch)["~standard"];
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

  it("keeps every field's check after import, including schemas behind a $ref", () => {
    const runtime = toolRuntimeFixture({
      toolsForThread: () => OTTO_TOOL_CATALOG,
      requiresApproval: vi.fn(async () => false),
      execute: vi.fn(async () => ({ ok: true })),
    });

    const emptyMembers = Object.entries(createOttoMastraTools("thread-checks", runtime))
      // SAFETY: createOttoMastraTools always builds a Mastra tool whose inputSchema is zod.
      .map(
        ([toolId, tool]) =>
          [toolId, z.toJSONSchema((tool as { inputSchema: z.ZodType }).inputSchema)] as const,
      )
      .filter(([, schema]) => JSON.stringify(schema).includes("{}"))
      .map(([toolId]) => toolId);

    expect(emptyMembers).toEqual([]);
  });

  it("lets undecodable input reach execute instead of failing the turn in the approval check", async () => {
    const runtime = toolRuntimeFixture({
      toolsForThread: () => OTTO_TOOL_CATALOG.filter((definition) => definition.id === "web_fetch"),
      requiresApproval: vi.fn(async () => {
        throw new Error("Expected string");
      }),
      execute: vi.fn(async () => ({ ok: true })),
    });

    const webFetch = probeTool(createOttoMastraTools("thread-fetch", runtime).web_fetch);

    await expect(webFetch.needsApprovalFn({ url: {} })).resolves.toBe(false);
  });

  it("builds registered memory handlers as Mastra tools", async () => {
    const memoryHandler = vi.fn(async () => ({ saved: true }));
    const runtime = createOttoToolRuntime();
    runtime.registerSession("thread-memory", {
      runtimeMode: "full-access",
      workspaceType: "none",
      memoryHandlers: {
        memory_update: memoryHandler,
      },
    });

    const memory = probeTool(createOttoMastraTools("thread-memory", runtime).memory_update);

    if (!memory?.execute) throw new Error("Memory tool is unavailable.");

    await expect(
      memory.execute(
        { changes: [{ action: "add", id: null, scope: "person", text: "Prefers vim." }] },
        {
          agent: { toolCallId: "memory-1" },
        } as never,
      ),
    ).resolves.toEqual({ saved: true });
    expect(memoryHandler).toHaveBeenCalledOnce();
  });
});
