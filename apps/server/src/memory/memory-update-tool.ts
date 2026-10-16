import { type AuthSessionId, MemoryScope } from "@otto/contracts";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { OttoToolExecution } from "../provider/tools/otto-tool-types.ts";
import type { Memories, MemoryChat } from "./memories.ts";

export type MemoryUpdateToolId = "memory_update";

export const MEMORY_UPDATE_TOOL_ID: MemoryUpdateToolId = "memory_update";

export const MemoryUpdateToolInput = Schema.Struct({
  changes: Schema.Array(
    Schema.Struct({
      action: Schema.Literals(["add", "update", "delete"]).annotate({
        description: "add a new entry, update an entry's text, or delete an entry.",
      }),
      id: Schema.NullOr(Schema.String).annotate({
        description: "Entry id from <memory>, such as m_7kq2. Null when adding.",
      }),
      scope: Schema.NullOr(MemoryScope).annotate({
        description: "Where a new entry goes. Null when updating or deleting.",
      }),
      text: Schema.NullOr(Schema.String).annotate({
        description:
          "One short declarative fact, such as 'Prefers short replies.'. Null when deleting.",
      }),
    }),
  )
    .check(Schema.isMinLength(1), Schema.isMaxLength(10))
    .annotate({ description: "Changes applied in order." }),
});

export const MEMORY_UPDATE_TOOL_DESCRIPTION =
  "Add, update or delete entries in <memory>. Use person for facts about the person who wrote to you, bot for your role and work conventions (never facts about a person), and group, project or workspace for shared facts; project and workspace changes wait for a person's approval. Update the existing entry instead of adding a near-duplicate, and skip one-off details, task progress and secrets.";

export const MEMORY_UPDATE_TOOL_PROMPT = {
  snippet: "save, correct or delete what you remember",
  guidelines: [
    "When someone states a durable fact or preference, save it with memory_update in the same turn, quietly; facts about a person go to person, never bot.",
    "Memory is a dated snapshot. When it conflicts with what someone says now or what you can see (a task, the code, a page), trust the current source and update or delete the entry in the same turn.",
  ],
};

export type MemoryToolHandler = (
  input: Omit<OttoToolExecution, "toolId"> & { readonly toolId: MemoryUpdateToolId },
) => Promise<Schema.JsonObject>;

const decodeInput = Schema.decodeUnknownSync(MemoryUpdateToolInput);

/** The memory_update tool for one thread; its current turn is read when the call runs. */
export function createMemoryUpdateHandler(input: {
  readonly turn: () =>
    | { readonly chat: MemoryChat; readonly authorPersonId: AuthSessionId | null }
    | undefined;
  readonly enabled: () => Promise<boolean>;
  readonly memories: Memories["Service"];
  readonly run: <A, E>(effect: Effect.Effect<A, E>) => Promise<A>;
}): MemoryToolHandler {
  return async ({ input: raw }) => {
    const turn = input.turn();

    if (!turn) throw new Error("Memory is unavailable in this chat.");

    if (!(await input.enabled())) throw new Error("Memory is turned off in Settings.");

    const changes = await input.run(
      input.memories.applyChanges({
        ...turn,
        changes: decodeInput(raw, { onExcessProperty: "error" }).changes,
      }),
    );

    const pending = changes.some((change) => change.status === "pending_approval");

    return {
      changes: changes.map((change) => ({ id: change.id, status: change.status })),
      ...(pending
        ? {
            note: "Project and workspace changes wait for a person's approval in this chat. Say so once and do not propose them again.",
          }
        : {}),
    };
  };
}
