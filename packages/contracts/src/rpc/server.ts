import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import {
  ActivityCommentAddInput,
  ActivityCommentRemoveInput,
  ActivityEntry,
  ActivityEntity,
  ActivityListResult,
  ActivityRequestError,
} from "../orchestration/activity.ts";
import {
  NotificationListResult,
  NotificationMarkReadInput,
  NotificationRequestError,
} from "../orchestration/notifications.ts";
import {
  LibraryCreateDocumentInput,
  LibraryCreateDocumentResult,
  LibraryCreateSkillInput,
  LibraryCreateSkillResult,
  LibraryCreateFileUrlInput,
  LibraryCreateFileUrlResult,
  LibraryCreateUploadUrlInput,
  LibraryCreateUploadUrlResult,
  LibraryFileInput,
  LibraryReadDocumentResult,
  LibraryRequestError,
  LibrarySaveDocumentInput,
  LibrarySaveDocumentResult,
} from "../orchestration/library.ts";
import { OttoBotUsageInput, OttoBotUsageReadError, OttoBotUsageSnapshot } from "../otto-usage.ts";
import {
  Memory,
  MemoryCreateInput,
  MemoryDecideInput,
  MemoryDeleteInput,
  MemoryError,
  MemoryListInput,
  MemoryListResult,
  MemoryUpdateInput,
} from "../memory.ts";
import {
  OttoMemoryOperationError,
  OttoMemoryFactsListInput,
  OttoMemoryFactsListResult,
  OttoMemoryMutateInput,
  OttoMemoryMutationResult,
} from "../otto-memory/facts.ts";
import {
  OttoMemoryArchiveV2,
  OttoMemoryExportInput,
  OttoMemoryImportPreviewInput,
  OttoMemoryImportPreview,
  OttoMemoryImportApplyInput,
  OttoMemoryImportApplyResult,
  OttoMarkdownMemoryArchiveV3,
  OttoMarkdownMemoryExportInput,
  OttoMarkdownMemoryImportApplyInput,
  OttoMarkdownMemoryImportApplyResult,
  OttoMarkdownMemoryImportPreview,
  OttoMarkdownMemoryImportPreviewInput,
} from "../otto-memory/transfer.ts";
import {
  OttoMemoryDocumentsInspectInput,
  OttoMemoryDocumentsSnapshot,
  OttoMemoryDocumentReplaceInput,
  OttoMemoryDocument,
  OttoMemoryObservationsClearInput,
} from "../otto-memory/documents.ts";
import { ExternalLauncherError, LaunchEditorInput } from "../editor.ts";
import {
  AuthAccessStreamError,
  AuthAccessStreamEvent,
  EnvironmentAuthorizationError,
} from "../auth.ts";
import {
  BackgroundPolicySnapshot,
  ClientActivityReportInput,
  HostPowerSnapshot,
} from "../background.ts";
import {
  AssetAccessError,
  AssetCreateUrlInput,
  AssetCreateUrlResult,
  AttachmentCreateUploadUrlInput,
  AttachmentCreateUploadUrlResult,
  AttachmentDeleteInput,
  AttachmentNotFoundError,
  AttachmentRevealInput,
  AttachmentUploadSigningKeyError,
} from "../assets.ts";
import { KeybindingsConfigError } from "../keybindings.ts";
import {
  ProviderUploadFeedbackError,
  ProviderUploadFeedbackInput,
  ProviderUploadFeedbackResult,
  ComputerNotRunningError,
  ComputerWatchError,
  ComputerWatchInput,
  ComputerWatchResult,
} from "../provider.ts";
import { ProviderInstanceId } from "../provider-instance.ts";
import { DiscoveredLocalServerList, ConfiguredLocalServerUrls } from "../preview.ts";
import {
  ServerConfigStreamEvent,
  ServerConfig,
  ServerRemoveKeybindingInput,
  ServerRemoveKeybindingResult,
  ServerUpsertKeybindingInput,
  ServerUpsertKeybindingResult,
} from "../server/config.ts";
import {
  ServerProviderUpdateError,
  ServerProviderUpdateInput,
  ServerProviderUpdatedPayload,
  ServerSelfUpdateError,
  ServerSelfUpdateInput,
  ServerSelfUpdateProgressEvent,
  ServerSelfUpdateResult,
} from "../server/update.ts";
import { ServerLifecycleStreamEvent } from "../server/lifecycle.ts";
import { UsageReadError, UsageSummary, UsageSummaryInput } from "../usage.ts";
import {
  RemoteDoctorError,
  RemoteDoctorRepairInput,
  RemoteDoctorStatus,
} from "../remote-diagnostics.ts";
import { ServerSettings, ServerSettingsError, ServerSettingsRpcPatch } from "../settings/server.ts";
import {
  BotInboxItem,
  BotInboxResolveInput,
  McpServerAuthenticateInput,
  McpServerAuthenticationError,
  McpServerAuthenticationProgress,
  McpServerHeaders,
  McpServerHeadersError,
  McpServerSetHeadersInput,
  McpServerTools,
  McpServerToolsError,
  SubscriptionAuthAccountOrderInput,
  SubscriptionAuthAccountPausedInput,
  SubscriptionAuthCompleteInput,
  SubscriptionAuthError,
  SubscriptionAuthHealthTestInput,
  SubscriptionAuthLoginProgress,
  SubscriptionAuthLogoutInput,
  SubscriptionAuthPollInput,
  SubscriptionAuthStartInput,
  SubscriptionAuthStartResult,
  SubscriptionAuthStatuses,
} from "../subscription-auth.ts";
import {
  ImageGenerationError,
  ImageProviderHealthTestInput,
  ImageProviderListResult,
} from "../image-generation.ts";
import {
  VoiceCallError,
  VoiceCallHangupInput,
  VoiceCallSnapshot,
  VoiceCallStartInput,
  VoiceCallStartResult,
  VoiceProviderInput,
  VoiceConnectInput,
  VoiceProviderStatus,
  VoiceProvidersResult,
  VoiceListVoicesInput,
  VoiceListVoicesResult,
  VoiceListTranscriptionModelsInput,
  VoiceListTranscriptionModelsResult,
  VoiceTranscribeInput,
  VoiceTranscribeResult,
  VoiceSynthesizeInput,
  VoiceSynthesizeResult,
  VoiceCancelInput,
  VoiceCancelResult,
} from "../voice-call.ts";
import {
  RoutineListRunsInput,
  RoutineListRunsResult,
  RoutineListThreadRunsResult,
  RoutineListThreadRunsInput,
  RoutineReadError,
  RoutineThreadReadError,
} from "../routines.ts";
import {
  ComposioAuthorizeInput,
  ComposioAuthorizeResult,
  ComposioDisconnectInput,
  ComposioUpdateConnectionInput,
  ComposioOperationError,
  ComposioStatus,
  ComposioToolkit,
  ComposioToolkitSearchInput,
  ComposioGetToolkitInput,
  ComposioToolkitDetail,
} from "../composio.ts";
import {
  GitHubLinkCode,
  GitHubLinkPollResult,
  GitHubLinkTarget,
  GitHubOperationError,
  GitHubStatus,
} from "../github.ts";
import { WS_METHODS } from "./methods.ts";

