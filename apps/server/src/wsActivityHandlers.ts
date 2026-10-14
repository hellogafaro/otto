import { WS_METHODS, WsRpcGroup } from "@otto/contracts";
import type * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import type { WsConnection } from "./wsConnection.ts";

/** Timelines are read by anyone who can read the workspace; comments act as the signed-in person. */
export const createWsActivityHandlers = ({
  activityStore,
  currentPersonId,
  observeRpcEffect,
}: Pick<WsConnection, "activityStore" | "currentPersonId" | "observeRpcEffect">) =>
  ({
    [WS_METHODS.activityList]: (input) =>
      observeRpcEffect(WS_METHODS.activityList, activityStore.list(input), {
        "rpc.aggregate": "activity",
      }),

    [WS_METHODS.activityCommentAdd]: (input) =>
      observeRpcEffect(
        WS_METHODS.activityCommentAdd,
        activityStore.addComment({
          ...input,
          fileIds: input.fileIds ?? [],
          personId: currentPersonId,
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
