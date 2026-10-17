import type { AuthSessionId } from "@otto/contracts";
import type * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type { OttoRuntimeSeam } from "../../otto-runtime-seam.ts";
import type { Memories, MemoryChat } from "../../../memory/memories.ts";
import { createMemoryUpdateHandler } from "../../../memory/memory-update-tool.ts";
import { chatTimeZone } from "../../otto-agent-instructions.ts";

/** The chat and author of a thread's current turn, which its memory_update calls act for. */
export interface MemoryTurn {
  readonly chat: MemoryChat;
  readonly authorPersonId: AuthSessionId | null;
}

/** A chat's memory section and its memory_update tool, both off while Memory is off. */
export function createMemoryAccess(deps: {
  readonly runPromise: OttoRuntimeSeam["runPromise"];
  readonly memories: Option.Option<Memories["Service"]>;
  readonly memoryEnabled: () => Effect.Effect<boolean>;
  readonly memoryTurns: Map<string, MemoryTurn>;
}) {
  const memoryContext = async (
    chat: MemoryChat | undefined,
    timezone: string | undefined,
  ): Promise<string> =>
    chat && Option.isSome(deps.memories) && (await deps.runPromise(deps.memoryEnabled()))
      ? deps.runPromise(deps.memories.value.render(chat, chatTimeZone(timezone)))
      : "";

  const memoryHandlers = (threadId: string) =>
    Option.isSome(deps.memories)
      ? {
          memory_update: createMemoryUpdateHandler({
            turn: () => deps.memoryTurns.get(threadId),
            enabled: () => deps.runPromise(deps.memoryEnabled()),
            memories: deps.memories.value,
            run: deps.runPromise,
          }),
        }
      : undefined;

  return { memoryContext, memoryHandlers };
}
