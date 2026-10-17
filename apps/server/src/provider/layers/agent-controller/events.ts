import { GROUP_NO_REPLY } from "../../../orchestration/group-responder.ts";
import { readSdkRecord } from "../protocol-json.ts";
import * as Match from "effect/Match";
import { omitNullToolFields } from "./policy.ts";
import * as Predicate from "effect/Predicate";
import type { McpManager } from "@mastra/code-sdk/mcp/index";
import { ottoToolCategory } from "../../otto-mastra-harness.ts";
import type { OttoToolRuntime } from "../../otto-tool-runtime.ts";
import type { RuntimeMode } from "@otto/contracts";
import type { OttoRuntimeSeam } from "../../otto-runtime-seam.ts";
import type { AgentControllerLiveOptions } from "./options.ts";

import type { AgentControllerEvent, MastraDBMessage } from "@mastra/core/agent-controller";

import {
  RuntimeItemId,
  RuntimeRequestId,
  TurnId,
  OTTO_TOOL_CATALOG,
  type ProviderRuntimeEvent,
  ThreadId,
  OTTO_CREATE_ROUTINE_TOOL_NAME,
} from "@otto/contracts";

import { ServerConfig } from "../../../config.ts";

import { SubscriptionAuthService } from "../../../subscription-auth/service.ts";
import { ottoActionNeedsApproval, criticalOttoAction } from "../../otto-mastra-harness.ts";
import {
  alwaysAllowCovers,
  alwaysAllowKinds,
  isOttoProposal,
  proposedBotInstructions,
} from "../../mastra/otto-actions.ts";

import { type OttoChannelRuntime } from "../../otto-channel-runtime.ts";
import { type OttoBotStateRuntime } from "../../otto-bot-state-runtime.ts";

import {
  createOttoPluginRuntime,
  type OttoPluginRuntimeOptions,
} from "../../otto-catalog-tool-handlers.ts";

import { isMemoryToolId } from "../../otto-tool-runtime.ts";

import { OttoSessionResources } from "../../otto-session-resources.ts";

import { LegacyProviderBridge } from "../../services/legacy-provider-bridge.ts";

import {
  type ActiveAssistantMessage,
  type ActiveTurn,
  type ActiveSession,
  type PendingApproval,
} from "./state.ts";

import { nowIso, eventId } from "./event-identity.ts";
import { mcpServerIdForToolName } from "./mcp-configuration.ts";

// A retried model stream starts its message over, but Mastra keeps the failed
// attempt's text parts in the live message. Parts listed here are left out of
// the published answer.
const abandonedTextParts = new WeakSet<object>();

/** Drops text the failed stream attempt produced that was not yet published. */
export function abandonUnpublishedText(turn: ActiveTurn) {
  for (const message of turn.assistantMessages.values()) {
    let published = message.publishedText.length;

    for (const part of message.parts) {
      if (part.type !== "text" || abandonedTextParts.has(part)) continue;

      if (published >= part.text.length) {
        published -= part.text.length;
        continue;
      }

      abandonedTextParts.add(part);
      published = 0;
    }

    message.text = message.publishedText;
  }
}

type MessageDelta = Extract<AgentControllerEvent, { type: "message_update" }>["event"];

/**
 * Folds one streamed delta into the message, the same way Mastra's display
 * state does. Text parts are extended in place so abandoned parts keep their identity.
 */
function applyMessageDelta(message: MastraDBMessage, delta: MessageDelta) {
  const parts = message.content.parts;

  if (delta.type === "part") {
    parts[delta.index] = structuredClone(delta.part);

    return;
  }

  if (delta.type === "reasoning-delta") {
    const part = parts[delta.index];

    if (part?.type !== "reasoning") return;
    const reasoning = part.reasoning + delta.delta;

    parts[delta.index] = { ...part, reasoning, details: [{ type: "text", text: reasoning }] };

    return;
  }

  const part = parts.findLast((candidate) => candidate.type === "text");

  if (part?.type === "text") part.text += delta.delta;
  else parts.push({ type: "text", text: delta.delta });
}

