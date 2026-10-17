import { Predicate } from "effect";
import { threadDelegations } from "@otto/client-runtime/delegation-presentation";
import { botChatTimeline } from "@otto/client-runtime/state/bot-chat-timeline";
import { pendingMemoryApprovals } from "@otto/client-runtime/durable-memory";
import { useAtomValue } from "@effect/atom-react";
import { presentThreadError } from "@otto/client-runtime/errors";
import { type EnvironmentId, type ScopedThreadRef } from "@otto/contracts";
import { Fragment, useCallback, useEffect, useId, useMemo, useState } from "react";

import { selectOpenBotInboxItems } from "../../bot-inbox";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { environmentPeopleAtom } from "../../state/bots";
import { useEnvironmentQuery } from "../../state/query";
import { useThreadActivities } from "../../state/entities";
import { serverEnvironment } from "../../state/server";
import { environmentSnapshotAtom } from "../../state/shell";
import { SidebarInset } from "../ui/sidebar";
import { WorkspaceHeaderTitle, WorkspacePageHeader } from "../workspace-page-header";
import {
  buildReplyPrompt,
  findReplySourceMessageId,
  type MessageReplyTarget,
} from "../chat/message-controls";
import { ConversationSeparator } from "../chat/conversation-separator";
import { useOptionalReplyPlayback } from "../chat/reply-playback-provider";
import { useReplyPlaybackThread } from "~/lib/reply-playback-thread";
import { useI18n } from "~/i18n";
import { ProviderUnavailableLine } from "../chat/provider-unavailable-notice";
import { ThreadErrorCard } from "../chat/thread-error-card";
import { useOptionalVoiceCall } from "../voice/voice-call";
import { threadSilentRun } from "@otto/client-runtime/silent-run";
import { useActivitySubjectName } from "./bot-activity-status";
import { ChatReplyContext } from "../markdown/generative/chat-reply-context";
import { deriveBotActivity } from "./bot-activity-status.logic";
import { MemoryApprovalPrompt } from "./memory-approval-prompt";
import { BotUserInputPrompt } from "./bot-user-input-prompt";
import { BotInboxAlerts } from "./bot-inbox-alerts";
import { BotConversationScrollArea } from "./bot-conversation-scroll-area";
import { DelegationCard } from "./delegation-card";
import { RosterLoadStatus } from "./roster-load-status";
import { GroupMemberStack } from "./group-member-stack";
import {
  buildBotConversationEntries,
  isBotConversationWorking,
  visibleBotChatMessages,
} from "./bot-conversation-presentation";
import { BotPromptComposer } from "./bot-prompt-composer";
import { useAnsweredUserInputs } from "./use-answered-user-inputs";
import {
  AssistantMessageRow,
  type MessageReplyHandler,
  UserMessageRow,
  useMessageReactionUpdater,
} from "./bot-chat-message-rows";
import { useBotPromptMentionScope } from "./bot-prompt-mentions";
import { BotTurnFailureRow } from "./bot-turn-failure-row";
import {
  botEngineFailureContext,
  botEngineSubscriptionToConnect,
  botEngineTakesDelegatedWork,
} from "./bot-engine-selection";
import { ProviderConnectCard, providerConnectStep } from "../chat/provider-connect-card";
import { useSubscriptionStatuses } from "../settings/providers-panel";
import { buildBotStepMeters } from "@otto/client-runtime/bot-step-usage";
import { useGroupPresence } from "./bot-presence";
import { GroupWorkingRows } from "./group-working-rows";
import { groupBotMembers, groupPersonMembers, isCurrentGroupPerson } from "./roster.logic";
import { useMessageArrivals } from "./message-arrival";
import { useRosterStore } from "./roster-store";
import { useGroupThreadRuntime } from "./use-group-thread-runtime";
import { ChatActionsMenu, useMarkChatVisited } from "../chat/chat-actions-menu";
import { WatchComputerButton } from "./watch-computer-button";
import { useBotEngineAvailability } from "./use-bot-engine-availability";
import { buildBotTurnTraces } from "./bot-turn-trace.logic";
import { useLocalDay } from "./use-local-day";
import { useRosterApprovals } from "./use-roster-approvals";
import { InlineApproval } from "./inline-approval";
import { approvalBotId, withInlineApprovals } from "./inline-approvals.logic";
import { delegateProposalDetails } from "../chat/composer-pending-approval-panel";
import { useRosterLoadState } from "./use-server-roster";
import { useChatDetailsOpen } from "./details-panel-open";
import { activeThreadRuntimeWarning } from "./thread-runtime-warning.logic";
import { ThreadRuntimeWarningBanner } from "./thread-runtime-warning-banner";

