import type * as RpcGroup from "effect/unstable/rpc/RpcGroup";
import * as Effect from "effect/Effect";
import { type Memory, MemoryError, WS_METHODS, WsRpcGroup } from "@otto/contracts";

import { personMemory, type StoredMemory, TEAM_MEMORY } from "./memory/memories.ts";
import { canSeeThread } from "./orchestration/group-visibility.ts";
import type { WsConnection } from "./ws-connection.ts";

/** Otto: everyone sees and edits the team's memory and their own, never someone else's. */
export const createWsMemoryHandlers = ({
  memories,
  currentPersonId,
  projectionSnapshotQuery,
  observeRpcEffect,
}: Pick<
  WsConnection,
  "memories" | "currentPersonId" | "projectionSnapshotQuery" | "observeRpcEffect"
>) => {
  const own = personMemory(currentPersonId);
  const reachable = [TEAM_MEMORY, own];

  /** The memory service, and each line as this person sees it. */
  const reach = Effect.gen(function* () {
    if (memories === null) {
      return yield* Effect.fail(new MemoryError({ message: "Memory is unavailable." }));
    }

    const snapshot = yield* projectionSnapshotQuery
      .getShellSnapshot()
      .pipe(Effect.mapError(() => new MemoryError({ message: "Memory could not be read." })));

    const chats = new Map(
      snapshot.threads
        .filter((thread) => canSeeThread(thread, snapshot.groups, currentPersonId))
        .map((thread) => [String(thread.id), thread.title]),
    );

    const projects = new Map(
      snapshot.projects.map((project) => [String(project.id), project.title]),
    );

    const view = ({ resource, ...row }: StoredMemory): Memory => ({
      ...row,
      owner: resource === TEAM_MEMORY ? "team" : "you",
      projectTitle: row.projectId ? (projects.get(row.projectId) ?? null) : null,
      threadTitle: row.threadId ? (chats.get(row.threadId) ?? null) : null,
    });

    return { memories, view };
  });

  return {
    [WS_METHODS.memoryList]: () =>
      observeRpcEffect(
        WS_METHODS.memoryList,
        reach.pipe(
          Effect.flatMap(({ memories, view }) =>
            memories.list(reachable).pipe(Effect.map((rows) => ({ memories: rows.map(view) }))),
          ),
        ),
        { "rpc.aggregate": "memory" },
      ),

    [WS_METHODS.memoryCreate]: ({ owner, projectId, text }) =>
      observeRpcEffect(
        WS_METHODS.memoryCreate,
        reach.pipe(
          Effect.flatMap(({ memories, view }) =>
            memories
              .create({
                resource: owner === "team" ? TEAM_MEMORY : own,
                projectId,
                personId: currentPersonId,
                text,
              })
              .pipe(Effect.map(view)),
          ),
        ),
        { "rpc.aggregate": "memory" },
      ),

    [WS_METHODS.memoryUpdate]: ({ id, projectId, text }) =>
      observeRpcEffect(
        WS_METHODS.memoryUpdate,
        reach.pipe(
          Effect.flatMap(({ memories, view }) =>
            memories
              .update({ resources: reachable, personId: currentPersonId, id, projectId, text })
              .pipe(Effect.map(view)),
          ),
        ),
        { "rpc.aggregate": "memory" },
      ),

    [WS_METHODS.memoryDelete]: ({ id }) =>
      observeRpcEffect(
        WS_METHODS.memoryDelete,
        reach.pipe(Effect.flatMap(({ memories }) => memories.remove(reachable, id))),
        { "rpc.aggregate": "memory" },
      ),
  } satisfies Pick<
    RpcGroup.HandlersFrom<RpcGroup.Rpcs<typeof WsRpcGroup>>,
    | typeof WS_METHODS.memoryList
    | typeof WS_METHODS.memoryCreate
    | typeof WS_METHODS.memoryUpdate
    | typeof WS_METHODS.memoryDelete
  >;
};
