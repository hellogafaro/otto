import type * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type { OttoRuntimeSeam } from "../../otto-runtime-seam.ts";
import type { ChatMemory, Memories } from "../../../memory/memories.ts";
import { chatTimeZone } from "../../otto-agent-instructions.ts";

/** A chat's memory section, empty while Memory is off. */
export function createMemoryAccess(deps: {
  readonly runPromise: OttoRuntimeSeam["runPromise"];
  readonly memories: Option.Option<Memories["Service"]>;
  readonly memoryEnabled: () => Effect.Effect<boolean>;
}) {
  const memoryContext = async (
    memory: ChatMemory | undefined,
    timezone: string | undefined,
  ): Promise<string> =>
    memory && Option.isSome(deps.memories) && (await deps.runPromise(deps.memoryEnabled()))
      ? deps.runPromise(deps.memories.value.render(memory, chatTimeZone(timezone)))
      : "";

  return { memoryContext };
}
