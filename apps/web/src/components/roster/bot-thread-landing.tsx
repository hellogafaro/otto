import { Predicate } from "effect";
import { useAtomValue } from "@effect/atom-react";
import { presentThreadError } from "@otto/client-runtime/errors";
import { BotId, type EnvironmentId, type ScopedThreadRef, type TurnId } from "@otto/contracts";
import { useNavigate } from "@tanstack/react-router";
import { Fragment, useCallback, useEffect, useId, useMemo, useState } from "react";

import { selectOpenBotInboxItems } from "../../bot-inbox";
import { canManageChannels, connectedChannelBinding } from "../../channel-access";
import { useI18n } from "../../i18n";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useThreadActivities, useThreadShell } from "../../state/entities";
import { serverEnvironment } from "../../state/server";
import { environmentSnapshotAtom } from "../../state/shell";
import { useEnvironmentQuery } from "../../state/query";
import { useEnvironmentSessionState } from "../../state/session";
import { SidebarInset } from "../ui/sidebar";
import { Spinner } from "../ui/spinner";
import { WorkspaceHeaderTitle, WorkspacePageHeader } from "../workspace-page-header";
import { BotActivityStatus } from "./bot-activity-status";
import { deriveBotActivity } from "./bot-activity-status.logic";
import { BotInboxAlerts } from "./bot-inbox-alerts";
import { ChatReplyContext } from "../markdown/generative/chat-reply-context";
import { BotAvatarView } from "./bot-avatar-view";
import { BotConversationScrollArea } from "./bot-conversation-scroll-area";
import { useChatDetailsOpen } from "./details-panel-open";
import { DelegationCard } from "./delegation-card";
import {
  AssistantMessageRow,
  type ChannelApprovalTarget,
  type MessageReplyHandler,
  UserMessageRow,
  useMessageReactionUpdater,
} from "./bot-chat-message-rows";
import { channelOriginForAssistantMessage } from "@otto/client-runtime/channel-origin-presentation";
import {
  buildBotConversationEntries,
  isBotConversationWorking,
  visibleBotChatMessages,
} from "./bot-conversation-presentation";
import { botEngineFailureContext, botEngineSubscriptionToConnect } from "./bot-engine-selection";
import { ProviderConnectCard, providerConnectStep } from "../chat/provider-connect-card";
import { useSubscriptionStatuses } from "../settings/providers-panel";
import { BotTurnFailureRow } from "./bot-turn-failure-row";
import { useBotEngineAvailability } from "./use-bot-engine-availability";
import { BotPromptComposer } from "./bot-prompt-composer";
import { useAnsweredUserInputs } from "./use-answered-user-inputs";
import { useBotPromptMentionScope } from "./bot-prompt-mentions";
import { buildBotStepMeters } from "@otto/client-runtime/bot-step-usage";
import { ThreadErrorCard } from "../chat/thread-error-card";
import { ProviderUnavailableLine } from "../chat/provider-unavailable-notice";
import { ComposerPendingUserInputPanel } from "../chat/composer-pending-user-input-panel";
import { PluginSearchResultCard } from "../chat/plugin-search-result-card";
import {
  buildReplyPrompt,
  findReplySourceMessageId,
  type MessageReplyTarget,
} from "../chat/message-controls";
import { ConversationSeparator } from "../chat/conversation-separator";
import { useOptionalReplyPlayback } from "../chat/reply-playback-provider";
import { useReplyPlaybackThread } from "~/lib/reply-playback-thread";
import { BotVoiceCallButton, useVoiceCall } from "../voice/voice-call";
import { useMessageArrivals } from "./message-arrival";
import { useRosterStore } from "./roster-store";
import { useBotThreadRuntime } from "./use-bot-thread-runtime";
import { buildBotTurnTraces, buildLiveTurnSteps } from "./bot-turn-trace.logic";
import { resolveBotPresence } from "./roster.logic";
import { useLocalDay } from "./use-local-day";
import { useRosterApprovals } from "./use-roster-approvals";
import { InlineApproval } from "./inline-approval";
import { withInlineApprovals } from "./inline-approvals.logic";
import { delegateProposalDetails } from "../chat/composer-pending-approval-panel";
import { useRosterLoadState } from "./use-server-roster";
import { RosterLoadStatus } from "./roster-load-status";
import { deriveWorkLogEntries, pluginSearchResultForWorkEntry } from "../../session-logic";
import { activeThreadRuntimeWarning } from "./thread-runtime-warning.logic";
import { RoutineReceiptRow } from "./routine-receipt-row";
import { useBotLandingTimeline } from "./use-bot-landing-timeline";
import { resolveRoutedBot } from "./roster-route-selection";
import { ThreadRuntimeWarningBanner } from "./thread-runtime-warning-banner";
import { ChatActionsMenu, useMarkChatVisited } from "../chat/chat-actions-menu";
import { WatchComputerButton } from "./watch-computer-button";
import { ArchivedChatBar } from "./archived-chat-bar";
import { useChatShell } from "../../lib/archived-threads-state";