export const WsServerUpsertKeybindingRpc = Rpc.make(WS_METHODS.serverUpsertKeybinding, {
  payload: ServerUpsertKeybindingInput,
  success: ServerUpsertKeybindingResult,
  error: Schema.Union([KeybindingsConfigError, EnvironmentAuthorizationError]),
});

export const WsServerRemoveKeybindingRpc = Rpc.make(WS_METHODS.serverRemoveKeybinding, {
  payload: ServerRemoveKeybindingInput,
  success: ServerRemoveKeybindingResult,
  error: Schema.Union([KeybindingsConfigError, EnvironmentAuthorizationError]),
});

export const WsServerProbeRpc = Rpc.make(WS_METHODS.serverProbe, {
  payload: Schema.Struct({}),
  success: Schema.Struct({}),
  error: EnvironmentAuthorizationError,
});

export const WsServerGetConfigRpc = Rpc.make(WS_METHODS.serverGetConfig, {
  payload: Schema.Struct({}),
  success: ServerConfig,
  error: Schema.Union([KeybindingsConfigError, ServerSettingsError, EnvironmentAuthorizationError]),
});

export const WsServerRefreshProvidersRpc = Rpc.make(WS_METHODS.serverRefreshProviders, {
  payload: Schema.Struct({
    /**
     * When supplied, only refresh this specific provider instance. When
     * omitted, refresh all configured instances — the legacy `refresh()`
     * behaviour retained for transports that still dispatch untargeted
     * refreshes.
     */
    instanceId: Schema.optional(ProviderInstanceId),
  }),
  success: ServerProviderUpdatedPayload,
  error: EnvironmentAuthorizationError,
});

