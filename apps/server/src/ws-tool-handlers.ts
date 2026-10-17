import type * as RpcGroup from "effect/unstable/rpc/RpcGroup";
import { WS_METHODS, WsRpcGroup } from "@otto/contracts";

import type { WsConnection } from "./ws-connection.ts";

export const createWsToolHandlers = ({
  voiceCallOwnerId,
  currentPersonId,
  previewManager,
  observeRpcEffect,
  observeRpcStream,
  voiceCalls,
}: Pick<
  WsConnection,
  | "voiceCallOwnerId"
  | "currentPersonId"
  | "previewManager"
  | "observeRpcEffect"
  | "observeRpcStream"
  | "voiceCalls"
>) =>
  ({
    [WS_METHODS.voiceProviders]: () => voiceCalls.providers,

    [WS_METHODS.voiceConnect]: ({ provider, apiKey }) => voiceCalls.connect(provider, apiKey),

    [WS_METHODS.voiceDisconnect]: ({ provider }) => voiceCalls.disconnect(provider),

    [WS_METHODS.voiceTest]: ({ provider }) => voiceCalls.test(provider),

    [WS_METHODS.voiceListVoices]: ({ provider, cursor }) => voiceCalls.listVoices(provider, cursor),

    [WS_METHODS.voiceTranscribe]: (input) => voiceCalls.transcribe(input, voiceCallOwnerId),

    [WS_METHODS.voiceSynthesize]: (input) => voiceCalls.synthesize(input, voiceCallOwnerId),

    [WS_METHODS.voiceCancel]: ({ operationId }) => voiceCalls.cancel(operationId, voiceCallOwnerId),

    [WS_METHODS.voiceCallGet]: (_input) =>
      observeRpcEffect(WS_METHODS.voiceCallGet, voiceCalls.get, {
        "rpc.aggregate": "voice-call",
      }),

    [WS_METHODS.voiceCallStart]: (input) =>
      observeRpcEffect(
        WS_METHODS.voiceCallStart,
        voiceCalls.start(input, voiceCallOwnerId, currentPersonId),
        {
          "rpc.aggregate": "voice-call",
        },
      ),

    [WS_METHODS.voiceCallHangup]: ({ callId }) =>
      observeRpcEffect(WS_METHODS.voiceCallHangup, voiceCalls.hangup(callId, voiceCallOwnerId), {
        "rpc.aggregate": "voice-call",
      }),

    [WS_METHODS.previewOpen]: (input) =>
      observeRpcEffect(WS_METHODS.previewOpen, previewManager.open(input), {
        "rpc.aggregate": "preview",
      }),

    [WS_METHODS.previewNavigate]: (input) =>
      observeRpcEffect(WS_METHODS.previewNavigate, previewManager.navigate(input), {
        "rpc.aggregate": "preview",
      }),

    [WS_METHODS.previewResize]: (input) =>
      observeRpcEffect(WS_METHODS.previewResize, previewManager.resize(input), {
        "rpc.aggregate": "preview",
      }),

    [WS_METHODS.previewRefresh]: (input) =>
      observeRpcEffect(WS_METHODS.previewRefresh, previewManager.refresh(input), {
        "rpc.aggregate": "preview",
      }),

    [WS_METHODS.previewClose]: (input) =>
      observeRpcEffect(WS_METHODS.previewClose, previewManager.close(input), {
        "rpc.aggregate": "preview",
      }),

    [WS_METHODS.previewList]: (input) =>
      observeRpcEffect(WS_METHODS.previewList, previewManager.list(input), {
        "rpc.aggregate": "preview",
      }),

    [WS_METHODS.previewReportStatus]: (input) =>
      observeRpcEffect(WS_METHODS.previewReportStatus, previewManager.reportStatus(input), {
        "rpc.aggregate": "preview",
      }),

    [WS_METHODS.subscribePreviewEvents]: (input) =>
      observeRpcStream(WS_METHODS.subscribePreviewEvents, previewManager.streamEvents(input), {
        "rpc.aggregate": "preview",
      }),
  }) satisfies Pick<
    RpcGroup.HandlersFrom<RpcGroup.Rpcs<typeof WsRpcGroup>>,
    | typeof WS_METHODS.voiceProviders
    | typeof WS_METHODS.voiceConnect
    | typeof WS_METHODS.voiceDisconnect
    | typeof WS_METHODS.voiceTest
    | typeof WS_METHODS.voiceListVoices
    | typeof WS_METHODS.voiceTranscribe
    | typeof WS_METHODS.voiceSynthesize
    | typeof WS_METHODS.voiceCancel
    | typeof WS_METHODS.voiceCallGet
    | typeof WS_METHODS.voiceCallStart
    | typeof WS_METHODS.voiceCallHangup
    | typeof WS_METHODS.previewOpen
    | typeof WS_METHODS.previewNavigate
    | typeof WS_METHODS.previewResize
    | typeof WS_METHODS.previewRefresh
    | typeof WS_METHODS.previewClose
    | typeof WS_METHODS.previewList
    | typeof WS_METHODS.previewReportStatus
    | typeof WS_METHODS.subscribePreviewEvents
  >;
