import * as Schema from "effect/Schema";
import {
  AuthSessionId,
  BotId,
  IsoDateTime,
  ThreadId,
  TrimmedNonEmptyString,
} from "./base-schemas.ts";

/** Where a memory applies: one person, one bot, one group chat, one project or the workspace. */
export const MemoryScope = Schema.Literals(["person", "bot", "group", "project", "workspace"]);

export type MemoryScope = typeof MemoryScope.Type;

/** Characters a scope may hold, pending entries included. */
export const MEMORY_SCOPE_CAPS: Readonly<Record<MemoryScope, number>> = {
  person: 1_500,
  bot: 1_500,
  group: 1_500,
  project: 2_000,
  workspace: 2_000,
};

export const MEMORY_TEXT_MAX_CHARS = 280;

/** The scope id of the one workspace a server holds. */
export const WORKSPACE_MEMORY_SCOPE_ID = "workspace";

export const MemoryText = TrimmedNonEmptyString.check(Schema.isMaxLength(MEMORY_TEXT_MAX_CHARS));

export const Memory = Schema.Struct({
  id: TrimmedNonEmptyString,
  scope: MemoryScope,
  scopeId: TrimmedNonEmptyString,
  text: Schema.String,
  status: Schema.Literals(["active", "pending"]),
  /** A pending proposal to change or delete this entry; empty text means delete. */
  replacesId: Schema.NullOr(TrimmedNonEmptyString),
  botId: Schema.NullOr(BotId),
  personId: Schema.NullOr(AuthSessionId),
  threadId: Schema.NullOr(ThreadId),
  /** The source chat's title, when the viewer can see that chat. */
  threadTitle: Schema.optional(Schema.NullOr(Schema.String)),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export type Memory = typeof Memory.Type;

/** One scope of a bot's memory as a person sees it in the panel. */
export const MemorySection = Schema.Struct({
  scope: MemoryScope,
  scopeId: TrimmedNonEmptyString,
  /** The group or project name; empty for the other scopes. */
  title: Schema.String,
  used: Schema.Number,
  cap: Schema.Number,
  memories: Schema.Array(Memory),
});

export type MemorySection = typeof MemorySection.Type;

export const MemoryListInput = Schema.Struct({ botId: BotId });

export type MemoryListInput = typeof MemoryListInput.Type;

export const MemoryListResult = Schema.Struct({ sections: Schema.Array(MemorySection) });

export type MemoryListResult = typeof MemoryListResult.Type;

export const MemoryCreateInput = Schema.Struct({
  scope: MemoryScope,
  scopeId: TrimmedNonEmptyString,
  text: MemoryText,
});

export type MemoryCreateInput = typeof MemoryCreateInput.Type;

export const MemoryUpdateInput = Schema.Struct({ id: TrimmedNonEmptyString, text: MemoryText });

export type MemoryUpdateInput = typeof MemoryUpdateInput.Type;

export const MemoryDeleteInput = Schema.Struct({ id: TrimmedNonEmptyString });

export type MemoryDeleteInput = typeof MemoryDeleteInput.Type;

export const MemoryDecideInput = Schema.Struct({
  id: TrimmedNonEmptyString,
  decision: Schema.Literals(["approve", "reject"]),
  /** The approver's edit of the proposed text. */
  text: Schema.optional(MemoryText),
});

export type MemoryDecideInput = typeof MemoryDecideInput.Type;

export class MemoryError extends Schema.TaggedErrorClass<MemoryError>()("MemoryError", {
  message: TrimmedNonEmptyString,
}) {}

/** Thread activity kinds for project and workspace approvals, keyed by the pending memory id. */
export const MEMORY_APPROVAL_REQUESTED_ACTIVITY = "memory.approval.requested";

export const MEMORY_APPROVAL_RESOLVED_ACTIVITY = "memory.approval.resolved";

export const MemoryApprovalRequest = Schema.Struct({
  memoryId: TrimmedNonEmptyString,
  scope: Schema.Literals(["project", "workspace"]),
  action: Schema.Literals(["add", "update", "delete"]),
  text: Schema.String,
  /** The entry's current text, for an update or delete. */
  previousText: Schema.NullOr(Schema.String),
  /** The project's name, empty for the workspace. */
  title: Schema.String,
  authorBotId: Schema.NullOr(BotId),
});

export type MemoryApprovalRequest = typeof MemoryApprovalRequest.Type;

export const MemoryApprovalResolution = Schema.Struct({
  memoryId: TrimmedNonEmptyString,
  status: Schema.Literals(["approved", "rejected"]),
});

export type MemoryApprovalResolution = typeof MemoryApprovalResolution.Type;