export const WsServerUpdateProviderRpc = Rpc.make(WS_METHODS.serverUpdateProvider, {
  payload: ServerProviderUpdateInput,
  success: ServerProviderUpdatedPayload,
  error: Schema.Union([ServerProviderUpdateError, EnvironmentAuthorizationError]),
});

export const WsServerUpdateServerRpc = Rpc.make(WS_METHODS.serverUpdateServer, {
  payload: ServerSelfUpdateInput,
  success: ServerSelfUpdateResult,
  error: Schema.Union([ServerSelfUpdateError, EnvironmentAuthorizationError]),
});

export const WsServerUpdateServerWithProgressRpc = Rpc.make(
  WS_METHODS.serverUpdateServerWithProgress,
  {
    payload: ServerSelfUpdateInput,
    success: ServerSelfUpdateProgressEvent,
    error: Schema.Union([ServerSelfUpdateError, EnvironmentAuthorizationError]),
    stream: true,
  },
);

export const WsServerGetSettingsRpc = Rpc.make(WS_METHODS.serverGetSettings, {
  payload: Schema.Struct({}),
  success: ServerSettings,
  error: Schema.Union([ServerSettingsError, EnvironmentAuthorizationError]),
});

export const WsServerUpdateSettingsRpc = Rpc.make(WS_METHODS.serverUpdateSettings, {
  payload: Schema.Struct({ patch: ServerSettingsRpcPatch }),
  success: ServerSettings,
  error: Schema.Union([ServerSettingsError, EnvironmentAuthorizationError]),
});

export const WsComposioGetStatusRpc = Rpc.make(WS_METHODS.composioGetStatus, {
  payload: Schema.Struct({}),
  success: ComposioStatus,
  error: Schema.Union([ComposioOperationError, EnvironmentAuthorizationError]),
});

export const WsComposioSearchToolkitsRpc = Rpc.make(WS_METHODS.composioSearchToolkits, {
  payload: ComposioToolkitSearchInput,
  success: Schema.Array(ComposioToolkit),
  error: Schema.Union([ComposioOperationError, EnvironmentAuthorizationError]),
});

export const WsComposioGetToolkitRpc = Rpc.make(WS_METHODS.composioGetToolkit, {
  payload: ComposioGetToolkitInput,
  success: ComposioToolkitDetail,
  error: Schema.Union([ComposioOperationError, EnvironmentAuthorizationError]),
});

export const WsComposioAuthorizeRpc = Rpc.make(WS_METHODS.composioAuthorize, {
  payload: ComposioAuthorizeInput,
  success: ComposioAuthorizeResult,
  error: Schema.Union([ComposioOperationError, EnvironmentAuthorizationError]),
});

export const WsComposioDisconnectRpc = Rpc.make(WS_METHODS.composioDisconnect, {
  payload: ComposioDisconnectInput,
  success: ComposioStatus,
  error: Schema.Union([ComposioOperationError, EnvironmentAuthorizationError]),
});

export const WsComposioUpdateConnectionRpc = Rpc.make(WS_METHODS.composioUpdateConnection, {
  payload: ComposioUpdateConnectionInput,
  success: ComposioStatus,
  error: Schema.Union([ComposioOperationError, EnvironmentAuthorizationError]),
});

export const WsGitHubGetStatusRpc = Rpc.make(WS_METHODS.githubGetStatus, {
  payload: Schema.Struct({}),
  success: GitHubStatus,
  error: Schema.Union([GitHubOperationError, EnvironmentAuthorizationError]),
});

export const WsGitHubStartLinkRpc = Rpc.make(WS_METHODS.githubStartLink, {
  payload: GitHubLinkTarget,
  success: GitHubLinkCode,
  error: Schema.Union([GitHubOperationError, EnvironmentAuthorizationError]),
});

export const WsGitHubPollLinkRpc = Rpc.make(WS_METHODS.githubPollLink, {
  payload: GitHubLinkTarget,
  success: GitHubLinkPollResult,
  error: Schema.Union([GitHubOperationError, EnvironmentAuthorizationError]),
});

