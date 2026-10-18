import { type ProjectId, SecretsRequestError, WS_METHODS, WsRpcGroup } from "@otto/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import { canSeeThreadById } from "./orchestration/group-visibility.ts";
import { Secrets } from "./secrets/secrets.ts";
import type { WsConnection } from "./ws-connection.ts";

/**
 * Projects belong to the whole organization, so anyone who may operate it manages their
 * secrets; a chat's own values need someone who can see that chat.
 */
export const createWsSecretsHandlers = ({
  currentPersonId,
  observeRpcEffect,
  projectionSnapshotQuery,
  projectionGroups,
}: Pick<
  WsConnection,
  "currentPersonId" | "observeRpcEffect" | "projectionSnapshotQuery" | "projectionGroups"
>) => {
  const requireProject = (projectId: ProjectId) =>
    Effect.gen(function* () {
      const project = yield* projectionSnapshotQuery
        .getProjectShellById(projectId)
        .pipe(Effect.orElseSucceed(() => Option.none()));

      if (Option.isNone(project)) {
        return yield* new SecretsRequestError({ detail: "That project doesn't exist." });
      }
    });

  return {
    [WS_METHODS.secretsList]: ({ projectId }) =>
      observeRpcEffect(
        WS_METHODS.secretsList,
        Effect.gen(function* () {
          yield* requireProject(projectId);

          return { secrets: yield* (yield* Secrets).list(projectId) };
        }),
        { "rpc.aggregate": "secrets" },
      ),

    [WS_METHODS.secretsReveal]: ({ projectId, name }) =>
      observeRpcEffect(
        WS_METHODS.secretsReveal,
        Effect.gen(function* () {
          yield* requireProject(projectId);

          return { value: yield* (yield* Secrets).reveal(projectId, name) };
        }),
        { "rpc.aggregate": "secrets" },
      ),

    [WS_METHODS.secretsSave]: ({ target, values }) =>
      observeRpcEffect(
        WS_METHODS.secretsSave,
        Effect.gen(function* () {
          const service = yield* Secrets;

          if (target.scope === "project") {
            yield* requireProject(target.projectId);

            return yield* service.saveToProject(target.projectId, values);
          }

          const visible = yield* canSeeThreadById(
            { projectionSnapshotQuery, projectionGroups },
            target.threadId,
            currentPersonId,
            false,
          );

          if (!visible) {
            return yield* new SecretsRequestError({ detail: "That chat doesn't exist." });
          }

          return yield* service.saveToChat(target.threadId, values);
        }),
        { "rpc.aggregate": "secrets" },
      ),

    [WS_METHODS.secretsRemove]: ({ projectId, name }) =>
      observeRpcEffect(
        WS_METHODS.secretsRemove,
        Effect.gen(function* () {
          yield* requireProject(projectId);
          yield* (yield* Secrets).remove(projectId, name);
        }),
        { "rpc.aggregate": "secrets" },
      ),
  } satisfies Pick<
    RpcGroup.HandlersFrom<RpcGroup.Rpcs<typeof WsRpcGroup>>,
    | typeof WS_METHODS.secretsList
    | typeof WS_METHODS.secretsReveal
    | typeof WS_METHODS.secretsSave
    | typeof WS_METHODS.secretsRemove
  >;
};
