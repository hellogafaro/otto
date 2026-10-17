import type { OttoToolResult } from "./tools/otto-tool-types.ts";
import * as Match from "effect/Match";
import * as Predicate from "effect/Predicate";
import { decodeOttoRuntimeToolInput } from "./tools/otto-tool-inputs.ts";
import { RequestContext } from "@mastra/core/request-context";
import {
  OTTO_TOOL_CATALOG,
  type OttoToolId,
  type OttoToolReceipt,
  ThreadId,
  ottoToolApprovalForInput,
  ottoToolRequiresApproval,
  filterOttoTools,
  OttoDelegationContextTooLongError,
  OttoDelegationProviderUnsupportedError,
} from "@otto/contracts";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import {
  MEMORY_UPDATE_TOOL_DESCRIPTION,
  type MemoryUpdateToolId,
} from "../memory/memory-update-tool.ts";
import {
  type OttoRuntimeToolDefinition,
  type OttoToolRuntimeOptions,
  type OttoToolRuntime,
  type OttoToolSession,
  type OttoRuntimeToolId,
  type OttoToolExecution,
} from "./tools/otto-tool-types.ts";
import {
  ensureWorkspaceCwd,
  APPROVAL_RANK,
  canonicalInput,
  field,
} from "./tools/otto-tool-authorization.ts";
import { toolsForWorkspace, BACKEND_NAMES, executable } from "./tools/otto-workspace-tools.ts";

const isDelegationContextTooLong = Schema.is(OttoDelegationContextTooLongError);

const isDelegationProviderUnsupported = Schema.is(OttoDelegationProviderUnsupportedError);

const MEMORY_TOOL_DEFINITIONS = [
  { id: "memory_update", description: MEMORY_UPDATE_TOOL_DESCRIPTION },
] as const satisfies ReadonlyArray<OttoRuntimeToolDefinition>;

export function isMemoryToolId(toolId: string): toolId is MemoryUpdateToolId {
  return toolId === "memory_update";
}