export const WsGitHubDisconnectRpc = Rpc.make(WS_METHODS.githubDisconnect, {
  payload: GitHubLinkTarget,
  success: GitHubStatus,
  error: Schema.Union([GitHubOperationError, EnvironmentAuthorizationError]),
});

export const WsSubscriptionAuthListRpc = Rpc.make(WS_METHODS.subscriptionAuthList, {
  payload: Schema.Struct({}),
  success: SubscriptionAuthStatuses,
  error: Schema.Union([SubscriptionAuthError, EnvironmentAuthorizationError]),
});

export const WsSubscriptionAuthStartRpc = Rpc.make(WS_METHODS.subscriptionAuthStart, {
  payload: SubscriptionAuthStartInput,
  success: SubscriptionAuthStartResult,
  error: Schema.Union([SubscriptionAuthError, EnvironmentAuthorizationError]),
});

export const WsSubscriptionAuthPollRpc = Rpc.make(WS_METHODS.subscriptionAuthPoll, {
  payload: SubscriptionAuthPollInput,
  success: SubscriptionAuthLoginProgress,
  error: Schema.Union([SubscriptionAuthError, EnvironmentAuthorizationError]),
});

export const WsSubscriptionAuthCompleteRpc = Rpc.make(WS_METHODS.subscriptionAuthComplete, {
  payload: SubscriptionAuthCompleteInput,
  success: SubscriptionAuthLoginProgress,
  error: Schema.Union([SubscriptionAuthError, EnvironmentAuthorizationError]),
});

export const WsSubscriptionAuthCancelRpc = Rpc.make(WS_METHODS.subscriptionAuthCancel, {
  payload: SubscriptionAuthPollInput,
  success: Schema.Struct({}),
  error: Schema.Union([SubscriptionAuthError, EnvironmentAuthorizationError]),
});

export const WsSubscriptionAuthLogoutRpc = Rpc.make(WS_METHODS.subscriptionAuthLogout, {
  payload: SubscriptionAuthLogoutInput,
  success: SubscriptionAuthStatuses,
  error: Schema.Union([SubscriptionAuthError, EnvironmentAuthorizationError]),
});

export const WsSubscriptionAuthHealthTestRpc = Rpc.make(WS_METHODS.subscriptionAuthHealthTest, {
  payload: SubscriptionAuthHealthTestInput,
  success: SubscriptionAuthStatuses,
  error: Schema.Union([SubscriptionAuthError, EnvironmentAuthorizationError]),
});

export const WsSubscriptionAuthSetAccountOrderRpc = Rpc.make(
  WS_METHODS.subscriptionAuthSetAccountOrder,
  {
    payload: SubscriptionAuthAccountOrderInput,
    success: SubscriptionAuthStatuses,
    error: Schema.Union([SubscriptionAuthError, EnvironmentAuthorizationError]),
  },
);

export const WsSubscriptionAuthSetAccountPausedRpc = Rpc.make(
  WS_METHODS.subscriptionAuthSetAccountPaused,
  {
    payload: SubscriptionAuthAccountPausedInput,
    success: SubscriptionAuthStatuses,
    error: Schema.Union([SubscriptionAuthError, EnvironmentAuthorizationError]),
  },
);

export const WsImageProviderListRpc = Rpc.make(WS_METHODS.imageProviderList, {
  payload: Schema.Struct({}),
  success: ImageProviderListResult,
  error: Schema.Union([ImageGenerationError, EnvironmentAuthorizationError]),
});

export const WsImageProviderHealthTestRpc = Rpc.make(WS_METHODS.imageProviderHealthTest, {
  payload: ImageProviderHealthTestInput,
  success: ImageProviderListResult,
  error: Schema.Union([ImageGenerationError, EnvironmentAuthorizationError]),
});

export const WsMcpServerAuthenticateRpc = Rpc.make(WS_METHODS.mcpServerAuthenticate, {
  payload: McpServerAuthenticateInput,
  success: McpServerAuthenticationProgress,
  error: Schema.Union([McpServerAuthenticationError, EnvironmentAuthorizationError]),
  stream: true,
});

export const WsMcpServerListToolsRpc = Rpc.make(WS_METHODS.mcpServerListTools, {
  payload: McpServerAuthenticateInput,
  success: McpServerTools,
  error: Schema.Union([McpServerToolsError, EnvironmentAuthorizationError]),
});

