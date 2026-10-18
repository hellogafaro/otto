import * as NodeCrypto from "node:crypto";

import { ActivityRequestError, CommandId, TaskId, WS_METHODS, WsRpcGroup } from "@otto/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import type * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import { listProjects } from "./project/project-list.ts";
import { listTasks } from "./tasks/task-list.ts";
import type { WsConnection } from "./ws-connection.ts";

/**
 * Project and task lists and timelines are read by anyone who can read the workspace; comments
 * act as the signed-in person.
 */
export const createWsActivityHandlers = ({
  activityStore,
  notificationStore,
  projectionTasks,
  projectionProjects,
  secretStore,
  currentPersonId,
  dispatchFromClient,
  observeRpcEffect,
}: Pick<
  WsConnection,
  | "activityStore"
  | "notificationStore"
  | "projectionTasks"
  | "projectionProjects"
  | "secretStore"
  | "currentPersonId"
  | "dispatchFromClient"
  | "observeRpcEffect"
>) =>
  ({
    [WS_METHODS.projectsList]: (input) =>
      observeRpcEffect(
        WS_METHODS.projectsList,
        listProjects(input, { projectionProjects, secretStore }),
        { "rpc.aggregate": "projects" },
      ),

    [WS_METHODS.tasksList]: (input) =>
      observeRpcEffect(WS_METHODS.tasksList, listTasks(input, { projectionTasks, secretStore }), {
        "rpc.aggregate": "tasks",
      }),

    [WS_METHODS.activityList]: (input) =>
      observeRpcEffect(WS_METHODS.activityList, activityStore.list(input), {
        "rpc.aggregate": "activity",
      }),

    [WS_METHODS.activityCommentAdd]: (input) =>
      observeRpcEffect(
        WS_METHODS.activityCommentAdd,
        // Otto: A comment is a task event, so every open timeline refreshes and bots can react.
        Effect.gen(function* () {
          const commentId = NodeCrypto.randomUUID();

          yield* dispatchFromClient({
            type: "task.comment.add",
            commandId: CommandId.make(`comment:${commentId}`),
            taskId: TaskId.make(input.entityId),
            commentId,
            content: input.content,
            fileIds: input.fileIds ?? [],
            by: { type: "person", id: currentPersonId },
            createdAt: DateTime.formatIso(yield* DateTime.now),
          }).pipe(Effect.mapError((error) => new ActivityRequestError({ detail: error.message })));

          return yield* activityStore.getComment(commentId);
        }),
        { "rpc.aggregate": "activity" },
      ),

    [WS_METHODS.activityCommentRemove]: (input) =>
      observeRpcEffect(
        WS_METHODS.activityCommentRemove,
        activityStore.removeComment({ ...input, personId: currentPersonId }),
        { "rpc.aggregate": "activity" },
      ),

    // Otto: A person only ever sees and clears their own notifications.
    [WS_METHODS.notificationsList]: () =>
      observeRpcEffect(WS_METHODS.notificationsList, notificationStore.list(currentPersonId), {
        "rpc.aggregate": "notifications",
      }),

    [WS_METHODS.notificationsMarkRead]: (input) =>
      observeRpcEffect(
        WS_METHODS.notificationsMarkRead,
        notificationStore.markRead({ personId: currentPersonId, ids: input.ids }),
        { "rpc.aggregate": "notifications" },
      ),
  }) satisfies Pick<
    RpcGroup.HandlersFrom<RpcGroup.Rpcs<typeof WsRpcGroup>>,
    | typeof WS_METHODS.projectsList
    | typeof WS_METHODS.tasksList
    | typeof WS_METHODS.activityList
    | typeof WS_METHODS.activityCommentAdd
    | typeof WS_METHODS.activityCommentRemove
    | typeof WS_METHODS.notificationsList
    | typeof WS_METHODS.notificationsMarkRead
  >;
