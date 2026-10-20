import { probeTool } from "./test-support/tool-probe.ts";
import { toolRuntimeFixture } from "./test-support/tool-runtime-fixture.ts";
import {
  OTTO_TOOL_CATALOG,
  OTTO_TOOL_CLEARABLE_FIELDS,
  OttoToolInputSchemas,
} from "@otto/contracts";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import type { Tool } from "@mastra/core/tools";
import { describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";
import type { JSONSchema } from "zod/v4/core";

import { oversizedImageNote } from "./chat-history.ts";
import { createOttoMastraTools, foldConstraintAllOf, omitNullValues } from "./otto-mastra-tools.ts";

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

  it("shows bots each task field's rule in the schema they read", () => {
    const update = foldConstraintAllOf(
      // SAFETY: Effect's Standard JSON Schema output for draft-07 is a JSON Schema object.
      Schema.toStandardJSONSchemaV1(OttoToolInputSchemas.task_update)["~standard"].jsonSchema.input(
        { target: "draft-07" },
      ) as JSONSchema.JSONSchema,
    );

    expect(JSON.stringify(update.properties?.taskId)).toContain("ID of the task to change.");
    expect(JSON.stringify(update.properties?.owner)).toContain("Must be a person, not a bot.");
    expect(JSON.stringify(update.properties?.assignees)).toContain("Replaces the current list");
  });

  it("keeps a null only where the tool clears that field", () => {
    const decodeUpdate = Schema.decodeUnknownOption(OttoToolInputSchemas.task_update);
    const clearable = new Set(OTTO_TOOL_CLEARABLE_FIELDS.task_update);

    for (const field of ["title", "status", "assignees", "resources", ...clearable]) {
      expect(Option.isSome(decodeUpdate({ taskId: "task-1", [field]: null }))).toBe(
        clearable.has(field),
      );
    }

    expect(
      omitNullValues({ taskId: "task-1", title: null, dueDate: null, owner: null }, clearable),
    ).toEqual({ taskId: "task-1", dueDate: null, owner: null });
  });

  it("caps a tool's result where it is created", async () => {
    const runtime = toolRuntimeFixture({
      toolsForThread: () => [OTTO_TOOL_CATALOG[0]!],
      requiresApproval: vi.fn(async () => false),
      execute: vi.fn(async () => "output\n".repeat(10_000)),
    });

    const shell = probeTool(createOttoMastraTools("thread-cap", runtime).shell);

    if (!shell?.execute) throw new Error("Shell tool is unavailable.");

    const result = await shell.execute({ command: "yes" }, {
      agent: { toolCallId: "tool-cap" },
    } as never);

    expect(result).toEqual(
      expect.stringContaining("1998 of 10000 lines. Narrow the request to see the rest.]"),
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

    // A 3840×2160 PNG's header: the model gets a note to scale it, never the image.
    const screen = Buffer.alloc(24);
    screen.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
    screen.write("IHDR", 12, "latin1");
    screen.writeUInt32BE(3840, 16);
    screen.writeUInt32BE(2160, 20);

    const data = screen.toString("base64");

    expect(
      read.toModelOutput?.({
        __workspaceMedia: true,
        text: "/tmp/screen.png (24 bytes, image/png)",
        mediaType: "image/png",
        data,
      }),
    ).toEqual({
      type: "content",
      value: [
        {
          type: "text",
          text: `/tmp/screen.png (24 bytes, image/png)\n\n${oversizedImageNote(data)}`,
        },
      ],
    });
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
});