export function createEvents(deps: {
  readonly forkPromise: OttoRuntimeSeam["forkPromise"];
  readonly runPromise: OttoRuntimeSeam["runPromise"];
  readonly publish: (event: ProviderRuntimeEvent) => void;
  readonly messageText: (message: MastraDBMessage) => string;
  readonly itemType: (
    toolName: string,
  ) => "command_execution" | "file_change" | "mcp_tool_call" | "dynamic_tool_call";
  readonly config: ServerConfig["Service"];
  readonly subscriptionAuth: SubscriptionAuthService;
  readonly cancelPendingApproval: (
    threadId: ThreadId,
    active: ActiveSession,
    requestId: string,
    pending: PendingApproval,
  ) => void;
  readonly sessionResources: OttoSessionResources;
  readonly APPROVAL_FREE_MASTRA_TOOL_NAMES: ReadonlySet<string>;
  readonly omitNullToolFields: typeof omitNullToolFields;
  readonly mcpToolNeedsApproval: (manager: McpManager | undefined, toolName: string) => boolean;
  readonly permissionPolicy: (
    runtimeMode: RuntimeMode,
    category: ReturnType<typeof ottoToolCategory>,
  ) => "allow" | "ask";
  readonly legacyProviderBridge: LegacyProviderBridge["Service"];
  readonly toolRuntime: OttoToolRuntime;
  readonly failActiveTurn: (
    active: ActiveSession,
    threadId: ThreadId,
    turnId: TurnId,
    cause: unknown,
  ) => Promise<void>;
  readonly wired: () => {
    readonly channelRuntime?: OttoChannelRuntime;
    readonly pluginRuntime?: ReturnType<typeof createOttoPluginRuntime>;
    readonly pluginRuntimeOptions?: OttoPluginRuntimeOptions;
    readonly botStateRuntime?: OttoBotStateRuntime;
    readonly delegationRuntime?: AgentControllerLiveOptions["delegationRuntime"];
  };
  readonly approvalDetail: (toolName: string, action: string | null, oneUse: boolean) => string;
  readonly sessionFailureDetail: (
    active: Pick<ActiveSession, "mcpServerIds">,
    cause: unknown,
  ) => string;
  readonly finishTurn: (
    threadId: ThreadId,
    active: ActiveSession,
    state: "completed" | "failed" | "interrupted",
    errorMessage?: string,
  ) => void;
  readonly adoptRun: (threadId: ThreadId, active: ActiveSession) => void;
}) {
  const baseEvent = (
    threadId: ThreadId,
    active: Pick<ActiveSession, "provider" | "providerInstanceId">,
    turnId?: TurnId,
  ) => ({
    eventId: eventId(),
    provider: active.provider,
    providerInstanceId: active.providerInstanceId,
    threadId,
    createdAt: nowIso(),
    ...(turnId ? { turnId } : {}),
  });

  const publishSessionState = (
    threadId: ThreadId,
    active: ActiveSession,
    state: "ready" | "running" | "waiting" | "stopped" | "error",
    reason?: string,
  ) => {
    active.status = Match.value(state).pipe(
      Match.when("running", () => "running" as const),
      Match.when("error", () => "error" as const),
      Match.when("stopped", () => "closed" as const),
      Match.orElse(() => "ready" as const),
    );
    deps.publish({
      ...baseEvent(threadId, active, active.activeTurn?.turnId),
      type: "session.state.changed",
      payload: { state, ...(reason ? { reason } : {}) },
    });
  };

  const completeAssistantMessage = (
    threadId: ThreadId,
    active: ActiveSession,
    turn: ActiveTurn,
    message: ActiveAssistantMessage,
  ) => {
    // A group bot that passes answers only this word, and nobody sees it.
    if (message.text.trim() === GROUP_NO_REPLY) {
      message.publishedText = message.text;

      return;
    }

    const text = message.text.startsWith(message.publishedText)
      ? message.text.slice(message.publishedText.length)
      : message.text;

    if (text.length === 0) return;

    if (turn.posted) {
      turn.assistantText += text;
      message.publishedText = message.text;

      return;
    }

    const itemId = RuntimeItemId.make(
      `mastra-answer-${message.messageId}${message.revision === 0 ? "" : `-${message.revision}`}`,
    );

    deps.publish({
      ...baseEvent(threadId, active, turn.turnId),
      itemId,
      type: "item.started",
      payload: { itemType: "assistant_message", status: "inProgress" },
    });
    deps.publish({
      ...baseEvent(threadId, active, turn.turnId),
      itemId,
      type: "content.delta",
      payload: { streamKind: "assistant_text", delta: text },
    });
    turn.assistantText += text;
    deps.publish({
      ...baseEvent(threadId, active, turn.turnId),
      itemId,
      type: "item.completed",
      payload: { itemType: "assistant_message", status: "completed" },
    });
    message.publishedText = message.text;
    message.revision += 1;
  };

  const completeAssistantMessages = (
    threadId: ThreadId,
    active: ActiveSession,
    turn: ActiveTurn,
  ) => {
    for (const message of turn.assistantMessages.values()) {
      completeAssistantMessage(threadId, active, turn, message);
    }
  };

  const streamingMessages = new Map<string, MastraDBMessage>();

  const publishAssistantText = (
    threadId: ThreadId,
    active: ActiveSession,
    message: MastraDBMessage,
    complete: boolean,
  ) => {
    if (message.role !== "assistant") return;
    const turn = active.activeTurn;

    if (!turn) return;
    const parts = message.content.parts;

    const text = deps.messageText({
      ...message,
      content: { ...message.content, parts: parts.filter((part) => !abandonedTextParts.has(part)) },
    });

    const messageKey = String(message.id);
    let activeMessage = turn.assistantMessages.get(messageKey);

    if (!activeMessage) {
      completeAssistantMessages(threadId, active, turn);
      activeMessage = {
        messageId: messageKey,
        parts,
        text: "",
        publishedText: "",
        revision: 0,
      };
      turn.assistantMessages.set(messageKey, activeMessage);
    }

    activeMessage.parts = parts;
    activeMessage.text = text;

    if (complete) completeAssistantMessage(threadId, active, turn, activeMessage);
  };

  const handleControllerEvent = (
    threadId: ThreadId,
    active: ActiveSession,
    event: AgentControllerEvent,
  ) => {
    const turn = active.activeTurn;

    const publishToolReceipt = (
      toolCallId: string,
      toolId: string,
      phase: "start" | "progress" | "success" | "failure",
    ) => {
      const billedBotId = active.toolSession.billedBotId;

      if (!billedBotId || !turn) return;
      const createdAt = nowIso();
      deps.publish({
        ...baseEvent(threadId, active, turn.turnId),
        type: "tool.receipt",
        payload: {
          receiptId: `${toolCallId}:${phase}`,
          toolId,
          phase,
          threadId,
          botId: billedBotId,
          billedBotId,
          fatalToThread: false,
          createdAt,
        },
      });
    };

    switch (event.type) {
      case "agent_start":
        deps.adoptRun(threadId, active);

        return;
      case "message_start": {
        const message = structuredClone(event.message);

        streamingMessages.set(message.id, message);
        publishAssistantText(threadId, active, message, false);

        return;
      }

      case "message_update": {
        const message = streamingMessages.get(event.id);

        if (!message) return;
        applyMessageDelta(message, event.event);
        publishAssistantText(threadId, active, message, false);

        return;
      }

      case "message_end": {
        const message = streamingMessages.get(event.id);

        if (!message) return;
        streamingMessages.delete(event.id);
        publishAssistantText(threadId, active, message, true);

        return;
      }

      case "tool_start": {
        if (!turn) return;
        completeAssistantMessages(threadId, active, turn);
        active.toolNames.set(event.toolCallId, event.toolName);
        publishToolReceipt(event.toolCallId, event.toolName, "start");
        deps.publish({
          ...baseEvent(threadId, active, turn.turnId),
          itemId: RuntimeItemId.make(event.toolCallId),
          type: "item.started",
          payload: {
            itemType: deps.itemType(event.toolName),
            status: "inProgress",
            title: event.toolName,
            data: { args: event.args },
          },
        });

        return;
      }

      case "tool_update":
        if (!turn) return;
        publishToolReceipt(
          event.toolCallId,
          active.toolNames.get(event.toolCallId) ?? "tool",
          "progress",
        );
        deps.publish({
          ...baseEvent(threadId, active, turn.turnId),
          itemId: RuntimeItemId.make(event.toolCallId),
          type: "item.updated",
          payload: {
            itemType: deps.itemType(active.toolNames.get(event.toolCallId) ?? "tool"),
            status: "inProgress",
            data: { partialResult: event.partialResult },
          },
        });

        return;
      case "tool_end": {
        if (!turn) return;
        const toolName = active.toolNames.get(event.toolCallId) ?? "tool";

        active.approvalRequests.delete(event.toolCallId);
        active.toolNames.delete(event.toolCallId);
        const mcpServerId = mcpServerIdForToolName(active.mcpServerIds, toolName);

        if (mcpServerId && !event.denied) {
          if (event.isError) {
            deps.subscriptionAuth.recordMcpRequestFailure(
              mcpServerId,
              "The MCP tool request failed.",
            );
          } else {
            deps.subscriptionAuth.recordMcpRequestSuccess(mcpServerId);
          }
        }

        publishToolReceipt(
          event.toolCallId,
          toolName,
          event.isError || event.denied ? "failure" : "success",
        );
        const pending = active.pendingApprovals.get(event.toolCallId);

        if (pending) {
          deps.cancelPendingApproval(threadId, active, event.toolCallId, pending);
          active.pendingApprovals.delete(event.toolCallId);
        }

        deps.publish({
          ...baseEvent(threadId, active, turn.turnId),
          itemId: RuntimeItemId.make(event.toolCallId),
          type: "item.completed",
          payload: {
            itemType: deps.itemType(toolName),
            status: event.isError ? "failed" : event.denied ? "declined" : "completed",
            title: toolName,
            data: { result: event.result },
          },
        });

        return;
      }

      case "tool_approval_required": {
        if (!turn) return;
        completeAssistantMessages(threadId, active, turn);
        active.toolNames.set(event.toolCallId, event.toolName);
        const mcpManager = deps.sessionResources.getMcpManager(String(threadId));
        const connectorTools = mcpManager?.getTools();

        if (
          deps.APPROVAL_FREE_MASTRA_TOOL_NAMES.has(event.toolName) &&
          (!connectorTools || !Object.hasOwn(connectorTools, event.toolName))
        ) {
          active.session.respondToToolApproval({
            toolCallId: event.toolCallId,
            decision: "approve",
          });

          return;
        }

        const toolInput = deps.omitNullToolFields(event.args);
        const action = criticalOttoAction(event.toolName, toolInput);
        const instructions = proposedBotInstructions(event.toolName, toolInput);

        const oneUseApproval =
          ottoActionNeedsApproval(event.toolName, toolInput) ||
          deps.mcpToolNeedsApproval(mcpManager, event.toolName);

        const proposal = isOttoProposal(event.toolName, toolInput);

        // A person chose Always allow for this bot and this tool, for every kind of action in it.
        const alwaysAllowed = alwaysAllowCovers(
          active.toolSession.alwaysAllowed ?? [],
          event.toolName,
          toolInput,
        );

        if (
          alwaysAllowed ||
          (!oneUseApproval &&
            deps.permissionPolicy(active.runtimeMode, ottoToolCategory(event.toolName)) === "allow")
        ) {
          deps.forkPromise(
            "Otto could not approve an allowed tool call.",
            () =>
              deps.runPromise(
                deps.legacyProviderBridge.dispatchIfEnabled(
                  active.providerInstanceId,
                  "AgentController.handleControllerEvent",
                  () => {
                    if (active.activeTurn !== turn || turn.finished) return;

                    // Otto runtime tools check their own grant before running.
                    const runtimeToolId =
                      OTTO_TOOL_CATALOG.find((tool) => tool.id === event.toolName)?.id ??
                      (isMemoryToolId(event.toolName) ? event.toolName : undefined);

                    if (runtimeToolId) {
                      deps.toolRuntime.grantApproval({
                        threadId: String(threadId),
                        toolCallId: event.toolCallId,
                        toolId: runtimeToolId,
                        input: event.args,
                      });
                    }

                    active.session.respondToToolApproval({
                      toolCallId: event.toolCallId,
                      decision: "approve",
                    });
                  },
                ),
              ),
            {
              annotations: { threadId, turnId: turn.turnId, toolCallId: event.toolCallId },
              onFailure: (cause) => {
                if (active.activeTurn !== turn || turn.finished) return;

                return deps.failActiveTurn(active, threadId, turn.turnId, cause);
              },
            },
          );

          return;
        }

        active.approvalRequests.set(event.toolCallId, {
          name: event.toolName,
          input: toolInput,
        });
        active.pendingApprovals.set(event.toolCallId, {
          toolName: event.toolName,
          action: action ?? "unclassified",
        });
        turn.waiting = true;
        publishSessionState(threadId, active, "waiting");
        deps.publish({
          ...baseEvent(threadId, active, turn.turnId),
          requestId: RuntimeRequestId.make(event.toolCallId),
          type: "request.opened",
          payload: {
            requestType: "dynamic_tool_call",
            actor: "agent",
            target: event.toolName,
            detail:
              event.toolName === OTTO_CREATE_ROUTINE_TOOL_NAME
                ? "Review routine"
                : event.toolName === "skill_create" || event.toolName === "skill_update"
                  ? "Review skill"
                  : instructions !== null
                    ? `Change this bot's instructions to:\n\n${instructions}`
                    : deps.approvalDetail(event.toolName, action, oneUseApproval),
            toolName: event.toolName,
            ...(action ? { action } : {}),
            args: toolInput,
            options:
              event.toolName === OTTO_CREATE_ROUTINE_TOOL_NAME
                ? [
                    { decision: "accept", label: "Create routine" },
                    { decision: "decline", label: "Cancel" },
                  ]
                : proposal
                  ? [
                      { decision: "decline", label: "Decline" },
                      { decision: "accept", label: "Approve" },
                    ]
                  : alwaysAllowKinds(event.toolName, toolInput)?.length === 1
                    ? [
                        { decision: "decline", label: "Never" },
                        { decision: "acceptAlways", label: "Always allow" },
                        { decision: "accept", label: "Allow once" },
                      ]
                    : [
                        { decision: "decline", label: "Never" },
                        { decision: "accept", label: "Allow once" },
                      ],
          },
        });

        return;
      }

      case "tool_suspended":
        if (!turn) return;
        completeAssistantMessages(threadId, active, turn);
        active.toolNames.set(event.toolCallId, event.toolName);
        turn.suspendedToolCalls.add(event.toolCallId);
        turn.waiting = true;
        publishSessionState(threadId, active, "waiting");

        const suspendPayload = readSdkRecord(event.suspendPayload) ?? {};

        const question =
          Predicate.isString(suspendPayload.question) && suspendPayload.question.trim()
            ? suspendPayload.question.trim()
            : `Input required for ${event.toolName}`;

        const options = Array.isArray(suspendPayload.options)
          ? suspendPayload.options.flatMap((option) => {
              const value = readSdkRecord(option);

              if (!value) return [];

              if (!Predicate.isString(value.label) || !value.label.trim()) return [];
              const label = value.label.trim();

              return [
                {
                  label,
                  description:
                    Predicate.isString(value.description) && value.description.trim()
                      ? value.description.trim()
                      : label,
                },
              ];
            })
          : [];

        deps.publish({
          ...baseEvent(threadId, active, turn.turnId),
          requestId: RuntimeRequestId.make(event.toolCallId),
          type: "user-input.requested",
          payload: {
            questions: [
              {
                id: event.toolCallId,
                header: "Question",
                question,
                options,
                multiSelect: suspendPayload.selectionMode === "multi_select",
              },
            ],
          },
        });

        return;
      case "usage_update":
        if (!turn) return;
        turn.inputTokens += Math.max(0, event.usage.promptTokens ?? 0);
        turn.cachedInputTokens += Math.max(0, event.usage.cachedInputTokens ?? 0);
        turn.cacheCreationTokens += Math.max(0, event.usage.cacheCreationInputTokens ?? 0);
        turn.outputTokens += Math.max(0, event.usage.completionTokens ?? 0);
        turn.reasoningTokens += Math.max(0, event.usage.reasoningTokens ?? 0);
        deps.publish({
          ...baseEvent(threadId, active, turn.turnId),
          type: "thread.token-usage.updated",
          payload: {
            usage: {
              usedTokens: turn.inputTokens + turn.outputTokens,
              inputTokens: turn.inputTokens,
              cachedInputTokens: turn.cachedInputTokens,
              cacheCreationTokens: turn.cacheCreationTokens,
              outputTokens: turn.outputTokens,
              reasoningOutputTokens: turn.reasoningTokens,
            },
          },
        });

        return;
      case "error": {
        const detail = deps.sessionFailureDetail(active, event.error);
        deps.publish({
          ...baseEvent(threadId, active, turn?.turnId),
          type: "runtime.error",
          payload: {
            message: detail,
            class: "provider_error",
          },
        });
        deps.finishTurn(threadId, active, "failed", detail);

        return;
      }

      case "agent_end":
        if (event.reason === "suspended") {
          if (turn) turn.waiting = true;
          publishSessionState(threadId, active, "waiting");

          return;
        }

        deps.finishTurn(
          threadId,
          active,
          Match.value(event.reason).pipe(
            Match.when("aborted", () => "interrupted" as const),
            Match.when("error", () => "failed" as const),
            Match.orElse(() => "completed" as const),
          ),
        );

        return;
      default:
        return;
    }
  };

  return {
    baseEvent,
    publishSessionState,
    completeAssistantMessage,
    completeAssistantMessages,
    publishAssistantText,
    handleControllerEvent,
  };
}
