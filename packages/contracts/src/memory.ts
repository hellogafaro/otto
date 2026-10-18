import * as Schema from "effect/Schema";
import {
  AuthSessionId,
  IsoDateTime,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./base-schemas.ts";

/** Whose a memory is: the whole team's, or the viewer's own. */
export const MemoryOwner = Schema.Literals(["team", "you"]);

export type MemoryOwner = typeof MemoryOwner.Type;

/** Lines each scope keeps (team or a person, everywhere or in one project). */
export const MEMORY_CAP = 40;

/** A line nobody confirms for this long is forgotten. */
export const MEMORY_EXPIRY_DAYS = 60;

export const MEMORY_TEXT_MAX_CHARS = 280;

export const MemoryText = TrimmedNonEmptyString.check(Schema.isMaxLength(MEMORY_TEXT_MAX_CHARS));

export const Memory = Schema.Struct({
  id: TrimmedNonEmptyString,
  owner: MemoryOwner,
  /** The one project it is true in, or null when it is true everywhere. */
  projectId: Schema.NullOr(ProjectId),
  projectTitle: Schema.optional(Schema.NullOr(Schema.String)),
  text: Schema.String,
  /** The chat it was learned in, when there is one. */
  threadId: Schema.NullOr(ThreadId),
  /** The source chat's title, when the viewer can see that chat. */
  threadTitle: Schema.optional(Schema.NullOr(Schema.String)),
  /** The person who added or last edited it; the bot keeps their wording. */
  editedBy: Schema.NullOr(AuthSessionId),
  createdAt: IsoDateTime,
  /** When it was added, edited or last came up again. */
  confirmedAt: IsoDateTime,
});

export type Memory = typeof Memory.Type;

export const MemoryListInput = Schema.Struct({});

export type MemoryListInput = typeof MemoryListInput.Type;

export const MemoryListResult = Schema.Struct({ memories: Schema.Array(Memory) });

export type MemoryListResult = typeof MemoryListResult.Type;

export const MemoryCreateInput = Schema.Struct({
  owner: MemoryOwner,
  projectId: Schema.NullOr(ProjectId),
  text: MemoryText,
});

export type MemoryCreateInput = typeof MemoryCreateInput.Type;

export const MemoryUpdateInput = Schema.Struct({
  id: TrimmedNonEmptyString,
  projectId: Schema.NullOr(ProjectId),
  text: MemoryText,
});

export type MemoryUpdateInput = typeof MemoryUpdateInput.Type;

export const MemoryDeleteInput = Schema.Struct({ id: TrimmedNonEmptyString });

export type MemoryDeleteInput = typeof MemoryDeleteInput.Type;

export class MemoryError extends Schema.TaggedErrorClass<MemoryError>()("MemoryError", {
  message: TrimmedNonEmptyString,
}) {}