export function createOttoToolRuntime(options?: OttoToolRuntimeOptions): OttoToolRuntime {
  const sessions = new Map<string, OttoToolSession>();
  const grants = new Map<string, { readonly toolId: OttoRuntimeToolId; readonly input: string }>();
  const key = (threadId: string, toolCallId: string) => `${threadId}\u0000${toolCallId}`;

  const clearApprovals = (threadId: string) => {
    for (const grantKey of grants.keys()) {
      if (grantKey.startsWith(`${threadId}\u0000`)) grants.delete(grantKey);
    }
  };

  const emitReceipt = (
    input: OttoToolExecution,
    phase: OttoToolReceipt["phase"],
    details?: Pick<OttoToolReceipt, "failureCode" | "summary">,
  ) => {
    try {
      options?.onReceipt?.({
        receiptId: input.toolCallId,
        toolId: input.toolId,
        phase,
        threadId: ThreadId.make(input.threadId),
        fatalToThread: false,
        createdAt: DateTime.formatIso(DateTime.nowUnsafe()),
        ...details,
      });
    } catch {
      // Receipt observers must not change tool execution.
    }
  };

  const nonfatalToolFailureReceipt = (
    input: OttoToolExecution,
    session: OttoToolSession,
    cause: unknown,
    failureCode: NonNullable<OttoToolReceipt["failureCode"]>,
    billedBotId?: OttoToolSession["botId"],
  ): OttoToolReceipt => {
    const summary = cause instanceof Error ? cause.message : String(cause);

    const receipt = {
      receiptId: input.toolCallId,
      toolId: input.toolId,
      phase: "failure",
      threadId: ThreadId.make(input.threadId),
      botId: session.botId,
      summary,
      failureCode,
      fatalToThread: false,
      ...(billedBotId ? { billedBotId } : {}),
      createdAt: options?.now?.() ?? DateTime.formatIso(DateTime.nowUnsafe()),
    } satisfies OttoToolReceipt;

    emitReceipt(input, "failure", { failureCode, summary });

    return receipt;
  };

  const implementedTools = (session: OttoToolSession) => {
    const tools = new Set<OttoToolId>();

    if (session.workspace?.sandbox?.executeCommand) tools.add("Shell");

    if (session.workspace?.filesystem) tools.add("Read");

    if (session.delegation) {
      if (session.delegation.create) tools.add("CreateAgent");

      if (session.delegation.check) tools.add("CheckAgent");
      tools.add("MessageAgent");

      if (session.delegation.stop) tools.add("StopAgent");
      tools.add("SendToAgent");
    }

    if (session.workers) {
      tools.add("Task");
      tools.add("CheckSubagent");
      tools.add("MessageSubagent");
      tools.add("StopSubagent");
    }

    if (session.sendToUser) tools.add("SendToUser");

    if (session.botId && session.botState) tools.add("UpdateBotProfile");

    if (session.reactToMessage) tools.add("ReactToMessage");

    for (const { id: toolId } of OTTO_TOOL_CATALOG) {
      if (!Object.hasOwn(session.catalogHandlers ?? {}, toolId)) continue;

      if (toolId === "GenerateImage") {
        const image = session.imageGeneration;

        if (image && !image.chatgptEnabled && !image.grokEnabled) continue;
      }

      tools.add(toolId);
    }

    if (session.delegation) {
      for (const toolId of tools) {
        if (!session.delegation.access.allowedToolIds.includes(toolId)) tools.delete(toolId);
      }
    }

    return tools;
  };

  const toolsForThread = (threadId: string) => {
    const session = sessions.get(threadId);

    if (!session) throw new Error(`Tool session '${threadId}' is not registered.`);
    const implemented = implementedTools(session);

    const workspaceTools = filterOttoTools({
      capabilities: new Set(["bot-workspace"]),
      workspaceType: session.workspaceType,
      localFullAccess: session.runtimeMode === "full-access",
      implementedTools: implemented,
      ...(session.delegation
        ? {
            delegationDepth: session.delegation.depth,
            activeDelegations: session.delegation.activeDelegations,
          }
        : {}),
      ...(session.workers ? { workerDepth: session.workers.depth } : {}),
    });

    return session.memoryHandlers
      ? [...workspaceTools, ...MEMORY_TOOL_DEFINITIONS]
      : workspaceTools;
  };

  const decodedGrantInput = (toolId: OttoRuntimeToolId, input: OttoToolExecution["input"]) =>
    decodeOttoRuntimeToolInput(toolId, input, { approvalGrant: true }).input;

  const requiresApproval = async (
    session: OttoToolSession,
    tool: OttoRuntimeToolDefinition,
    input: OttoToolExecution["input"],
  ) => {
    if (tool.id === "memory_update") return false;
    const ottoTool = OTTO_TOOL_CATALOG.find((candidate) => candidate.id === tool.id);

    if (!ottoTool) throw new Error(`Tool '${tool.id}' has no definition.`);
    ensureWorkspaceCwd(ottoTool.id, input);
    const ceiling = session.delegation?.access.approvalCeiling;

    if (
      ceiling &&
      APPROVAL_RANK.indexOf(
        ottoToolApprovalForInput(ottoTool, input, { workspaceType: session.workspaceType }),
      ) > APPROVAL_RANK.indexOf(ceiling)
    ) {
      throw new Error(`Tool '${tool.id}' exceeds this delegation's approval ceiling.`);
    }

    return ottoToolRequiresApproval(
      ottoTool,
      {
        localFullAccess: session.runtimeMode === "full-access",
        workspaceType: session.workspaceType,
      },
      input,
    );
  };

  return {
    registerSession: (threadId, session) => {
      clearApprovals(threadId);
      sessions.set(threadId, session);
    },
    unregisterSession: (threadId) => {
      sessions.delete(threadId);
      clearApprovals(threadId);
    },
    clearApprovals,
    toolsForThread,
    requiresApproval: async (threadId, toolId, input) => {
      const session = sessions.get(threadId);

      if (!session) throw new Error(`Tool session '${threadId}' is not registered.`);
      const tool = toolsForThread(threadId).find((candidate) => candidate.id === toolId);

      if (!tool) throw new Error(`Tool '${toolId}' is not available for this turn.`);

      return requiresApproval(session, tool, decodeOttoRuntimeToolInput(toolId, input).input);
    },
    grantApproval: (input) => {
      grants.set(key(input.threadId, input.toolCallId), {
        toolId: input.toolId,
        input: canonicalInput(decodedGrantInput(input.toolId, input.input)),
      });
    },
    execute: async (input) => {
      let failureCode: NonNullable<OttoToolReceipt["failureCode"]> = "internal";
      emitReceipt(input, "start");
      let executionSession: OttoToolSession | undefined;

      try {
        failureCode = "not_found";
        const session = sessions.get(input.threadId);

        if (!session) throw new Error(`Tool session '${input.threadId}' is not registered.`);
        executionSession = session;
        await options?.onToolStart?.(input, session);

        const tool = toolsForThread(input.threadId).find(
          (candidate) => candidate.id === input.toolId,
        );

        if (!tool) throw new Error(`Tool '${input.toolId}' is not available for this turn.`);

        failureCode = "validation";
        const execution = decodeOttoRuntimeToolInput(input.toolId, input.input);
        const decoded = execution.input;
        failureCode = "denied";

        if (await requiresApproval(session, tool, decoded)) {
          const grantKey = key(input.threadId, input.toolCallId);
          const grant = grants.get(grantKey);

          if (
            !grant ||
            input.approvalMode !== "require-grant" ||
            grant.toolId !== input.toolId ||
            grant.input !== canonicalInput(decoded)
          ) {
            throw new Error(`Tool '${input.toolId}' requires approval.`);
          }

          grants.delete(grantKey);
        }

        failureCode = "not_found";
        let result: OttoToolResult;

        const catalogHandler =
          execution.toolId === "memory_update"
            ? undefined
            : session.catalogHandlers?.[execution.toolId];

        if (isMemoryToolId(input.toolId)) {
          const handler = session.memoryHandlers?.[input.toolId];

          if (!handler) throw new Error(`Tool '${input.toolId}' has no backend.`);
          failureCode = "internal";
          result = await handler({ ...input, toolId: input.toolId, input: decoded });
        } else if (catalogHandler) {
          failureCode = "internal";
          result = await catalogHandler({
            input: decoded,
            ...(input.webSearch ? { webSearch: input.webSearch } : {}),
            emitProgress: (summary, details) =>
              options?.onProgress?.({
                threadId: input.threadId,
                // SAFETY: Only catalog tools reach this callback; memory dispatch returns above.
                toolId: input.toolId as OttoToolId,
                toolCallId: input.toolCallId,
                summary,
                ...details,
              }),
          });
        } else if (execution.toolId === "SendToAgent" || execution.toolId === "MessageAgent") {
          if (!session.delegation) throw new Error("Delegation is not available for this session.");
          const delegationInput = execution.input;
          failureCode = "internal";

          try {
            result = await session.delegation.send(delegationInput);
          } catch (cause) {
            if (isDelegationContextTooLong(cause)) failureCode = "validation";

            if (isDelegationProviderUnsupported(cause)) failureCode = "denied";

            return nonfatalToolFailureReceipt(
              input,
              session,
              cause,
              failureCode,
              delegationInput.botId,
            );
          }
        } else if (
          execution.toolId === "CreateAgent" ||
          execution.toolId === "CheckAgent" ||
          execution.toolId === "StopAgent"
        ) {
          if (!session.delegation) {
            throw new Error("Bot management is not available for this session.");
          }

          failureCode = "internal";
          let billedBotId = session.botId;

          try {
            if (execution.toolId === "CreateAgent") {
              if (!session.delegation.create) throw new Error("Bot creation is not available.");
              result = await session.delegation.create(execution.input);
            } else if (execution.toolId === "CheckAgent") {
              if (!session.delegation.check) throw new Error("Bot inspection is not available.");
              const checkInput = execution.input;
              billedBotId = checkInput.botId;
              result = await session.delegation.check(checkInput);
            } else {
              if (!session.delegation.stop) throw new Error("Bot cancellation is not available.");
              const stopInput = execution.input;
              billedBotId = stopInput.botId;
              result = await session.delegation.stop(stopInput);
            }
          } catch (cause) {
            return nonfatalToolFailureReceipt(input, session, cause, failureCode, billedBotId);
          }
        } else if (
          execution.toolId === "Task" ||
          execution.toolId === "CheckSubagent" ||
          execution.toolId === "MessageSubagent" ||
          execution.toolId === "StopSubagent"
        ) {
          if (!session.workers) throw new Error("Workers are not available for this session.");
          failureCode = "internal";

          try {
            result = await Match.value(execution).pipe(
              Match.when({ toolId: "Task" }, ({ input }) => session.workers!.spawn(input)),
              Match.when({ toolId: "CheckSubagent" }, ({ input }) => session.workers!.check(input)),
              Match.when({ toolId: "MessageSubagent" }, ({ input }) =>
                session.workers!.message(input),
              ),
              Match.orElse(({ input }) => session.workers!.stop(input)),
            );
          } catch (cause) {
            return nonfatalToolFailureReceipt(input, session, cause, failureCode);
          }
        } else if (execution.toolId === "SendToUser") {
          if (!session.sendToUser) {
            throw new Error("User messaging is not available for this session.");
          }

          failureCode = "internal";

          try {
            result = await session.sendToUser(execution.input);
          } catch (cause) {
            const summary = cause instanceof Error ? cause.message : String(cause);
            result = {
              receiptId: input.toolCallId,
              toolId: input.toolId,
              phase: "failure",
              threadId: ThreadId.make(input.threadId),
              botId: session.botId,
              summary,
              failureCode,
              fatalToThread: false,
              createdAt: options?.now?.() ?? DateTime.formatIso(DateTime.nowUnsafe()),
            } satisfies OttoToolReceipt;
            emitReceipt(input, "failure", { failureCode, summary });

            return result;
          }
        } else if (execution.toolId === "UpdateBotProfile") {
          if (!session.botId || !session.botState) {
            throw new Error("Bot profile management is not available for this session.");
          }

          failureCode = "internal";

          try {
            result = await session.botState.updateProfile(
              ThreadId.make(input.threadId),
              session.botId,
              input.toolCallId,
              execution.input,
            );
          } catch (cause) {
            const summary = cause instanceof Error ? cause.message : String(cause);
            result = {
              receiptId: input.toolCallId,
              toolId: input.toolId,
              phase: "failure",
              threadId: ThreadId.make(input.threadId),
              botId: session.botId,
              summary,
              failureCode,
              fatalToThread: false,
              billedBotId: session.botId,
              createdAt: options?.now?.() ?? DateTime.formatIso(DateTime.nowUnsafe()),
            } satisfies OttoToolReceipt;
            emitReceipt(input, "failure", { failureCode, summary });

            return result;
          }
        } else if (execution.toolId === "ReactToMessage") {
          if (!session.reactToMessage) {
            throw new Error("Message reactions are not available for this session.");
          }

          failureCode = "internal";
          result = await session.reactToMessage(execution.input, input.toolCallId);
        } else {
          const workspace = session.workspace;
          const backends = await toolsForWorkspace(workspace);

          const backendNames = Object.hasOwn(BACKEND_NAMES, input.toolId)
            ? // SAFETY: hasOwn limits the tool id to the backend mapping keys.
              BACKEND_NAMES[input.toolId as keyof typeof BACKEND_NAMES]
            : [];

          const backendName = backendNames.find((name) => executable(backends[name]));
          const backend = backendName ? backends[backendName] : undefined;

          if (!executable(backend)) throw new Error(`Tool '${input.toolId}' has no backend.`);

          failureCode = "internal";
          result = await backend.execute(decoded, {
            ...(workspace ? { workspace } : {}),
            requestContext: new RequestContext(),
            observe: {
              span: async <A>(_name: string, run: () => A | Promise<A>) => run(),
              log: () => undefined,
            },
          });
        }

        if (field(result, "phase") === "failure") {
          const summary = field(result, "summary");
          emitReceipt(input, "failure", {
            failureCode,
            summary: Predicate.isString(summary) ? summary : "Tool execution failed.",
          });

          return result;
        }

        emitReceipt(input, "success");

        return result;
      } catch (cause) {
        emitReceipt(input, "failure", { failureCode, summary: "Tool execution failed." });
        throw cause;
      } finally {
        if (executionSession) await options?.onToolFinish?.(input, executionSession);
      }
    },
  };
}

export {
  type OttoRuntimeToolId,
  type OttoRuntimeToolDefinition,
  type OttoToolSession,
  type OttoToolRuntimeOptions,
  type OttoToolExecution,
  type OttoToolRuntime,
} from "./tools/otto-tool-types.ts";

export { intersectDelegationAccess } from "./tools/otto-tool-authorization.ts";
