import * as Data from "effect/Data";
import * as Predicate from "effect/Predicate";
import type * as EffectAcpSchema from "effect-acp/schema";

import { type AcpPermissionRequest, type AcpParsedSessionEvent } from "./acp-runtime-types.ts";
import {
  normalizeToolKind,
  toolCallState,
  parseTypedToolCallState,
  boundToolCallRawPayload,
} from "./acp-tool-calls.ts";

function normalizePlanStepStatus(
  raw: EffectAcpSchema.PlanEntry["status"] | "inProgress",
): "pending" | "inProgress" | "completed" {
  switch (raw) {
    case "completed":
      return "completed";
    case "in_progress":
    case "inProgress":
      return "inProgress";
    default:
      return "pending";
  }
}

export function parsePermissionRequest(
  params: EffectAcpSchema.RequestPermissionRequest,
): AcpPermissionRequest {
  const toolCall = toolCallState(
    {
      toolCallId: params.toolCall.toolCallId,
      title: params.toolCall.title,
      kind: params.toolCall.kind,
      status: params.toolCall.status,
      rawInput: params.toolCall.rawInput,
      rawOutput: params.toolCall.rawOutput,
      content: params.toolCall.content,
      locations: params.toolCall.locations,
    },
    { fallbackStatus: "pending" },
  );

  const kind = normalizeToolKind(params.toolCall.kind) ?? "unknown";

  const detail =
    toolCall?.command ??
    toolCall?.title ??
    toolCall?.detail ??
    (Predicate.isString(params.sessionId) ? `Session ${params.sessionId}` : undefined);

  return {
    kind,
    ...(detail ? { detail } : {}),
    ...(toolCall ? { toolCall } : {}),
  };
}

export function parseSessionUpdateEvent(params: EffectAcpSchema.SessionNotification) {
  const upd = params.update;
  const events: Array<AcpParsedSessionEvent> = [];
  let modeId: string | undefined;

  switch (upd.sessionUpdate) {
    case "current_mode_update": {
      modeId = upd.currentModeId.trim();

      if (modeId) {
        events.push(parsedEvents.ModeChanged({ modeId }));
      }

      break;
    }

    case "plan": {
      const plan = upd.entries.map((entry, index) => ({
        step: entry.content.trim().length > 0 ? entry.content.trim() : `Step ${index + 1}`,
        status: normalizePlanStepStatus(entry.status),
      }));

      if (plan.length > 0) {
        events.push(
          parsedEvents.PlanUpdated({
            payload: {
              plan,
            },
            rawPayload: params,
          }),
        );
      }

      break;
    }

    case "tool_call": {
      const toolCall = parseTypedToolCallState(upd, {
        fallbackStatus: "pending",
      });

      if (toolCall) {
        events.push(
          parsedEvents.ToolCallUpdated({
            toolCall,
            rawPayload: boundToolCallRawPayload(params, upd, toolCall),
          }),
        );
      }

      break;
    }

    case "tool_call_update": {
      const toolCall = parseTypedToolCallState(upd);

      if (toolCall) {
        events.push(
          parsedEvents.ToolCallUpdated({
            toolCall,
            rawPayload: boundToolCallRawPayload(params, upd, toolCall),
          }),
        );
      }

      break;
    }

    case "agent_message_chunk": {
      if (upd.content.type === "text" && upd.content.text.length > 0) {
        events.push(parsedEvents.ContentDelta({ text: upd.content.text, rawPayload: params }));
      }

      break;
    }

    case "agent_thought_chunk": {
      const text = upd.content.type === "text" ? upd.content.text : "";
      events.push(parsedEvents.ProviderActivity({ text, rawPayload: params }));
      break;
    }

    default: {
      // usage_update, session_info_update, and the other updates we do not project
      // still mean the provider process is alive.
      events.push(parsedEvents.ProviderActivity({ text: "", rawPayload: params }));
      break;
    }
  }

  return { ...(modeId !== undefined ? { modeId } : {}), events };
}

export {
  type AcpSessionMode,
  type AcpSessionModeState,
  type AcpToolCallState,
  type AcpPlanUpdate,
  type AcpPermissionRequest,
  type AcpParsedSessionEvent,
  type AcpToolCallEmitDecisionInput,
  type AcpToolCallEmitDecision,
  type SessionLoadGate,
} from "./acp-runtime-types.ts";

export {
  extractModelConfigId,
  findSessionConfigOption,
  collectSessionConfigOptionValues,
  parseSessionModeState,
  sessionModelStateFromInitialize,
  syntheticLoadSessionResponseFromInitialize,
} from "./acp-session-model.ts";

export { mergeToolCallState, decideToolCallUpdateEmission } from "./acp-tool-calls.ts";

export { sessionUpdateIsReplay, waitForSessionLoadReplayIdle } from "./acp-session-replay.ts";

const parsedEvents = Data.taggedEnum<AcpParsedSessionEvent>();
