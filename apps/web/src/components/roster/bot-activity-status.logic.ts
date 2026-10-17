import type { MessageKey } from "@otto/client-runtime/i18n";
import { recordLookup } from "../record-lookup";
import { Predicate, Schema, Option } from "effect";
import {
  derivePendingApprovals,
  derivePendingUserInputs,
} from "@otto/client-runtime/pending-requests";
import {
  OTTO_CREATE_ROUTINE_TOOL_NAME,
  type OrchestrationLatestTurn,
  type OrchestrationThreadActivity,
} from "@otto/contracts";

/** What a tool works on, named by the view: a connected app by toolkit slug or an MCP server by id. */
export type BotActivitySubject =
  | { readonly kind: "app"; readonly slug: string }
  | { readonly kind: "server"; readonly id: string };

export interface BotActivity {
  /** Short present-tense update for what the bot is doing, without trailing dots. */
  readonly label: MessageKey;
  /** No tool is running: the bot is thinking between steps. */
  readonly thinking?: true;
  /** Shown as "Using {name}" once the view knows the subject's name. */
  readonly subject?: BotActivitySubject;
}

// Keyed by the tool name the runtime reports. Names come from the Otto tool
// catalog, the routine contracts, and the memory tool.
const TOOL_LABELS = {
  [OTTO_CREATE_ROUTINE_TOOL_NAME]: "Adding a routine",
  routine_delete: "Removing routines",
  routine_update: "Updating a routine",
  skill_read: "Reading a skill",
  search: "Searching",
  library_read: "Reading the library",
  library_create: "Saving to the library",
  library_update: "Editing a document",
  web_search: "Searching the web",
  web_fetch: "Reading a web page",
  image_create: "Making an image",
  ask_user: "Waiting for your answer",
  shell: "Running a command",
  read: "Reading files",
  bot_create: "Starting a helper",
  delegate_check: "Checking on a helper",
  delegate: "Messaging a helper",
  delegate_stop: "Stopping a helper",
  message_post: "Sending a message",
  message_react: "Reacting",
  connection_search: "Searching plugins",
  connection_read: "Checking connections",
  connection_create: "Adding a connection",
  connection_check: "Testing a connection",
  connection_delete: "Removing a connection",
  bot_update: "Updating profile",
  "Computer Use": "Using the computer",
} satisfies Readonly<Record<string, MessageKey>>;

const ITEM_TYPE_LABELS = {
  command_execution: "Running a command",
  file_change: "Editing files",
  web_search: "Searching the web",
  image_view: "Looking at an image",
  collab_agent_tool_call: "Starting a helper",
  mcp_tool_call: "Using a tool",
  dynamic_tool_call: "Using a tool",
} satisfies Readonly<Record<string, MessageKey>>;

const decodeActivityPayload = Schema.decodeUnknownOption(
  Schema.Struct({
    toolCallId: Schema.optionalKey(Schema.Unknown),
    itemType: Schema.optionalKey(Schema.Unknown),
    data: Schema.optionalKey(Schema.Unknown),
  }),
);

const decodeComposioCalls = Schema.decodeUnknownOption(
  Schema.Struct({
    args: Schema.Struct({ tools: Schema.Array(Schema.Struct({ tool_slug: Schema.String })) }),
  }),
);

const decodeMemoryData = Schema.decodeUnknownOption(
  Schema.Struct({
    memoryOperationCount: Schema.optionalKey(Schema.Unknown),
  }),
);

function payloadRecord(activity: OrchestrationThreadActivity) {
  return Option.getOrNull(decodeActivityPayload(activity.payload));
}

export function toolCallId(activity: OrchestrationThreadActivity): string {
  const id = payloadRecord(activity)?.toolCallId;

  return Predicate.isString(id) ? id : activity.id;
}

export function toolName(activity: OrchestrationThreadActivity): string {
  // `tool.started` summaries are "<tool name> started"; the name is not stored elsewhere.
  return activity.summary.replace(/ started$/, "");
}

// Task-list tools only update the bot's plan, so they never change the label.
export const TASK_LIST_TOOLS = new Set(["task_write", "TodoWrite"]);

function memoryLabel(activity: OrchestrationThreadActivity): MessageKey {
  const count = Option.getOrNull(
    decodeMemoryData(payloadRecord(activity)?.data),
  )?.memoryOperationCount;

  return Predicate.isNumber(count) && count > 0 ? "Saving to memory" : "Reading memory";
}

const COMPOSIO_TOOL_PREFIX = "composio-session_";

/** MCP tools reach the bot as `<server id>_<tool>`, and Otto's server ids are UUIDs. */
const MCP_TOOL_NAME = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_/i;

function composioActivity(activity: OrchestrationThreadActivity, name: string): BotActivity {
  if (name.endsWith("SEARCH_TOOLS")) return { label: "Looking for the right app" };

  const calls =
    Option.getOrNull(decodeComposioCalls(payloadRecord(activity)?.data))?.args.tools ?? [];

  const slug = calls[0]?.tool_slug.split("_", 1)[0]?.toLowerCase();

  return slug
    ? { label: "Using an app", subject: { kind: "app", slug } }
    : { label: "Using an app" };
}

/** Maps a `tool.started` activity to what the bot is shown doing while that tool runs. */
export function botToolActivity(activity: OrchestrationThreadActivity): BotActivity {
  const name = toolName(activity);

  if (name === "memory") return { label: memoryLabel(activity) };

  if (name.startsWith("preview_") || name.startsWith("browser_")) {
    return { label: "Using the browser" };
  }

  if (name.startsWith(COMPOSIO_TOOL_PREFIX)) return composioActivity(activity, name);
  const server = MCP_TOOL_NAME.exec(name)?.[1];

  if (server) return { label: "Using a tool", subject: { kind: "server", id: server } };
  const known = recordLookup(TOOL_LABELS, name);

  if (known) return { label: known };
  const itemType = payloadRecord(activity)?.itemType;

  return {
    label:
      (Predicate.isString(itemType) ? recordLookup(ITEM_TYPE_LABELS, itemType) : undefined) ??
      "Using a tool",
  };
}

/**
 * Describes the running turn from its runtime activities: an open request for
 * the user wins, then the newest unfinished tool call, and otherwise the bot
 * is working between steps.
 */
export function deriveBotActivity(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  latestTurn: OrchestrationLatestTurn | null,
): BotActivity {
  if (latestTurn?.state !== "running") return { label: "Starting" };
  const turnActivities = activities.filter((activity) => activity.turnId === latestTurn.turnId);

  if (derivePendingUserInputs(turnActivities).length > 0) {
    return { label: "Waiting for your answer" };
  }

  if (derivePendingApprovals(turnActivities).length > 0) return { label: "Waiting for approval" };

  const openTools = new Map<string, OrchestrationThreadActivity>();

  for (const activity of turnActivities) {
    if (activity.kind === "tool.started" && !TASK_LIST_TOOLS.has(toolName(activity))) {
      openTools.set(toolCallId(activity), activity);
    } else if (activity.kind === "tool.completed") {
      openTools.delete(toolCallId(activity));
    }
  }

  const openTool = [...openTools.values()].at(-1);

  return openTool ? botToolActivity(openTool) : { label: "Working", thinking: true };
}