export const WsMcpServerGetHeadersRpc = Rpc.make(WS_METHODS.mcpServerGetHeaders, {
  payload: McpServerAuthenticateInput,
  success: McpServerHeaders,
  error: Schema.Union([McpServerHeadersError, EnvironmentAuthorizationError]),
});

export const WsMcpServerSetHeadersRpc = Rpc.make(WS_METHODS.mcpServerSetHeaders, {
  payload: McpServerSetHeadersInput,
  success: McpServerHeaders,
  error: Schema.Union([McpServerHeadersError, EnvironmentAuthorizationError]),
});

export const WsBotInboxListRpc = Rpc.make(WS_METHODS.botInboxList, {
  payload: Schema.Struct({}),
  success: Schema.Array(BotInboxItem),
  error: Schema.Union([SubscriptionAuthError, EnvironmentAuthorizationError]),
});

export const WsBotInboxResolveRpc = Rpc.make(WS_METHODS.botInboxResolve, {
  payload: BotInboxResolveInput,
  success: Schema.Void,
  error: Schema.Union([SubscriptionAuthError, EnvironmentAuthorizationError]),
});

const VoiceRpcError = Schema.Union([VoiceCallError, EnvironmentAuthorizationError]);

export const WsVoiceProvidersRpc = Rpc.make(WS_METHODS.voiceProviders, {
  payload: Schema.Struct({}),
  success: VoiceProvidersResult,
  error: VoiceRpcError,
});

export const WsVoiceConnectRpc = Rpc.make(WS_METHODS.voiceConnect, {
  payload: VoiceConnectInput,
  success: VoiceProviderStatus,
  error: VoiceRpcError,
});

export const WsVoiceDisconnectRpc = Rpc.make(WS_METHODS.voiceDisconnect, {
  payload: VoiceProviderInput,
  success: VoiceProviderStatus,
  error: VoiceRpcError,
});

export const WsVoiceTestRpc = Rpc.make(WS_METHODS.voiceTest, {
  payload: VoiceProviderInput,
  success: VoiceProviderStatus,
  error: VoiceRpcError,
});

export const WsVoiceListVoicesRpc = Rpc.make(WS_METHODS.voiceListVoices, {
  payload: VoiceListVoicesInput,
  success: VoiceListVoicesResult,
  error: VoiceRpcError,
});

export const WsVoiceListTranscriptionModelsRpc = Rpc.make(WS_METHODS.voiceListTranscriptionModels, {
  payload: VoiceListTranscriptionModelsInput,
  success: VoiceListTranscriptionModelsResult,
  error: VoiceRpcError,
});

export const WsVoiceTranscribeRpc = Rpc.make(WS_METHODS.voiceTranscribe, {
  payload: VoiceTranscribeInput,
  success: VoiceTranscribeResult,
  error: VoiceRpcError,
});

export const WsVoiceSynthesizeRpc = Rpc.make(WS_METHODS.voiceSynthesize, {
  payload: VoiceSynthesizeInput,
  success: VoiceSynthesizeResult,
  error: VoiceRpcError,
});

export const WsVoiceCancelRpc = Rpc.make(WS_METHODS.voiceCancel, {
  payload: VoiceCancelInput,
  success: VoiceCancelResult,
  error: VoiceRpcError,
});

export const WsVoiceCallGetRpc = Rpc.make(WS_METHODS.voiceCallGet, {
  payload: Schema.Struct({}),
  success: VoiceCallSnapshot,
  error: EnvironmentAuthorizationError,
});

export const WsVoiceCallStartRpc = Rpc.make(WS_METHODS.voiceCallStart, {
  payload: VoiceCallStartInput,
  success: VoiceCallStartResult,
  error: Schema.Union([VoiceCallError, EnvironmentAuthorizationError]),
});

export const WsVoiceCallHangupRpc = Rpc.make(WS_METHODS.voiceCallHangup, {
  payload: VoiceCallHangupInput,
  success: VoiceCallSnapshot,
  error: Schema.Union([VoiceCallError, EnvironmentAuthorizationError]),
});

export const WsServerGetUsageSummaryRpc = Rpc.make(WS_METHODS.serverGetUsageSummary, {
  payload: UsageSummaryInput,
  success: UsageSummary,
  error: Schema.Union([EnvironmentAuthorizationError, UsageReadError]),
});