// SAFETY: the empty ID is an inactive-query sentinel; no environment request is sent for it.
const NO_ENVIRONMENT = "" as EnvironmentId;

/**
 * The member whose provider labels the group composer. Every member hears each message,
 * so this is only the stored first bot, or any active member once it leaves.
 */
export function resolveAvailableGroupBoss<T extends { readonly id: string }>(
  members: ReadonlyArray<T>,
  bossBotId: string | null,
): T | null {
  return members.find((bot) => bot.id === bossBotId) ?? members[0] ?? null;
}

/** The bot a group draft names: the mentioned member, otherwise the first active member. */
export function resolveGroupAddressedBot<T extends { readonly id: string }>(
  members: ReadonlyArray<T>,
  boss: T | null,
  addressedBotId: string | null,
): T | null {
  return members.find((bot) => bot.id === addressedBotId) ?? boss;
}

export function GroupThreadLanding({
  groupId,
  threadRef,
}: {
  readonly groupId: string;
  readonly threadRef: ScopedThreadRef;
}) {
  const { t, locale } = useI18n();
  const environmentId = usePrimaryEnvironmentId();

  // SAFETY: the empty ID is an inactive-query sentinel; no environment request is sent for it.
  const peopleIdentity = useAtomValue(
    environmentPeopleAtom((environmentId ?? "") as EnvironmentId),
  );

  const group = useRosterStore((state) =>
    state.groups.find((candidate) => candidate.id === groupId),
  );

  const rosterLoadState = useRosterLoadState();
  const bots = useRosterStore((state) => state.bots);
  const runtime = useGroupThreadRuntime(groupId, threadRef);
  useMarkChatVisited(runtime.linkedThreadRef);
  const [detailsPanelOpen] = useChatDetailsOpen();

  const mentionScope = useBotPromptMentionScope({
    environmentId,
    threadRef: runtime.linkedThreadRef,
    projectId: runtime.project?.id,
    cwd: runtime.project?.workspaceRoot,
  });

  const respondingBot = bots.find((bot) => bot.id === runtime.respondingBotId) ?? null;
  // Names the provider behind a failed reply, like a bot chat does.
  const respondingEngine = useBotEngineAvailability(respondingBot?.engine ?? null);

  const failureContext = botEngineFailureContext(
    respondingEngine.selection,
    respondingEngine.instanceEntries,
    runtime.failure?.unavailability,
    runtime.failure?.providerInstanceId,
  );

  const members = group
    ? groupBotMembers(group, bots).filter((bot) => bot.archivedAt === null)
    : [];

  const boss = group ? resolveAvailableGroupBoss(members, group.bossBotId) : null;
  // Otto: a people-only group has no bot to answer, so it needs no provider.
  const needsProvider = members.length > 0;

  // A first message from New chat goes out once the chat can send.
  const prompt = useRosterStore((state) =>
    state.promptRequest?.threadId === threadRef.threadId ? state.promptRequest : null,
  );

  const promptReady =
    prompt !== null &&
    group !== undefined &&
    runtime.groupReady &&
    runtime.linkedThreadRef !== null &&
    runtime.project !== null;

  useEffect(() => {
    const roster = useRosterStore.getState();
    const request = roster.promptRequest;

    // Read the store, not the render: a re-run before the next render must not send twice.
    if (!promptReady || request?.threadId !== threadRef.threadId) return;
    roster.requestPrompt(null);
    void runtime.send(request.text, []);
  }, [promptReady, runtime.send, threadRef.threadId]);

  // The default member's provider skills label sent messages.
  const bossEngine = useBotEngineAvailability(boss?.engine ?? null);
  const bossCatalog = bossEngine.catalog;
  // A mention sends the draft to that member, so the `$` and `/` pickers offer its provider's catalog.
  const [addressedBotId, setAddressedBotId] = useState<string | null>(null);
  const addressedBot = resolveGroupAddressedBot(members, boss, addressedBotId);
  const composerCatalog = useBotEngineAvailability(addressedBot?.engine ?? null).catalog;
  const noProviderNoticeId = useId();
  // Signing in fixes a reply that failed on a missing account, or a boss that
  // cannot answer yet, so the connect card replaces the failure copy.
  const { statusByProvider: subscriptionStatuses } = useSubscriptionStatuses(environmentId);

  const failedConnect = respondingBot
    ? botEngineSubscriptionToConnect(
        respondingEngine.selection,
        respondingEngine.instanceEntries,
        runtime.failure?.unavailability,
      )
    : null;

  // A turn error that signing in cannot fix stays visible instead of the boss's card.
  const bossConnect =
    boss && !runtime.providerAvailable && !runtime.error
      ? botEngineSubscriptionToConnect(
          bossEngine.selection,
          bossEngine.instanceEntries,
          bossEngine.unavailability?.reason,
        )
      : null;

  const connect =
    failedConnect && respondingBot
      ? { provider: failedConnect, botName: respondingBot.name }
      : bossConnect && boss
        ? { provider: bossConnect, botName: boss.name }
        : null;

  const connectNeeded =
    connect !== null && providerConnectStep(subscriptionStatuses.get(connect.provider)) !== null;

  const replyPlayback = useOptionalReplyPlayback();
  const voiceCall = useOptionalVoiceCall();
  const [replyTarget, setReplyTarget] = useState<MessageReplyTarget | null>(null);
  const approvalState = useRosterApprovals(runtime.linkedThreadRef);
  const activities = useThreadActivities(runtime.linkedThreadRef);
  const memoryApprovals = useMemo(() => pendingMemoryApprovals(activities), [activities]);
  const stepMeters = useMemo(() => buildBotStepMeters(activities), [activities]);

  const botActivity = useMemo(
    () => deriveBotActivity(activities, runtime.latestTurn),
    [activities, runtime.latestTurn],
  );

  const activitySubjectName = useActivitySubjectName(environmentId ?? null, botActivity.subject);

  const runtimeWarning = useMemo(
    () => activeThreadRuntimeWarning(activities, runtime.latestTurn),
    [activities, runtime.latestTurn],
  );

  const presence = useGroupPresence(groupId);

  const inboxQuery = useEnvironmentQuery(
    environmentId === null
      ? null
      : serverEnvironment.subscriptionAuth({ environmentId, input: {} }),
  );

  const snapshot = useAtomValue(environmentSnapshotAtom(environmentId ?? NO_ENVIRONMENT));

  useEffect(() => {
    setReplyTarget(null);
  }, [groupId, runtime.linkedThreadRef?.environmentId, runtime.linkedThreadRef?.threadId]);

  const waitingForApproval = approvalState.pending.length > 0;
  const pendingUserInput = runtime.pendingUserInputs[0] ?? null;

  const waitingForUserInput =
    pendingUserInput !== null && !runtime.respondingRequestIds.includes(pendingUserInput.requestId);

  // Derived before the transcript is built: the visible set depends on whether a turn is
  // still open, so an intermediate answer from the active turn stays behind the status.
  const working = isBotConversationWorking({
    sending: runtime.sending,
    respondingToUserInput: runtime.respondingRequestIds.length > 0,
    presence,
    turnRunning: runtime.latestTurn?.state === "running",
    waitingForUserInput,
  });

  const silentRun = runtime.latestTurn?.completedAt
    ? null
    : threadSilentRun(activities, runtime.latestTurn?.turnId);

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

  const arrivedMessageIds = useMessageArrivals(
    { owner: groupId, thread: runtime.linkedThreadRef?.threadId ?? null },
    messages.map((message) => message.id),
  );

  const playbackKey = useReplyPlaybackThread({
    environmentId: group ? (runtime.linkedThreadRef?.environmentId ?? environmentId) : null,
    threadId: group ? runtime.linkedThreadRef?.threadId : null,
    messages: group ? messages : [],
    mediaBlocked: Boolean(voiceCall?.activeCall || voiceCall?.startingBotId),
  });

  const updateReaction = useMessageReactionUpdater(runtime.linkedThreadRef);

  const replyTo = useCallback<MessageReplyHandler>(
    (messageId, label, text) => setReplyTarget({ messageId, label, text }),
    [],
  );

  if (!group) {
    // A failed first roster load leaves every group missing; say so and offer
    // a retry rather than a blank pane.
    return rosterLoadState.kind === "failed" ? (
      <SidebarInset
        tone="muted"
        aria-label={t("Could not load bots")}
        className="h-dvh min-h-0 overflow-hidden"
      >
        <RosterLoadStatus state={rosterLoadState} variant="page" />
      </SidebarInset>
    ) : null;
  }

  const currentPersonId = peopleIdentity.current?.id;

  const mentionPeople = groupPersonMembers(group).filter(
    (person) => person.personId !== currentPersonId,
  );

  const activeBot = members.find((bot) => bot.id === runtime.respondingBotId) ?? boss;

  const inboxItems = selectOpenBotInboxItems(
    inboxQuery.data?.inbox ?? [],
    new Set(members.map((bot) => bot.id)),
  );

  const { delegations, waitingOnChildren } =
    runtime.linkedThreadRef && snapshot
      ? threadDelegations(snapshot.delegations, runtime.linkedThreadRef.threadId)
      : { delegations: [], waitingOnChildren: false };

  const timeline = withInlineApprovals(
    botChatTimeline({
      messages: entries.map((entry) => ({
        id: entry.message.id,
        turnId: entry.message.turnId,
        createdAt: entry.message.createdAt,
        entry,
      })),
      delegations,
    }),
    approvalState.approvals,
    (item) => (Predicate.isTagged(item, "Message") ? item.message.createdAt : null),
  );

  const activeBotById = (id: string) =>
    bots.find((candidate) => candidate.id === id && candidate.archivedAt === null) ?? null;

  const chatReply = {
    disabled:
      runtime.sending ||
      runtime.latestTurn?.state === "running" ||
      runtime.pendingUserInputs.length > 0 ||
      waitingForApproval ||
      !runtime.groupReady ||
      !runtime.providerAvailable,
    send: (text: string) => runtime.send(text, []),
  };

  const inlineError =
    connectNeeded || inboxItems.some((item) => item.lastFailure === runtime.error)
      ? null
      : runtime.error;

  return (
    <ChatReplyContext value={chatReply}>
      <SidebarInset
        tone="foreground"
        aria-label={t("{name} group chat", { name: group.name })}
        className="h-dvh min-h-0 overflow-hidden"
        data-testid="group-thread-landing"
      >
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <WorkspacePageHeader detailsPanelOpen={detailsPanelOpen}>
            <WorkspaceHeaderTitle visual={<GroupMemberStack group={group} bots={bots} />}>
              {group.name}
            </WorkspaceHeaderTitle>
            <div data-chat-header-actions className="ml-auto flex items-center gap-1.5">
              {working && respondingBot ? (
                <WatchComputerButton
                  botName={respondingBot.name}
                  sandbox={respondingBot.sandbox}
                  threadRef={runtime.linkedThreadRef}
                />
              ) : null}
              <ChatActionsMenu threadRef={runtime.linkedThreadRef} />
            </div>
          </WorkspacePageHeader>
          <BotConversationScrollArea
            followKey={messages.findLast((message) => message.role === "user")?.id}
          >
            {timeline.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 py-12">
                <GroupMemberStack group={group} bots={bots} size="lg" />
                <h1 className="text-lg font-medium">
                  {boss || !needsProvider
                    ? t("Message {name}", { name: group.name })
                    : t("No active bots")}
                </h1>
              </div>
            ) : (
              timeline.map((item) => {
                if (Predicate.isTagged(item, "Approval")) {
                  // Each bot's approval names that bot and is answered on its own.
                  const askingBot = activeBotById(
                    approvalBotId(
                      item.approval,
                      runtime.messages,
                      item.approval.resolution ? null : runtime.respondingBotId,
                    ) ??
                      boss?.id ??
                      "",
                  );

                  return (
                    <InlineApproval
                      key={item.key}
                      approval={item.approval}
                      bot={askingBot}
                      delegateTo={
                        item.approval.toolName === "delegate"
                          ? (activeBotById(delegateProposalDetails(item.approval.args).botId)
                              ?.name ?? null)
                          : null
                      }
                      response={approvalState.responseFor(item.approval.requestId)}
                      onRespond={approvalState.respond}
                    />
                  );
                }

                if (Predicate.isTagged(item, "Delegation")) {
                  return (
                    <DelegationCard
                      key={item.key}
                      variant="group"
                      delegation={item.delegation}
                      delegations={delegations}
                      childBot={activeBotById(item.delegation.childBotId)}
                      parentBot={activeBotById(item.delegation.parentBotId)}
                    />
                  );
                }

                if (!Predicate.isTagged(item, "Message")) return null;
                const { message, separator, startsGroup } = item.message.entry;

                if (message.role === "assistant") {
                  const respondingBot = message.respondingBotId
                    ? members.find((bot) => bot.id === message.respondingBotId)
                    : boss;

                  return (
                    <Fragment key={message.id}>
                      {separator ? <ConversationSeparator label={separator} /> : null}
                      <AssistantMessageRow
                        message={message}
                        arrived={arrivedMessageIds.has(message.id)}
                        author={respondingBot ?? null}
                        testId="group-provider-message"
                        startsGroup={startsGroup}
                        cwd={runtime.project?.workspaceRoot}
                        threadRef={runtime.linkedThreadRef ?? undefined}
                        stepMeter={
                          message.turnId === null ? undefined : stepMeters.get(message.turnId)
                        }
                        trace={message.turnId === null ? undefined : turnTraces.get(message.turnId)}
                        environmentId={environmentId ?? null}
                        pluginResults={undefined}
                        currentPersonId={currentPersonId}
                        playback={replyPlayback}
                        playbackKey={playbackKey}
                        channelApproval={null}
                        onReply={replyTo}
                        onReactionChange={updateReaction}
                      />
                    </Fragment>
                  );
                }

                const current = isCurrentGroupPerson(
                  message.authorPersonId,
                  currentPersonId,
                  peopleIdentity.host?.id,
                );

                return (
                  <Fragment key={message.id}>
                    {separator ? <ConversationSeparator label={separator} /> : null}
                    <UserMessageRow
                      message={message}
                      replySourceMessageId={findReplySourceMessageId(
                        messages,
                        item.index,
                        message.text,
                      )}
                      arrived={arrivedMessageIds.has(message.id)}
                      testId="group-user-message"
                      startsGroup={startsGroup}
                      replyLabel={current ? "you" : "participant"}
                      authorName={
                        current
                          ? null
                          : (message.authorDisplayName ??
                            groupPersonMembers(group).find(
                              (person) => person.personId === message.authorPersonId,
                            )?.displayName ??
                            t("Someone"))
                      }
                      showChannelOrigin={false}
                      skills={bossCatalog?.skills}
                      environmentId={environmentId}
                      currentPersonId={currentPersonId}
                      answered={answeredUserInputs.get(message.id) ?? null}
                      onReply={replyTo}
                      onReactionChange={updateReaction}
                    />
                  </Fragment>
                );
              })
            )}
            <GroupWorkingRows
              members={members}
              peopleNames={groupPersonMembers(group).map((person) => person.displayName)}
              messages={messages}
              respondingBotId={runtime.respondingBotId}
              latestTurn={runtime.latestTurn}
              activity={botActivity}
              subjectName={activitySubjectName}
              silentRun={silentRun}
              working={working}
              showCurrent={!waitingForUserInput && !waitingForApproval}
            />
            {inlineError ? (
              <ThreadErrorCard
                error={inlineError}
                context={failureContext}
                environmentId={environmentId}
                {...(runtime.canResume ? { onResume: () => void runtime.resume() } : {})}
                resuming={runtime.resuming}
              />
            ) : !working && runtime.turnFailure && messages.at(-1)?.role === "user" ? (
              <BotTurnFailureRow
                botName={activeBot?.name ?? group.name}
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
          {connectNeeded && connect ? (
            <ProviderConnectCard
              id={noProviderNoticeId}
              environmentId={environmentId}
              provider={connect.provider}
              botName={connect.botName}
              className="mt-2"
            />
          ) : null}
          <BotPromptComposer
            typeToFocus={!waitingForUserInput}
            mentionScope={mentionScope}
            commandCatalog={composerCatalog}
            onAddressedBotChange={setAddressedBotId}
            botName={group.name}
            draftKey={`group:${group.id}`}
            busy={working && !waitingForApproval}
            pendingActionSlot={
              waitingForUserInput ? (
                <BotUserInputPrompt
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
                />
              ) : memoryApprovals.length > 0 && runtime.linkedThreadRef ? (
                <MemoryApprovalPrompt
                  threadRef={runtime.linkedThreadRef}
                  approvals={memoryApprovals}
                />
              ) : null
            }
            quietSurface={pendingUserInput !== null}
            {...(waitingForUserInput ? { placeholder: t("Write a custom answer…") } : {})}
            disabled={
              runtime.respondingRequestIds.length > 0 ||
              !runtime.groupReady ||
              runtime.project === null ||
              (!waitingForUserInput && needsProvider && !runtime.providerAvailable)
            }
            mentionEveryone
            mentionPeople={mentionPeople}
            mentionBots={members.map((bot) => ({
              id: bot.id,
              name: bot.name,
              title: bot.title,
              canTakeWork: botEngineTakesDelegatedWork(
                bot.engine,
                respondingEngine.instanceEntries,
              ),
            }))}
            replyPreview={replyTarget}
            onCancelReply={() => setReplyTarget(null)}
            sendBlockedDescriptionId={
              runtime.providerAvailable || waitingForUserInput || !needsProvider
                ? undefined
                : noProviderNoticeId
            }
            onSubmit={async (prompt, files, respondingBotId) => {
              const sent = await runtime.send(
                buildReplyPrompt(replyTarget, prompt),
                files,
                respondingBotId,
              );

              if (sent) setReplyTarget(null);

              return sent;
            }}
          />
          {needsProvider && !runtime.providerAvailable && !connectNeeded ? (
            <ProviderUnavailableLine
              id={noProviderNoticeId}
              presentation={{
                title: t("No provider is ready for this group"),
                description: t("Connect a provider in Settings > Models so this group can reply."),
                action: "providers",
              }}
              environmentId={environmentId}
            />
          ) : null}
        </div>
      </SidebarInset>
    </ChatReplyContext>
  );
}
