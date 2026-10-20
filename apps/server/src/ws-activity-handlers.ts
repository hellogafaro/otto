import * as NodeCrypto from "node:crypto";

import { ActivityRequestError, CommandId, TaskId, WS_METHODS, WsRpcGroup } from "@otto/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import type * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import { listProjects } from "./project/project-list.ts";
import { deleteTaskComment, updateTaskComment } from "./tasks/task-comments.ts";
import { getTask } from "./tasks/task-get.ts";
import { listTasks } from "./tasks/task-list.ts";
import type { WsConnection } from "./ws-connection.ts";

/**
 * Project and task lists, tasks and timelines are read by anyone who can read the workspace; comments
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

    [WS_METHODS.tasksGet]: (input) =>
      observeRpcEffect(WS_METHODS.tasksGet, getTask(input, { projectionTasks }), {
        "rpc.aggregate": "tasks",
      }),

    [WS_METHODS.activityList]: (input) =>
      observeRpcEffect(WS_METHODS.activityList, activityStore.list(input), {
        "rpc.aggregate": "activity",
      }),

    [WS_METHODS.activityCommentCreate]: (input) =>
      observeRpcEffect(
        WS_METHODS.activityCommentCreate,
        // Otto: A comment is a task event, so every open timeline refreshes and bots can react.
        Effect.gen(function* () {
          const commentId = NodeCrypto.randomUUID();

          yield* dispatchFromClient({
            type: "task.comment.create",
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

    [WS_METHODS.activityCommentUpdate]: (input) =>
      observeRpcEffect(
        WS_METHODS.activityCommentUpdate,
        updateTaskComment(
          { ...input, by: { type: "person", id: currentPersonId } },
          { activityStore, dispatch: dispatchFromClient },
        ),
        { "rpc.aggregate": "activity" },
      ),

    [WS_METHODS.activityCommentDelete]: (input) =>
      observeRpcEffect(
        WS_METHODS.activityCommentDelete,
        deleteTaskComment(
          { ...input, by: { type: "person", id: currentPersonId } },
          { activityStore, dispatch: dispatchFromClient },
        ).pipe(Effect.asVoid),
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
    | typeof WS_METHODS.tasksGet
    | typeof WS_METHODS.activityList
    | typeof WS_METHODS.activityCommentCreate
    | typeof WS_METHODS.activityCommentUpdate
    | typeof WS_METHODS.activityCommentDelete
    | typeof WS_METHODS.notificationsList
    | typeof WS_METHODS.notificationsMarkRead
  >;