export const WsServerGetRemoteDoctorRpc = Rpc.make(WS_METHODS.serverGetRemoteDoctor, {
  payload: Schema.Struct({}),
  success: RemoteDoctorStatus,
  error: Schema.Union([EnvironmentAuthorizationError, RemoteDoctorError]),
});

export const WsServerRepairRemoteDoctorRpc = Rpc.make(WS_METHODS.serverRepairRemoteDoctor, {
  payload: RemoteDoctorRepairInput,
  success: RemoteDoctorStatus,
  error: Schema.Union([EnvironmentAuthorizationError, RemoteDoctorError]),
});

export const WsServerReportClientActivityRpc = Rpc.make(WS_METHODS.serverReportClientActivity, {
  payload: ClientActivityReportInput,
  error: EnvironmentAuthorizationError,
});

export const WsServerReportHostPowerStateRpc = Rpc.make(WS_METHODS.serverReportHostPowerState, {
  payload: HostPowerSnapshot,
  error: EnvironmentAuthorizationError,
});

export const WsServerGetBackgroundPolicyRpc = Rpc.make(WS_METHODS.serverGetBackgroundPolicy, {
  payload: Schema.Struct({}),
  success: BackgroundPolicySnapshot,
  error: EnvironmentAuthorizationError,
});

export const WsMemoryExportRpc = Rpc.make(WS_METHODS.memoryExport, {
  payload: OttoMarkdownMemoryExportInput,
  success: OttoMarkdownMemoryArchiveV3,
  error: Schema.Union([OttoMemoryOperationError, EnvironmentAuthorizationError]),
});

export const WsMemoryImportPreviewRpc = Rpc.make(WS_METHODS.memoryImportPreview, {
  payload: OttoMarkdownMemoryImportPreviewInput,
  success: OttoMarkdownMemoryImportPreview,
  error: Schema.Union([OttoMemoryOperationError, EnvironmentAuthorizationError]),
});

export const WsMemoryImportApplyRpc = Rpc.make(WS_METHODS.memoryImportApply, {
  payload: OttoMarkdownMemoryImportApplyInput,
  success: OttoMarkdownMemoryImportApplyResult,
  error: Schema.Union([OttoMemoryOperationError, EnvironmentAuthorizationError]),
});

export const WsMemoryArchiveExportRpc = Rpc.make(WS_METHODS.memoryArchiveExport, {
  payload: OttoMemoryExportInput,
  success: OttoMemoryArchiveV2,
  error: Schema.Union([OttoMemoryOperationError, EnvironmentAuthorizationError]),
});

export const WsMemoryArchivePreviewImportRpc = Rpc.make(WS_METHODS.memoryArchivePreviewImport, {
  payload: OttoMemoryImportPreviewInput,
  success: OttoMemoryImportPreview,
  error: Schema.Union([OttoMemoryOperationError, EnvironmentAuthorizationError]),
});

export const WsMemoryArchiveApplyImportRpc = Rpc.make(WS_METHODS.memoryArchiveApplyImport, {
  payload: OttoMemoryImportApplyInput,
  success: OttoMemoryImportApplyResult,
  error: Schema.Union([OttoMemoryOperationError, EnvironmentAuthorizationError]),
});

export const WsMemoryFactsListRpc = Rpc.make(WS_METHODS.memoryFactsList, {
  payload: OttoMemoryFactsListInput,
  success: OttoMemoryFactsListResult,
  error: Schema.Union([OttoMemoryOperationError, EnvironmentAuthorizationError]),
});

export const WsMemoryFactMutateRpc = Rpc.make(WS_METHODS.memoryFactMutate, {
  payload: OttoMemoryMutateInput,
  success: OttoMemoryMutationResult,
  error: Schema.Union([OttoMemoryOperationError, EnvironmentAuthorizationError]),
});

export const WsMemoryDocumentsInspectRpc = Rpc.make(WS_METHODS.memoryDocumentsInspect, {
  payload: OttoMemoryDocumentsInspectInput,
  success: OttoMemoryDocumentsSnapshot,
  error: Schema.Union([OttoMemoryOperationError, EnvironmentAuthorizationError]),
});

