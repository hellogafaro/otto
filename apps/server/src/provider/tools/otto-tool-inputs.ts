import { OttoToolInputSchemas, decodeOttoToolInput } from "@otto/contracts";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import { MemoryUpdateToolInput } from "../../memory/memory-update-tool.ts";
import type { OttoRuntimeToolId } from "./otto-tool-types.ts";

const decodeMemoryInput = Schema.decodeUnknownSync(MemoryUpdateToolInput);

export function normalizeOttoToolInput<Input>(
  toolId: Exclude<OttoRuntimeToolId, "memory_update">,
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
  toolId: OttoRuntimeToolId,
  input: Input,
  options?: { readonly approvalGrant: boolean },
) {
  if (toolId === "memory_update")
    return { toolId, input: decodeMemoryInput(input, { onExcessProperty: "error" }) };
  const normalized = normalizeOttoToolInput(toolId, input, options?.approvalGrant);

  switch (toolId) {
    case "Shell":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "Read":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "CreateAgent":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "CheckAgent":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "MessageAgent":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "StopAgent":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "SendToAgent":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "SendToUser":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "SearchPlugins":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "GetPlugin":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "ReactToMessage":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "InstallPlugin":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "UninstallPlugin":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "GetMcpServerStatus":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "TestMcpServer":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "ReconnectMcpServer":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "UpdateBotProfile":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "AuthenticateMcpServer":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "RestartMcpServers":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "WebSearch":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "WebFetch":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "GenerateImage":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "SaveToLibrary":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "ListLibrary":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "ReadLibraryFile":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "UpdateLibraryDocument":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "ListSkills":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "ReadSkillFile":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "ListTasks":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "ReadTask":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "CreateTask":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "UpdateTask":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "CommentOnTask":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "AddMcpServer":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "UninstallMcpServer":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "RemoveMcpAccount":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "RenameMcpAccount":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "SetMcpInstructions":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "Task":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "CheckSubagent":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "MessageSubagent":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
    case "StopSubagent":
      return { toolId, input: decodeOttoToolInput(toolId, normalized) };
  }
}
