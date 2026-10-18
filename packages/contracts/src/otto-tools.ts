import { OTTO_DELEGATION_MAX_CONCURRENCY, OTTO_DELEGATION_MAX_DEPTH } from "./otto-delegation.ts";
import {
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

/**
 * A cloud sandbox contains whatever a bot runs in it, so its commands never ask. Without one, a
 * bot's shell runs on the server host and asks every time. Other tools ask by their risk class.
 */
export function ottoToolRequiresApproval(
  tool: OttoToolDefinition,
  context: { readonly workspaceType?: OttoToolWorkspaceType },
): boolean {
  if (tool.id === "shell") return context.workspaceType === "local";

  // A skill proposal is saved as the person who approves it.
  if (tool.id === "skill_create" || tool.id === "skill_update") return true;

  return Array.from(OTTO_PROTECTED_APPROVAL_CLASSES).some(
    (protectedClass) => protectedClass === tool.approval,
  );
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
