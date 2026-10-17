import { it } from "@effect/vitest";
import {
  AuthSessionId,
  BotId,
  type ComputerWatchError,
  ThreadId,
  WS_METHODS,
} from "@otto/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { assert, describe } from "vite-plus/test";

import { createWsToolHandlers } from "./ws-tool-handlers.ts";

const threadId = ThreadId.make("thread-group");

function watch(personId: string, turnRunning: boolean) {
  // The handler reads only these members; nothing else on the connection is called.
  const connection = {
    currentPersonId: AuthSessionId.make(personId),
    observeRpcEffect: <A, E>(_method: string, effect: Effect.Effect<A, E>) => effect,
    agentController: {
      computerWatch: () =>
        Effect.succeed({
          botId: BotId.make("bot-1"),
          turnRunning,
          url: Effect.succeed("https://desktop.example/secret"),
        }),
    },
    projectionBots: {
      getById: () =>
        Effect.succeed(
          Option.some({ owner: { kind: "person", personId: "owner", displayName: "Owner" } }),
        ),
    },
    projectionSnapshotQuery: {
      getThreadShellById: () => Effect.succeed(Option.some({ id: threadId, groupId: "group-1" })),
    },
    projectionGroups: {
      getById: () =>
        Effect.succeed(
          Option.some({
            groupId: "group-1",
            members: [
              { kind: "person", personId: "ana" },
              { kind: "bot", botId: "bot-1" },
            ],
          }),
        ),
    },
  } as never;

  const handlers = createWsToolHandlers(connection);

  return handlers[WS_METHODS.computerWatch]({ threadId }).pipe(
    Effect.map(({ url }) => url),
    Effect.catchTag("ComputerWatchError", (error: ComputerWatchError) =>
      Effect.succeed(`refused: ${error.message}`),
    ),
  );
}

describe("computer.watch", () => {
  it.effect("lets the owner watch any time and the chat's people only while the bot works", () =>
    Effect.gen(function* () {
      const results = yield* Effect.all([
        watch("owner", false),
        watch("ana", true),
        watch("ana", false),
        watch("stranger", true),
      ]);

      assert.deepEqual(
        results.map((result) => result.startsWith("https://")),
        [true, true, false, false],
      );
    }),
  );
});
