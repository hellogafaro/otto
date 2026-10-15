import type { ActivityValue, ActivityRecord } from "./ActivityPayloadBounds.ts";
import * as Predicate from "effect/Predicate";
import type {
  OrchestrationEvent,
  OrchestrationThreadActivity,
  OrchestrationThreadDetailSnapshot,
} from "@otto/contracts";
import { OttoPluginSearchResult } from "@otto/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { asRecord, asTrimmedString, projectBoundedValue } from "./ActivityPayloadBounds.ts";
import {
  summarizeToolTextOutput,
  projectCommandData,
  projectCommandValue,
  collectChangedFiles,
} from "./CommandActivityPayload.ts";
import { projectMcpToolCallData } from "./McpActivityPayload.ts";
import {
  dropSupersededToolUpdatedActivities,
  dropStaleContextWindowActivities,
} from "./ActivityRetention.ts";

const decodePluginSearchResult = Schema.decodeUnknownOption(OttoPluginSearchResult);

/**
 * Task-list tools (Otto's `task_write`, Claude's `TodoWrite`) carry the whole
 * list in their args. Clients only show the step in progress, as a short status.
 */
function projectMemoryOperationCount(data: ActivityRecord): number | undefined {
  const operations = asRecord(data.args)?.operations;

  return Array.isArray(operations) ? operations.length : undefined;
}

function projectRawOutput(value: ActivityValue): ActivityRecord | undefined {
  const direct = asTrimmedString(value);

  if (direct) {
    const summary = summarizeToolTextOutput(direct);

    return summary ? { content: summary } : undefined;
  }

  const rawOutput = asRecord(value);

  if (!rawOutput) {
    return undefined;
  }

  if (Predicate.isNumber(rawOutput.totalFiles) && Number.isFinite(rawOutput.totalFiles)) {
    return {
      totalFiles: rawOutput.totalFiles,
      ...(rawOutput.truncated === true ? { truncated: true } : {}),
    };
  }

  const content = asTrimmedString(rawOutput.content);

  if (content) {
    const summary = summarizeToolTextOutput(content);

    return summary ? { content: summary } : undefined;
  }

  const stdout = asTrimmedString(rawOutput.stdout);

  if (stdout) {
    const summary = summarizeToolTextOutput(stdout);

    return summary ? { content: summary } : undefined;
  }

  const stderr = asTrimmedString(rawOutput.stderr);

  if (stderr) {
    const summary = summarizeToolTextOutput(stderr);

    return summary ? { content: summary } : undefined;
  }

  return undefined;
}

function projectAcpContent(value: ActivityValue): ActivityRecord | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const text = value
    .map((entryValue) => {
      const entry = asRecord(entryValue);
      const content = asRecord(entry?.content);

      return entry?.type === "content" && content?.type === "text"
        ? asTrimmedString(content.text)
        : null;
    })
    .filter((entry): entry is string => entry !== null)
    .join("\n");

  const summary = summarizeToolTextOutput(text);

  return summary ? { content: summary } : undefined;
}

/**
 * The argument that names what an Otto tool worked on, shown beside the step in a reply's trace.
 * Only arguments that say what a step touched, never content: memory notes, messages, questions
 * and anything from a person's connected accounts stay out.
 */
const TOOL_DETAIL_ARGS = {
  WebSearch: "query",
  WebFetch: "url",
  SearchPlugins: "query",
  GetPlugin: "pluginId",
  Read: "path",
  ExternalRead: "path",
  SaveToLibrary: "title",
  otto_create_routine: "name",
  browser_navigate: "url",
  preview_open: "url",
} as const satisfies Readonly<Record<string, string>>;

const MAX_TRACE_DETAIL_LENGTH = 160;

/** A command's output in a reply's trace: the start of it, never the whole run log. */
const MAX_TRACE_OUTPUT_LENGTH = 1_500;

const COMPOSIO_TOOL_PREFIX = "composio-session_";

function clip(value: string, max: number) {
  return value.length <= max
    ? value
    : `${Array.from(value.slice(0, max - 1))
        .join("")
        .trimEnd()}…`;
}

function projectToolDetail(toolName: string, args: ActivityValue): string | undefined {
  // SAFETY: `toolName` is an own key of TOOL_DETAIL_ARGS whenever the lookup runs.
  const key = Object.hasOwn(TOOL_DETAIL_ARGS, toolName)
    ? TOOL_DETAIL_ARGS[toolName as keyof typeof TOOL_DETAIL_ARGS]
    : undefined;

  const value = key ? asTrimmedString(asRecord(args)?.[key]) : null;

  return value ? clip(value.replace(/\s+/g, " "), MAX_TRACE_DETAIL_LENGTH) : undefined;
}

/** Which apps a Composio call used, so the step can say "Using Google Calendar". */
function projectComposioTools(args: ActivityValue): ActivityRecord | undefined {
  const tools = asRecord(args)?.tools;

  if (!Array.isArray(tools)) return undefined;

  const slugs = tools
    .map((tool) => asTrimmedString(asRecord(tool)?.tool_slug))
    .filter((slug): slug is string => slug !== null)
    .slice(0, 8);

  return slugs.length > 0 ? { tools: slugs.map((slug) => ({ tool_slug: slug })) } : undefined;
}

