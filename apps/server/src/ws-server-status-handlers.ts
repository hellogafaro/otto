import type * as RpcGroup from "effect/unstable/rpc/RpcGroup";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { WS_METHODS, WsRpcGroup } from "@otto/contracts";
import { getRemoteDoctorStatus, repairRemoteDoctor } from "./remote/remote-doctor-rpc.ts";

import type { WsConnection } from "./ws-connection.ts";

export const createWsServerStatusHandlers = ({
  remoteDoctorTarget,
  lifecycleEvents,
  backgroundPolicy,
  usage,
  observeRpcEffect,
  observeRpcStream,
  observeRpcStreamEffect,
}: Pick<
  WsConnection,
  | "remoteDoctorTarget"
  | "lifecycleEvents"
  | "backgroundPolicy"
  | "usage"
  | "observeRpcEffect"
  | "observeRpcStream"
  | "observeRpcStreamEffect"
>) =>
  ({
    [WS_METHODS.serverGetUsageSummary]: (input) =>
      observeRpcEffect(WS_METHODS.serverGetUsageSummary, usage.readSummary(input), {
        "rpc.aggregate": "server",
      }),

    [WS_METHODS.serverReportHostPowerState]: (input) =>
      observeRpcEffect(
        WS_METHODS.serverReportHostPowerState,
        backgroundPolicy.reportHostPowerState(input),
        { "rpc.aggregate": "server" },
      ),

    [WS_METHODS.serverGetBackgroundPolicy]: (_input) =>
      observeRpcEffect(WS_METHODS.serverGetBackgroundPolicy, backgroundPolicy.snapshot, {
        "rpc.aggregate": "server",
      }),

    [WS_METHODS.serverGetRemoteDoctor]: (_input) =>
      observeRpcEffect(
        WS_METHODS.serverGetRemoteDoctor,
        getRemoteDoctorStatus(remoteDoctorTarget),
        { "rpc.aggregate": "server" },
      ),

    [WS_METHODS.serverRepairRemoteDoctor]: (input) =>
      observeRpcEffect(
        WS_METHODS.serverRepairRemoteDoctor,
        repairRemoteDoctor({ ...remoteDoctorTarget, request: input }),
        { "rpc.aggregate": "server" },
      ),

    [WS_METHODS.subscribeServerLifecycle]: (_input) =>
      observeRpcStreamEffect(
        WS_METHODS.subscribeServerLifecycle,
        Effect.gen(function* () {
          const snapshot = yield* lifecycleEvents.snapshot;

          const snapshotEvents = Array.from(snapshot.events).toSorted(
            (left, right) => left.sequence - right.sequence,
          );

          const liveEvents = lifecycleEvents.stream.pipe(
            Stream.filter((event) => event.sequence > snapshot.sequence),
          );

          return Stream.concat(Stream.fromIterable(snapshotEvents), liveEvents);
        }),
        { "rpc.aggregate": "server" },
      ),

    [WS_METHODS.subscribeBackgroundPolicy]: (_input) =>
      observeRpcStream(
        WS_METHODS.subscribeBackgroundPolicy,
        Stream.unwrap(
          Effect.map(backgroundPolicy.subscribe, ({ latest, changes }) =>
            Stream.concat(Stream.make(latest), changes),
          ),
        ),
        { "rpc.aggregate": "server" },
      ),
  }) satisfies Pick<
    RpcGroup.HandlersFrom<RpcGroup.Rpcs<typeof WsRpcGroup>>,
    | typeof WS_METHODS.serverGetUsageSummary
    | typeof WS_METHODS.serverReportHostPowerState
    | typeof WS_METHODS.serverGetBackgroundPolicy
    | typeof WS_METHODS.serverGetRemoteDoctor
    | typeof WS_METHODS.serverRepairRemoteDoctor
    | typeof WS_METHODS.subscribeServerLifecycle
    | typeof WS_METHODS.subscribeBackgroundPolicy
  >;
