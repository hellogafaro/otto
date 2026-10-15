import * as Predicate from "effect/Predicate";
import type { ToolsInput } from "@mastra/core/agent";
import { type Tool, createTool } from "@mastra/core/tools";
import { OttoToolInputSchemas } from "@otto/contracts";
import * as Schema from "effect/Schema";
import { z } from "zod";
import type { JSONSchema } from "zod/v4/core";

import {
  isMemoryToolId,
  type OttoRuntimeToolId,
  type OttoToolRuntime,
} from "./otto-tool-runtime.ts";
import { OttoMemoryToolInputSchema } from "../memory/bot-memory-tool-handlers.ts";
import type { OttoToolExecution } from "./tools/otto-tool-types.ts";

function inputSchema(toolId: OttoRuntimeToolId) {
  return isMemoryToolId(toolId) ? OttoMemoryToolInputSchema : OttoToolInputSchemas[toolId];
}

type JsonSchemaNode = JSONSchema.JSONSchema;

const STRUCTURAL_KEYWORDS = ["type", "$ref", "anyOf", "oneOf", "allOf", "properties", "items"];

const foldChild = (child: JsonSchemaNode | boolean) =>
  Predicate.isBoolean(child) ? child : foldConstraintAllOf(child);

/**
 * Effect writes a check such as a pattern or a bound as `allOf: [{ pattern }]`
 * beside the type. Zod's import turns that into `allOf: [{ type }, {}]`, which
 * drops the constraint and leaves models guessing the field's shape (WebFetch
 * received `url: {}`). Folding keyword-only members into their parent keeps
 * `{ type: "string", pattern }`.
 */
export function foldConstraintAllOf(schema: JsonSchemaNode): JsonSchemaNode {
  const { allOf, ...node }: JsonSchemaNode = { ...schema };

  if (node.properties) {
    node.properties = Object.fromEntries(
      Object.entries(node.properties).map(([key, child]) => [key, foldChild(child)]),
    );
  }

  if (Array.isArray(node.items)) node.items = node.items.map(foldChild);
  else if (node.items !== undefined) node.items = foldChild(node.items);

  if (node.anyOf) node.anyOf = node.anyOf.map(foldConstraintAllOf);

  if (node.oneOf) node.oneOf = node.oneOf.map(foldConstraintAllOf);

  if (Predicate.isObject(node.additionalProperties)) {
    node.additionalProperties = foldConstraintAllOf(node.additionalProperties);
  }

  if (!allOf) return node;

  const constraintsOnly = allOf.every(
    (member) =>
      Predicate.isObject(member) && STRUCTURAL_KEYWORDS.every((keyword) => !(keyword in member)),
  );

  return constraintsOnly
    ? Object.assign(node, ...allOf)
    : { ...node, allOf: allOf.map(foldConstraintAllOf) };
}

function omitNullValues<Input>(input: Input) {
  if (!input || !Predicate.isObjectOrArray(input) || Array.isArray(input)) return input;

  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== null));
}

export function createOttoMastraTools(
  threadId: string,
  runtime: OttoToolRuntime,
  webSearch?: (abortSignal: AbortSignal | undefined) => OttoToolExecution["webSearch"],
): ToolsInput {
  return Object.fromEntries(
    runtime.toolsForThread(threadId).map((definition) => {
      const schema = inputSchema(definition.id);
      const standardSchema = Schema.toStandardJSONSchemaV1(schema);

      // A throw here ends the whole turn, so input the runtime cannot decode
      // goes on to execute, which rejects it as a tool error the model can fix.
      // Execute checks approval again, so this never skips a required review.
      const approval: NonNullable<Tool["needsApprovalFn"]> = (input) =>
        runtime.requiresApproval(threadId, definition.id, omitNullValues(input)).catch(() => false);

      const tool = createTool({
        id: definition.id,
        description: definition.description,
        inputSchema: z.fromJSONSchema(
          foldConstraintAllOf(
            // SAFETY: Effect's Standard JSON Schema output for draft-07 is a JSON Schema object.
            standardSchema["~standard"].jsonSchema.input({ target: "draft-07" }) as JsonSchemaNode,
          ),
          { defaultTarget: "draft-7" },
        ),
        requireApproval: approval,
        execute: (input, context) => {
          const toolCallId = context.agent?.toolCallId;

          if (!toolCallId) {
            throw new Error(`Tool '${definition.id}' has no call identity.`);
          }

          const search =
            definition.id === "WebSearch" ? webSearch?.(context.abortSignal) : undefined;

          return runtime.execute({
            threadId,
            toolId: definition.id,
            toolCallId,
            input: omitNullValues(input),
            approvalMode: "require-grant",
            ...(search ? { webSearch: search } : {}),
          });
        },
      });

      tool.needsApprovalFn = approval;

      return [definition.id, tool] as const;
    }),
  );
}