function projectPluginSearchResult(value: ActivityValue): OttoPluginSearchResult | undefined {
  const decoded = decodePluginSearchResult(value);

  if (Option.isNone(decoded)) return undefined;

  return {
    ...decoded.value,
    recommendations: decoded.value.recommendations.slice(0, 6),
  };
}

/**
 * Removes activity payload fields that no current client reads while retaining
 * the full payload in persistence and the event store.
 */
export function projectActivityPayload(
  activity: OrchestrationThreadActivity,
): OrchestrationThreadActivity {
  const payload = asRecord(activity.payload);
  const data = asRecord(payload?.data);

  if (!payload || !data) {
    return activity;
  }

  const itemStatus = asRecord(data.item)?.status;

  const projectedPayload =
    payload.status === "completed" && (itemStatus === "failed" || itemStatus === "declined")
      ? { ...payload, status: itemStatus }
      : payload;

  if (payload.itemType === "mcp_tool_call") {
    return {
      ...activity,
      payload: {
        ...projectedPayload,
        data: projectMcpToolCallData(data),
      },
    };
  }

  if (payload.itemType === "dynamic_tool_call" && activity.summary === "SearchPlugins") {
    const result = projectPluginSearchResult(data.result);

    if (result) {
      return {
        ...activity,
        payload: {
          ...projectedPayload,
          data: {
            result,
            ...(data.toolCallId !== undefined ? { toolCallId: data.toolCallId } : {}),
          },
        },
      };
    }
  }

  const projectedData: ActivityRecord = {};
  const item = projectCommandData(data);

  if (item) {
    projectedData.item = item;
  }

  const command = projectCommandValue(data);

  if (command !== undefined) {
    projectedData.command = projectBoundedValue(command);
  }

  const changedFiles: string[] = [];
  collectChangedFiles(data, changedFiles, new Set<string>(), 0);

  if (changedFiles.length > 0) {
    // Both clients discover file names by walking objects with path-like keys.
    projectedData.files = changedFiles.map((path) => ({ path }));
  }

  if ("toolCallId" in data) {
    projectedData.toolCallId = data.toolCallId;
  }

  if ("kind" in data) {
    projectedData.kind = data.kind;
  }

  const memoryOperationCount = projectMemoryOperationCount(data);

  if (memoryOperationCount !== undefined) {
    projectedData.memoryOperationCount = memoryOperationCount;
  }

  const toolName = activity.summary.replace(/ started$/, "");
  // Snapshots can be projected twice (detail read, then the HTTP response), so keep what a
  // previous pass already kept.
  const detail = projectToolDetail(toolName, data.args) ?? asTrimmedString(data.detail);

  if (detail) {
    projectedData.detail = detail;
  }

  const composioTools = toolName.startsWith(COMPOSIO_TOOL_PREFIX)
    ? projectComposioTools(data.args)
    : undefined;

  if (composioTools) {
    projectedData.args = composioTools;
  }

  const commandOutput =
    payload.itemType === "command_execution"
      ? (asTrimmedString(data.result) ?? asTrimmedString(data.output))
      : null;

  if (commandOutput) {
    projectedData.output = clip(commandOutput, MAX_TRACE_OUTPUT_LENGTH);
  }

  const rawOutput = projectRawOutput(data.rawOutput) ?? projectAcpContent(data.content);

  if (rawOutput) {
    projectedData.rawOutput = rawOutput;
  }

  return {
    ...activity,
    payload: {
      ...projectedPayload,
      data: projectedData,
    },
  };
}

export function projectThreadDetailSnapshot(
  snapshot: OrchestrationThreadDetailSnapshot,
): OrchestrationThreadDetailSnapshot {
  return {
    ...snapshot,
    thread: {
      ...snapshot.thread,
      activities: dropSupersededToolUpdatedActivities(
        dropStaleContextWindowActivities(snapshot.thread.activities),
      ).map(projectActivityPayload),
    },
  };
}

// Published events are immutable and shared by every live subscriber. Project
// each one once so subscribers share the projected object, which also lets the
// live stream budget reuse its serialized-size measurement.
const projectedActivityEvents = new WeakMap<OrchestrationEvent, OrchestrationEvent>();

export function projectActivityEvent(event: OrchestrationEvent): OrchestrationEvent {
  if (event.type !== "thread.activity-appended") {
    return event;
  }

  const cached = projectedActivityEvents.get(event);

  if (cached !== undefined) {
    return cached;
  }

  const projected: OrchestrationEvent = {
    ...event,
    payload: {
      ...event.payload,
      activity: projectActivityPayload(event.payload.activity),
    },
  };

  projectedActivityEvents.set(event, projected);
  // Mark the result as already projected so a repeat call returns it unchanged.
  projectedActivityEvents.set(projected, projected);

  return projected;
}