export const WsMemoryDocumentReplaceRpc = Rpc.make(WS_METHODS.memoryDocumentReplace, {
  payload: OttoMemoryDocumentReplaceInput,
  success: OttoMemoryDocument,
  error: Schema.Union([OttoMemoryOperationError, EnvironmentAuthorizationError]),
});

export const WsMemoryObservationsClearRpc = Rpc.make(WS_METHODS.memoryObservationsClear, {
  payload: OttoMemoryObservationsClearInput,
  error: Schema.Union([OttoMemoryOperationError, EnvironmentAuthorizationError]),
});

const MemoryRpcError = Schema.Union([MemoryError, EnvironmentAuthorizationError]);

export const WsMemoryListRpc = Rpc.make(WS_METHODS.memoryList, {
  payload: MemoryListInput,
  success: MemoryListResult,
  error: MemoryRpcError,
});

export const WsMemoryCreateRpc = Rpc.make(WS_METHODS.memoryCreate, {
  payload: MemoryCreateInput,
  success: Memory,
  error: MemoryRpcError,
});

export const WsMemoryUpdateRpc = Rpc.make(WS_METHODS.memoryUpdate, {
  payload: MemoryUpdateInput,
  success: Memory,
  error: MemoryRpcError,
});

export const WsMemoryDeleteRpc = Rpc.make(WS_METHODS.memoryDelete, {
  payload: MemoryDeleteInput,
  error: MemoryRpcError,
});

export const WsMemoryDecideRpc = Rpc.make(WS_METHODS.memoryDecide, {
  payload: MemoryDecideInput,
  error: MemoryRpcError,
});

export const WsBotUsageRpc = Rpc.make(WS_METHODS.botUsage, {
  payload: OttoBotUsageInput,
  success: OttoBotUsageSnapshot,
  error: Schema.Union([OttoBotUsageReadError, EnvironmentAuthorizationError]),
});

export const WsRoutinesListRunsRpc = Rpc.make(WS_METHODS.routinesListRuns, {
  payload: RoutineListRunsInput,
  success: RoutineListRunsResult,
  error: Schema.Union([RoutineReadError, EnvironmentAuthorizationError]),
});

export const WsRoutinesListThreadRunsRpc = Rpc.make(WS_METHODS.routinesListThreadRuns, {
  payload: RoutineListThreadRunsInput,
  success: RoutineListThreadRunsResult,
  error: Schema.Union([RoutineThreadReadError, EnvironmentAuthorizationError]),
});

export const WsShellOpenInEditorRpc = Rpc.make(WS_METHODS.shellOpenInEditor, {
  payload: LaunchEditorInput,
  error: Schema.Union([ExternalLauncherError, EnvironmentAuthorizationError]),
});

export const WsShellRevealAttachmentRpc = Rpc.make(WS_METHODS.shellRevealAttachment, {
  payload: AttachmentRevealInput,
  error: Schema.Union([
    AttachmentNotFoundError,
    ExternalLauncherError,
    EnvironmentAuthorizationError,
  ]),
});

export const WsAssetsCreateUrlRpc = Rpc.make(WS_METHODS.assetsCreateUrl, {
  payload: AssetCreateUrlInput,
  success: AssetCreateUrlResult,
  error: Schema.Union([AssetAccessError, EnvironmentAuthorizationError]),
});

export const WsAttachmentsCreateUploadUrlRpc = Rpc.make(WS_METHODS.attachmentsCreateUploadUrl, {
  payload: AttachmentCreateUploadUrlInput,
  success: AttachmentCreateUploadUrlResult,
  error: Schema.Union([AttachmentUploadSigningKeyError, EnvironmentAuthorizationError]),
});

export const WsAttachmentsDeleteRpc = Rpc.make(WS_METHODS.attachmentsDelete, {
  payload: AttachmentDeleteInput,
  error: EnvironmentAuthorizationError,
});

const activityError = Schema.Union([ActivityRequestError, EnvironmentAuthorizationError]);

export const WsActivityListRpc = Rpc.make(WS_METHODS.activityList, {
  payload: ActivityEntity,
  success: ActivityListResult,
  error: activityError,
});

export const WsActivityCommentAddRpc = Rpc.make(WS_METHODS.activityCommentAdd, {
  payload: ActivityCommentAddInput,
  success: ActivityEntry,
  error: activityError,
});

export const WsActivityCommentRemoveRpc = Rpc.make(WS_METHODS.activityCommentRemove, {
  payload: ActivityCommentRemoveInput,
  success: Schema.Void,
  error: activityError,
});

