import type { decodeOttoToolInput } from "./otto-tools/inputs.ts";
import * as Predicate from "effect/Predicate";
import { OTTO_DELEGATION_MAX_CONCURRENCY, OTTO_DELEGATION_MAX_DEPTH } from "./otto-delegation.ts";
import {
  OttoToolApprovalClass,
  OttoProtectedApprovalClass,
  OTTO_PROTECTED_APPROVAL_CLASSES,
  OttoToolCapability,
  OttoToolWorkspaceType,
  type OttoToolDefinition,
  OTTO_TOOL_CATALOG,
} from "./otto-tools/catalog.ts";

export interface OttoToolAvailabilityContext {
  readonly capabilities: ReadonlySet<OttoToolCapability>;
  readonly workspaceType: OttoToolWorkspaceType;
  readonly localFullAccess: boolean;
  readonly implementedTools: ReadonlySet<string>;
  readonly delegationDepth?: number;
  readonly activeDelegations?: number;
}

export function filterOttoTools(
  context: OttoToolAvailabilityContext,
): ReadonlyArray<OttoToolDefinition> {
  return OTTO_TOOL_CATALOG.filter((tool) => {
    if (!context.capabilities.has(tool.capability)) return false;

    if (!context.implementedTools.has(tool.id)) return false;

    if (
      tool.id === "delegate" &&
      ((context.delegationDepth ?? 0) >= OTTO_DELEGATION_MAX_DEPTH ||
        (context.activeDelegations ?? 0) >= OTTO_DELEGATION_MAX_CONCURRENCY)
    )
      return false;

    return !(tool.workspace === "bot-workspace" && context.workspaceType === "none");
  });
}

export function classifyOttoSensitivePath(path: string): OttoProtectedApprovalClass | undefined {
  return /(^|[/\\])(?:\.env(?:\.[^/\\]+)?|\.ssh|\.aws|\.config[/\\]gh|keychain|credentials?|secrets?|tokens?)(?:[/\\]|$)/i.test(
    path,
  )
    ? "secrets"
    : undefined;
}

export function classifyOttoExternalCommand(
  command: string,
): OttoProtectedApprovalClass | undefined {
  if (/\b(stripe|checkout|payment|purchase|buy)\b/i.test(command)) return "pay";

  if (/\b(rm|rmdir|unlink|trash|delete|drop|destroy|wipe)\b/i.test(command)) return "delete";

  if (/\b(secret|credential|token|password|keychain|\.env)\b/i.test(command)) return "secrets";

  if (
    /\b(deploy|release|publish|production|kubectl|terraform\s+apply|git\s+push|gh\s+pr\s+(?:create|merge))\b/i.test(
      command,
    )
  )
    return "production";

  if (
    /\b(send|post|comment|message|mail|curl\b[^\n]*(?:-X\s*POST|--request\s+POST|-d\b|--data(?:-raw|-binary|-urlencode)?\b))\b/i.test(
      command,
    )
  )
    return "send";

  return undefined;
}

export function ottoToolApprovalForInput(
  tool: OttoToolDefinition,
  input: Parameters<typeof decodeOttoToolInput>[1],
  context?: { readonly workspaceType?: OttoToolWorkspaceType },
): OttoToolApprovalClass {
  if (!Predicate.isObjectOrArray(input)) return tool.approval;

  if (tool.id === "shell" && "command" in input && Predicate.isString(input.command)) {
    const protectedClass = classifyOttoExternalCommand(input.command);

    if (protectedClass) return protectedClass;
  }

  if (tool.id === "shell" && context?.workspaceType === "local") return "user-computer";

  return tool.approval;
}

export function ottoToolRequiresApproval(
  tool: OttoToolDefinition,
  context: Pick<OttoToolAvailabilityContext, "localFullAccess"> & {
    readonly workspaceType?: OttoToolWorkspaceType;
  },
  input?: Parameters<typeof decodeOttoToolInput>[1],
): boolean {
  const approval = ottoToolApprovalForInput(tool, input, context);

  if (tool.id === "shell" && context.workspaceType === "local") return true;

  if (
    Array.from(OTTO_PROTECTED_APPROVAL_CLASSES).some(
      (protectedClass) => protectedClass === approval,
    )
  )
    return true;

  return approval === "user-computer" && !(context.localFullAccess && input !== undefined);
}

export {
  OTTO_COMMAND_MAX_CHARS,
  OTTO_PATH_MAX_CHARS,
  OttoPluginRecommendation,
  OttoPluginSearchResult,
  OTTO_DELEGATION_CONTEXT_MAX_CHARS,
  OttoToolInputSchemas,
  OttoMessageReactionResult,
  decodeOttoToolInput,
} from "./otto-tools/inputs.ts";

export {
  OttoToolId,
  OttoToolApprovalClass,
  OttoProtectedApprovalClass,
  OTTO_PROTECTED_APPROVAL_CLASSES,
  OttoToolCapability,
  OttoToolWorkspaceType,
  type OttoToolWorkspaceRequirement,
  type OttoToolDefinition,
  OTTO_TOOL_CATALOG,
  OTTO_TOOL_FAMILIES,
} from "./otto-tools/catalog.ts";

export {
  OttoToolReceiptPhase,
  OttoToolFailureCode,
  OttoToolReceipt,
} from "./otto-tools/receipts.ts";
