import * as NodeCrypto from "node:crypto";

import { ActivityRequestError, CommandId, TaskId, WS_METHODS, WsRpcGroup } from "@otto/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import type * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import type { WsConnection } from "./ws-connection.ts";

/** Timelines are read by anyone who can read the workspace; comments act as the signed-in person. */
export const createWsActivityHandlers = ({
  activityStore,
  currentPersonId,
  dispatchFromClient,
  observeRpcEffect,
}: Pick<
  WsConnection,
  "activityStore" | "currentPersonId" | "dispatchFromClient" | "observeRpcEffect"
>) =>
  ({
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
  }) satisfies Pick<
    RpcGroup.HandlersFrom<RpcGroup.Rpcs<typeof WsRpcGroup>>,
    | typeof WS_METHODS.activityList
    | typeof WS_METHODS.activityCommentAdd
    | typeof WS_METHODS.activityCommentRemove
  >;