// SAFETY: the empty ID is an inactive-query sentinel; no environment request is sent for it.
const NO_ENVIRONMENT = "" as EnvironmentId;

export function BotThreadLanding({
  botId,
  threadRef,
}: {
  readonly botId: string;
  readonly threadRef: ScopedThreadRef;
}) {
  const i18n = useI18n();
  const { t, locale } = i18n;
  const navigate = useNavigate();
  const environmentId = usePrimaryEnvironmentId();
  // SAFETY: the empty ID is an inactive-query sentinel; no environment request is sent for it.
  const channelSession = useEnvironmentSessionState(environmentId ?? ("" as EnvironmentId));
  const canManageChannelBindings = canManageChannels(channelSession.data);
  const bots = useRosterStore((state) => state.bots);
  const rosterEnvironmentId = useRosterStore((state) => state.environmentId);
  const routedBot = resolveRoutedBot(environmentId, rosterEnvironmentId, bots, botId);
  const rosterLoadState = useRosterLoadState();
  const bot = routedBot.status === "available" ? routedBot.bot : undefined;
  const [replyTarget, setReplyTarget] = useState<MessageReplyTarget | null>(null);

  const {
    instanceEntries,
    selection: stickyEngine,
    unavailability: engineUnavailability,
    blocked: sendBlocked,
    catalog: engineCatalog,
  } = useBotEngineAvailability(bot?.engine ?? null);

  const runtime = useBotThreadRuntime(botId, threadRef, stickyEngine);
  const archived = useChatShell(threadRef).shell?.archivedAt != null;
  useMarkChatVisited(runtime.linkedThreadRef);

  // New chat opens the New chat dialog with this bot and this chat's project.
  const newChatProjectId = runtime.project?.id;

  const newChat = useMemo(
    () => ({
      canStart: true,
      start: () =>
        useRosterStore.getState().openNewChat({
          memberKeys: [`bot:${botId}`],
          ...(newChatProjectId ? { projectId: newChatProjectId } : {}),
        }),
    }),
    [botId, newChatProjectId],
  );

  // A first message asked for elsewhere, such as New chat's, sends once this chat can.
  const prompt = useRosterStore((state) =>
    state.promptRequest?.threadId === threadRef.threadId ? state.promptRequest : null,
  );

  const promptReady =
    prompt !== null &&
    runtime.botReady &&
    runtime.linkedThreadRef !== null &&
    runtime.project !== null;

  useEffect(() => {
    const roster = useRosterStore.getState();
    const request = roster.promptRequest;

    // Read the store, not the render: a re-run before the next render must not send twice.
    if (!promptReady || request?.threadId !== threadRef.threadId) return;
    roster.requestPrompt(null);
    void (request.hidden ? runtime.sendHidden(request.text) : runtime.send(request.text, []));
  }, [promptReady, runtime.send, runtime.sendHidden, threadRef.threadId]);

  const mentionScope = useBotPromptMentionScope({
    environmentId,
    threadRef: runtime.linkedThreadRef,
    projectId: runtime.project?.id,
    cwd: runtime.project?.workspaceRoot,
  });

  const engineNoticeId = useId();

  const failureContext = botEngineFailureContext(
    stickyEngine,
    instanceEntries,
    runtime.failure?.unavailability,
    runtime.failure?.providerInstanceId,
  );

  const { statusByProvider: subscriptionStatuses } = useSubscriptionStatuses(environmentId);

  const subscriptionToConnect = botEngineSubscriptionToConnect(
    stickyEngine,
    instanceEntries,
    sendBlocked ? engineUnavailability?.reason : runtime.failure?.unavailability,
  );

  // Signing in fixes this chat, so the connect card replaces the failure copy.
  const connectNeeded =
    subscriptionToConnect !== null &&
    providerConnectStep(subscriptionStatuses.get(subscriptionToConnect)) !== null;

  const approvalState = useRosterApprovals(runtime.linkedThreadRef);
  const activities = useThreadActivities(runtime.linkedThreadRef);
  const stepMeters = useMemo(() => buildBotStepMeters(activities), [activities]);

  const botActivity = useMemo(
    () => deriveBotActivity(activities, runtime.latestTurn),
    [activities, runtime.latestTurn],
  );

  const liveSteps = useMemo(() => {
    const turn = runtime.latestTurn;

    return turn?.state === "running"
      ? buildLiveTurnSteps(activities, turn.turnId, turn.startedAt ?? turn.requestedAt)
      : [];
  }, [activities, runtime.latestTurn]);

  const runtimeWarning = useMemo(
    () => activeThreadRuntimeWarning(activities, runtime.latestTurn),
    [activities, runtime.latestTurn],
  );

  const pluginResultsByTurn = useMemo(() => {
    const results = new Map<
      TurnId,
      {
        readonly id: string;
        readonly result: NonNullable<ReturnType<typeof pluginSearchResultForWorkEntry>>;
      }[]
    >();

    for (const entry of deriveWorkLogEntries(activities)) {
      const result = pluginSearchResultForWorkEntry(entry);

      if (!result || !entry.turnId) continue;
      const turnResults = results.get(entry.turnId) ?? [];
      turnResults.push({ id: entry.id, result });
      results.set(entry.turnId, turnResults);
    }

    return results;
  }, [activities]);

  const voiceCall = useVoiceCall();
  const replyPlayback = useOptionalReplyPlayback();
  const presence = resolveBotPresence(useThreadShell(threadRef));

  const inboxQuery = useEnvironmentQuery(
    environmentId === null
      ? null
      : serverEnvironment.subscriptionAuth({ environmentId, input: {} }),
  );

  const snapshot = useAtomValue(environmentSnapshotAtom(environmentId ?? NO_ENVIRONMENT));

  useEffect(() => {
    setReplyTarget(null);
  }, [botId, runtime.linkedThreadRef?.environmentId, runtime.linkedThreadRef?.threadId]);

  useEffect(() => {
    if (routedBot.status === "loading") return;

    if (routedBot.status === "missing") {
      void navigate({ to: "/chats", replace: true });

      return;
    }

    useRosterStore.getState().selectBot(botId);
  }, [botId, navigate, routedBot.status]);

  const activeUserInput = runtime.pendingUserInputs[0] ?? null;

  const waitingForUserInput =
    activeUserInput !== null && !runtime.respondingRequestIds.includes(activeUserInput.requestId);

  const working = isBotConversationWorking({
    sending: runtime.sending,
    respondingToUserInput: runtime.respondingRequestIds.length > 0,
    presence,
    turnRunning: runtime.latestTurn?.state === "running",
    waitingForUserInput,
  });

  const messages = useMemo(
    () =>
      visibleBotChatMessages(
        runtime.messages,
        runtime.latestTurn?.state === "running" ? runtime.latestTurn.turnId : null,
      ),
    [runtime.messages, runtime.latestTurn],
  );

  const turnTraces = useMemo(
    () => buildBotTurnTraces(activities, messages),
    [activities, messages],
  );

  const answeredUserInputs = useAnsweredUserInputs(activities, messages);

  const today = useLocalDay();
  const todayLabel = t("Today");

  const entries = useMemo(
    () => buildBotConversationEntries(messages, today, todayLabel, locale),
    [messages, today, todayLabel, locale],
  );

  const { timelineItems, delegations, waitingOnChildren, olderRoutineNotes } =
    useBotLandingTimeline({ threadRef: runtime.linkedThreadRef, snapshot, entries });

  const arrivedMessageIds = useMessageArrivals(
    { owner: botId, thread: runtime.linkedThreadRef?.threadId ?? null },
    messages.map((message) => message.id),
  );

  const available = bot?.archivedAt === null;
  const [detailsPanelOpen] = useChatDetailsOpen();

  const playbackKey = useReplyPlaybackThread({
    environmentId: available ? (runtime.linkedThreadRef?.environmentId ?? environmentId) : null,
    threadId: available ? runtime.linkedThreadRef?.threadId : null,
    messages: available ? messages : [],
    mediaBlocked: Boolean(voiceCall.activeCall || voiceCall.startingBotId),
  });

  const updateReaction = useMessageReactionUpdater(runtime.linkedThreadRef);

  const replyTo = useCallback<MessageReplyHandler>(
    (messageId, label, text) => setReplyTarget({ messageId, label, text }),
    [],
  );

  if (routedBot.status === "loading") {
    if (rosterLoadState.kind === "failed") {
      return (
        <SidebarInset
          tone="muted"
          aria-label={t("Could not load bots")}
          className="h-dvh min-h-0 overflow-hidden"
        >
          <RosterLoadStatus state={rosterLoadState} variant="page" />
        </SidebarInset>
      );
    }

    return (
      <SidebarInset
        tone="muted"
        aria-label={t("Loading bot…")}
        className="h-dvh min-h-0 items-center justify-center overflow-hidden"
      >
        <div className="flex flex-1 items-center justify-center gap-2 text-sm" role="status">
          <Spinner aria-hidden="true" className="size-4" />
          {t("Loading bot…")}
        </div>
      </SidebarInset>
    );
  }

  if (!bot) return null;

  const assistantTurnIds = new Set(
    messages.flatMap((message) =>
      message.role === "assistant" && message.turnId !== null ? [message.turnId] : [],
    ),
  );

  const pendingPluginResults = [...pluginResultsByTurn.entries()].filter(
    ([turnId]) => !assistantTurnIds.has(turnId),
  );

  const waitingForApproval = approvalState.pending.length > 0;
  const shortcutApprovalId = approvalState.pending[0]?.requestId ?? null;

  const transcriptRows = withInlineApprovals(timelineItems, approvalState.approvals, (item) =>
    Predicate.isTagged(item, "Message")
      ? item.message.createdAt
      : Predicate.isTagged(item, "Receipt")
        ? item.receipt.createdAt
        : null,
  );

  const inboxItems = selectOpenBotInboxItems(inboxQuery.data?.inbox ?? [], new Set([bot.id]));

  const activeBot = (id: string) =>
    bots.find((candidate) => candidate.id === id && candidate.archivedAt === null) ?? null;

  const currentPersonId = snapshot?.currentPersonId;
  const reactionHandler = runtime.linkedThreadRef !== null ? updateReaction : null;
  const linkedThreadId = runtime.linkedThreadRef?.threadId;

  const channelApprovalFor = (messageIndex: number): ChannelApprovalTarget | null => {
    if (!environmentId || !linkedThreadId) return null;
    const message = messages[messageIndex];

    if (!message) return null;
    const origin = channelOriginForAssistantMessage(messages, messageIndex);

    if (!origin) {
      // The inbound message is on an older, unloaded page: keep the delivery label only.
      return message.channelDelivery === undefined
        ? null
        : {
            environmentId,
            botId: BotId.make(bot.id),
            threadId: linkedThreadId,
            origin: null,
            sent: false,
            canSend: false,
          };
    }

    const binding = connectedChannelBinding(bot.channelBindings, origin.provider);
    // Only channel admins with a live binding may trigger a send.
    const canSend = canManageChannelBindings && binding !== undefined;

    if (message.channelDelivery === undefined && !canSend) return null;

    return {
      environmentId,
      botId: BotId.make(bot.id),
      threadId: linkedThreadId,
      origin,
      sent: binding?.sentMessageIds.includes(message.id) ?? false,
      canSend,
    };
  };

  const chatReply = {
    disabled:
      archived ||
      runtime.sending ||
      runtime.latestTurn?.state === "running" ||
      runtime.pendingUserInputs.length > 0 ||
      waitingForApproval ||
      sendBlocked ||
      !runtime.botReady,
    send: (text: string) => runtime.send(text, []),
  };

  const inlineError =
    connectNeeded ||
    inboxItems.some((item) => item.lastFailure === runtime.error) ||
    (sendBlocked && runtime.failure?.unavailability === engineUnavailability?.reason)
      ? null
      : runtime.error;

  return (
    <ChatReplyContext value={chatReply}>
      <SidebarInset
        tone="foreground"
        aria-label={t("{name} chat", { name: bot.name })}
        className="h-dvh min-h-0 overflow-hidden"
        data-testid="bot-thread-landing"
      >
        <div className="flex min-h-0 min-w-0 flex-1">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <WorkspacePageHeader detailsPanelOpen={detailsPanelOpen}>
              <WorkspaceHeaderTitle
                visual={<BotAvatarView avatar={bot.avatar} name={bot.name} className="size-4" />}
              >
                {bot.name}
              </WorkspaceHeaderTitle>
              <div data-chat-header-actions className="ml-auto flex items-center gap-1.5">
                <WatchComputerButton
                  botName={bot.name}
                  sandbox={bot.sandbox}
                  threadRef={runtime.linkedThreadRef}
                />
                {archived ? null : (
                  <BotVoiceCallButton
                    bot={bot}
                    threadRef={threadRef}
                    disabled={runtime.sending || runtime.latestTurn?.state === "running"}
                  />
                )}
                {available ? (
                  <ChatActionsMenu threadRef={runtime.linkedThreadRef} newChat={newChat} />
                ) : null}
              </div>
            </WorkspacePageHeader>
            <BotConversationScrollArea
              followKey={messages.findLast((message) => message.role === "user")?.id}
            >
              {olderRoutineNotes.nextCursor ? (
                <button
                  type="button"
                  className="mx-auto my-3 block rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                  disabled={olderRoutineNotes.isPending}
                  onClick={olderRoutineNotes.load}
                >
                  {olderRoutineNotes.isPending
                    ? t("Loading older routine notes…")
                    : olderRoutineNotes.error
                      ? t("Retry older routine notes")
                      : t("Load older routine notes")}
                </button>
              ) : null}
              {transcriptRows.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 py-12">
                  <BotAvatarView avatar={bot.avatar} name={bot.name} className="size-14" />
                  <h1 className="text-lg font-medium">{t("Message {name}", { name: bot.name })}</h1>
                </div>
              ) : (
                transcriptRows.map((item, timelineIndex) => (
                  <Fragment key={item.key}>
                    {Predicate.isTagged(item, "Approval") ? (
                      <InlineApproval
                        approval={item.approval}
                        bot={bot}
                        startsGroup={(() => {
                          const previous = transcriptRows[timelineIndex - 1];

                          return !(
                            previous &&
                            (Predicate.isTagged(previous, "Approval") ||
                              (Predicate.isTagged(previous, "Message") &&
                                previous.message.entry.message.role === "assistant"))
                          );
                        })()}
                        currentPersonId={currentPersonId}
                        delegateTo={
                          item.approval.toolName === "delegate"
                            ? (activeBot(delegateProposalDetails(item.approval.args).botId)?.name ??
                              null)
                            : null
                        }
                        response={approvalState.responseFor(item.approval.requestId)}
                        shortcuts={item.approval.requestId === shortcutApprovalId}
                        onRespond={approvalState.respond}
                      />
                    ) : Predicate.isTagged(item, "Receipt") ? (
                      <RoutineReceiptRow receipt={item.receipt} />
                    ) : Predicate.isTagged(item, "Delegation") ? (
                      <DelegationCard
                        delegation={item.delegation}
                        delegations={delegations}
                        childBot={activeBot(item.delegation.childBotId)}
                        parentBot={activeBot(item.delegation.parentBotId)}
                      />
                    ) : (
                      (() => {
                        const { message, separator, startsGroup } = item.message.entry;

                        const startsAfterReceipt = Predicate.isTagged(
                          transcriptRows[timelineIndex - 1] ?? {},
                          "Receipt",
                        );

                        const continuesApproval =
                          separator === null &&
                          Predicate.isTagged(transcriptRows[timelineIndex - 1] ?? {}, "Approval");

                        const messageIndex = item.index;

                        return (
                          <>
                            {separator ? <ConversationSeparator label={separator} /> : null}
                            {message.role === "assistant" ? (
                              <AssistantMessageRow
                                message={message}
                                arrived={arrivedMessageIds.has(message.id)}
                                author={bot}
                                testId="bot-provider-message"
                                startsGroup={
                                  (startsGroup && !continuesApproval) || startsAfterReceipt
                                }
                                cwd={runtime.project?.workspaceRoot}
                                threadRef={runtime.linkedThreadRef ?? undefined}
                                stepMeter={
                                  message.turnId === null
                                    ? undefined
                                    : stepMeters.get(message.turnId)
                                }
                                trace={
                                  message.turnId === null
                                    ? undefined
                                    : turnTraces.get(message.turnId)
                                }
                                environmentId={environmentId ?? null}
                                pluginResults={
                                  message.turnId === null
                                    ? undefined
                                    : pluginResultsByTurn.get(message.turnId)
                                }
                                currentPersonId={currentPersonId}
                                playback={replyPlayback}
                                playbackKey={playbackKey}
                                channelApproval={channelApprovalFor(messageIndex)}
                                onReply={replyTo}
                                onReactionChange={reactionHandler}
                              />
                            ) : (
                              <UserMessageRow
                                message={message}
                                replySourceMessageId={findReplySourceMessageId(
                                  messages,
                                  messageIndex,
                                  message.text,
                                )}
                                arrived={arrivedMessageIds.has(message.id)}
                                testId="bot-user-message"
                                startsGroup={startsGroup || startsAfterReceipt}
                                replyLabel="you"
                                showChannelOrigin
                                skills={engineCatalog?.skills}
                                environmentId={environmentId}
                                currentPersonId={currentPersonId}
                                answered={answeredUserInputs.get(message.id) ?? null}
                                onReply={replyTo}
                                onReactionChange={reactionHandler}
                              />
                            )}
                          </>
                        );
                      })()
                    )}
                  </Fragment>
                ))
              )}
              {pendingPluginResults.map(([turnId, results]) => (
                <div className="flex items-start gap-3" key={`${turnId}:plugins`}>
                  <BotAvatarView
                    avatar={bot.avatar}
                    name={bot.name}
                    className="mt-0.5 size-7 shrink-0"
                  />
                  <div className="min-w-0 flex-1 space-y-3">
                    <div className="text-sm font-medium">{bot.name}</div>
                    {results.map(({ id, result }) => (
                      <PluginSearchResultCard key={id} result={result} />
                    ))}
                  </div>
                </div>
              ))}
              {runtime.pendingUserInputs.length > 0 ? (
                <div className="flex items-start gap-3">
                  <BotAvatarView
                    avatar={bot.avatar}
                    name={bot.name}
                    className="mt-0.5 size-7 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 text-sm font-medium">{bot.name}</div>
                    <ComposerPendingUserInputPanel
                      pendingUserInputs={runtime.pendingUserInputs}
                      respondingRequestIds={runtime.respondingRequestIds}
                      answers={runtime.pendingUserInputAnswers}
                      step={runtime.pendingUserInputStep}
                      onStepChange={runtime.setPendingUserInputStep}
                      onSelectOption={runtime.selectPendingUserInputOption}
                      onAnswerWithText={(text) => {
                        void runtime.answerPendingUserInputWithText(text);
                      }}
                      onSubmit={() => {
                        void runtime.submitPendingUserInputAnswers();
                      }}
                      onAnswerSecrets={runtime.answerSecretRequest}
                      shortcuts={shortcutApprovalId === null}
                    />
                  </div>
                </div>
              ) : null}
              {working && !waitingForUserInput && !waitingForApproval ? (
                <BotActivityStatus
                  bot={bot}
                  activity={botActivity}
                  steps={liveSteps}
                  startedAt={
                    // Otto: Right after a send the latest turn is still the finished one; its
                    // start would flash a stale time, so the timer waits for the new turn.
                    runtime.latestTurn && !runtime.latestTurn.completedAt
                      ? (runtime.latestTurn.startedAt ?? runtime.latestTurn.requestedAt ?? null)
                      : null
                  }
                  environmentId={environmentId ?? null}
                  continuesReply={messages.at(-1)?.role === "assistant"}
                />
              ) : null}
              {inlineError ? (
                <ThreadErrorCard
                  error={inlineError}
                  context={failureContext}
                  environmentId={environmentId}
                  {...(runtime.canResume && !archived
                    ? { onResume: () => void runtime.resume() }
                    : {})}
                  resuming={runtime.resuming}
                />
              ) : !working && runtime.turnFailure && messages.at(-1)?.role === "user" ? (
                <BotTurnFailureRow
                  botName={bot.name}
                  title={presentThreadError(runtime.turnFailure.message, failureContext, t).title}
                />
              ) : null}
              <BotInboxAlerts items={inboxItems} environmentId={environmentId} />
              {waitingOnChildren && !working ? (
                <p className="ml-10 text-xs text-muted-foreground" aria-live="polite">
                  {t("Waiting on delegated work")}
                </p>
              ) : null}
            </BotConversationScrollArea>
            <ThreadRuntimeWarningBanner warning={runtimeWarning} />
            {archived ? (
              <ArchivedChatBar threadRef={threadRef} />
            ) : (
              <>
                {connectNeeded && subscriptionToConnect ? (
                  <ProviderConnectCard
                    id={engineNoticeId}
                    environmentId={environmentId}
                    provider={subscriptionToConnect}
                    botName={bot.name}
                    className="mt-2"
                  />
                ) : null}
                <BotPromptComposer
                  focusOnEnter={!waitingForUserInput}
                  mentionScope={mentionScope}
                  commandCatalog={engineCatalog}
                  botName={bot.name}
                  draftKey={bot.id}
                  busy={working && !waitingForApproval}
                  disabled={
                    runtime.respondingRequestIds.length > 0 ||
                    voiceCall.activeCall?.botId === bot.id ||
                    voiceCall.startingBotId === bot.id ||
                    sendBlocked ||
                    !runtime.botReady ||
                    runtime.project === null
                  }
                  replyPreview={replyTarget}
                  onCancelReply={() => setReplyTarget(null)}
                  sendBlockedDescriptionId={sendBlocked ? engineNoticeId : undefined}
                  onSubmit={async (prompt, files) => {
                    const sent = await runtime.send(buildReplyPrompt(replyTarget, prompt), files);

                    if (sent) setReplyTarget(null);

                    return sent;
                  }}
                />
                {connectNeeded ? null : sendBlocked && engineUnavailability ? (
                  <ProviderUnavailableLine
                    provider={engineUnavailability.provider}
                    id={engineNoticeId}
                    presentation={engineUnavailability}
                    environmentId={environmentId}
                  />
                ) : sendBlocked ? null : !runtime.botReady ? (
                  <p className="px-4 pb-3 text-center text-xs text-muted-foreground">
                    {t("Connecting bot…")}
                  </p>
                ) : runtime.bootstrapped && runtime.project === null ? (
                  <p className="px-4 pb-3 text-center text-xs text-muted-foreground">
                    {t("Your workspace is still loading. Try again in a moment.")}
                  </p>
                ) : null}
              </>
            )}
          </div>
        </div>
      </SidebarInset>
    </ChatReplyContext>
  );
}
