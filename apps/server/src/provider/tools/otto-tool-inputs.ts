import { OttoToolInputSchemas, decodeOttoToolInput } from "@otto/contracts";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import type { OttoToolId } from "@otto/contracts";

export function normalizeOttoToolInput<Input>(
  toolId: OttoToolId,
  input: Input,
  omitUnknownNulls = false,
) {
  if (!Predicate.isObject(input) || Array.isArray(input)) return input;

  const schema = OttoToolInputSchemas[toolId];
  const fields: Readonly<Record<string, Schema.Top>> = "fields" in schema ? schema.fields : {};

  return Object.fromEntries(
    Object.entries(input).filter(([key, value]) => {
      const field = fields[key];

      return (
        value !== null ||
        (field ? !Schema.is(field)(undefined) || Schema.is(field)(null) : !omitUnknownNulls)
      );
    }),
  );
}

export function decodeOttoRuntimeToolInput<Input>(
  toolId: OttoToolId,
  input: Input,
  options?: { readonly approvalGrant: boolean },
) {
  const normalized = normalizeOttoToolInput(toolId, input, options?.approvalGrant);

  switch (toolId) {
    case "shell":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "read":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "edit":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "bot_create":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "delegate_check":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "delegate_stop":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "delegate":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "message_post":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "connection_search":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "connection_read":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "connection_create":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "connection_update":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "connection_check":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "connection_delete":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "message_react":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "bot_update":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "web_search":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "web_fetch":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "image_create":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "audio_transcribe":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "library_create":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "library_read":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "library_update":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "library_share":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "library_unshare":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "skill_read":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "skill_create":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "skill_update":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "search":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "task_read":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "task_create":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "task_update":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "task_comment":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
  }
}