const notificationError = Schema.Union([NotificationRequestError, EnvironmentAuthorizationError]);

export const WsNotificationsListRpc = Rpc.make(WS_METHODS.notificationsList, {
  payload: Schema.Struct({}),
  success: NotificationListResult,
  error: notificationError,
});

export const WsNotificationsMarkReadRpc = Rpc.make(WS_METHODS.notificationsMarkRead, {
  payload: NotificationMarkReadInput,
  success: Schema.Void,
  error: notificationError,
});

const libraryError = Schema.Union([LibraryRequestError, EnvironmentAuthorizationError]);

export const WsLibraryCreateUploadUrlRpc = Rpc.make(WS_METHODS.libraryCreateUploadUrl, {
  payload: LibraryCreateUploadUrlInput,
  success: LibraryCreateUploadUrlResult,
  error: libraryError,
});

export const WsLibraryCreateDocumentRpc = Rpc.make(WS_METHODS.libraryCreateDocument, {
  payload: LibraryCreateDocumentInput,
  success: LibraryCreateDocumentResult,
  error: libraryError,
});

export const WsLibraryCreateSkillRpc = Rpc.make(WS_METHODS.libraryCreateSkill, {
  payload: LibraryCreateSkillInput,
  success: LibraryCreateSkillResult,
  error: libraryError,
});

export const WsLibraryReadDocumentRpc = Rpc.make(WS_METHODS.libraryReadDocument, {
  payload: LibraryFileInput,
  success: LibraryReadDocumentResult,
  error: libraryError,
});

export const WsLibrarySaveDocumentRpc = Rpc.make(WS_METHODS.librarySaveDocument, {
  payload: LibrarySaveDocumentInput,
  success: LibrarySaveDocumentResult,
  error: libraryError,
});

export const WsLibraryCreateFileUrlRpc = Rpc.make(WS_METHODS.libraryCreateFileUrl, {
  payload: LibraryCreateFileUrlInput,
  success: LibraryCreateFileUrlResult,
  error: libraryError,
});

export const WsProviderUploadFeedbackRpc = Rpc.make(WS_METHODS.providerUploadFeedback, {
  payload: ProviderUploadFeedbackInput,
  success: ProviderUploadFeedbackResult,
  error: Schema.Union([ProviderUploadFeedbackError, EnvironmentAuthorizationError]),
});

export const WsComputerWatchRpc = Rpc.make(WS_METHODS.computerWatch, {
  payload: ComputerWatchInput,
  success: ComputerWatchResult,
  error: Schema.Union([ComputerWatchError, ComputerNotRunningError, EnvironmentAuthorizationError]),
});

export const WsSubscribeDiscoveredLocalServersRpc = Rpc.make(
  WS_METHODS.subscribeDiscoveredLocalServers,
  {
    payload: Schema.Struct({
      configuredUrls: Schema.optional(ConfiguredLocalServerUrls),
    }),
    success: DiscoveredLocalServerList,
    error: EnvironmentAuthorizationError,
    stream: true,
  },
);

export const WsSubscribeServerConfigRpc = Rpc.make(WS_METHODS.subscribeServerConfig, {
  payload: Schema.Struct({}),
  success: ServerConfigStreamEvent,
  error: Schema.Union([KeybindingsConfigError, ServerSettingsError, EnvironmentAuthorizationError]),
  stream: true,
});

export const WsSubscribeServerLifecycleRpc = Rpc.make(WS_METHODS.subscribeServerLifecycle, {
  payload: Schema.Struct({}),
  success: ServerLifecycleStreamEvent,
  error: EnvironmentAuthorizationError,
  stream: true,
});

export const WsSubscribeAuthAccessRpc = Rpc.make(WS_METHODS.subscribeAuthAccess, {
  payload: Schema.Struct({}),
  success: AuthAccessStreamEvent,
  error: Schema.Union([AuthAccessStreamError, EnvironmentAuthorizationError]),
  stream: true,
});

export const WsSubscribeBackgroundPolicyRpc = Rpc.make(WS_METHODS.subscribeBackgroundPolicy, {
  payload: Schema.Struct({}),
  success: BackgroundPolicySnapshot,
  error: EnvironmentAuthorizationError,
  stream: true,
});
