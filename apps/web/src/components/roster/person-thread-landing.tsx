import { useAtomValue } from "@effect/atom-react";
import { type EnvironmentId, type ScopedThreadRef } from "@otto/contracts";
import { Predicate } from "effect";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";

import { useI18n } from "~/i18n";
import { useChatShell } from "../../lib/archived-threads-state";
import { newMessageId } from "../../lib/utils";
import { environmentPeopleAtom } from "../../state/bots";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { DEFAULT_INTERACTION_MODE } from "../../types";
import { ChatActionsMenu, useMarkChatVisited } from "../chat/chat-actions-menu";
import { ConversationSeparator } from "../chat/conversation-separator";
import {
  buildReplyPrompt,
  findReplySourceMessageId,
  type MessageReplyTarget,
} from "../chat/message-controls";
import { firstUnseenMessageId } from "../chat/unread-boundary";
import { useOpenChatUnreadSince } from "../chat/use-open-chat-unread-since";
import { SidebarInset } from "../ui/sidebar";
import { WorkspaceHeaderTitle, WorkspacePageHeader } from "../workspace-page-header";
import { ArchivedChatBar } from "./archived-chat-bar";
import { type MessageReplyHandler, UserMessageRow } from "./bot-chat-message-rows";
import { useBotConversationMessageProjection } from "./bot-conversation-message-projection";
import { buildBotConversationEntries } from "./bot-conversation-presentation";
import { BotConversationScrollArea } from "./bot-conversation-scroll-area";
import { BotPromptComposer } from "./bot-prompt-composer";
import { DEFAULT_BOT_RUNTIME_MODE } from "./bot-sandbox";
import { useChatDetailsOpen } from "./details-panel-open";
import { useMessageArrivals } from "./message-arrival";
import { PersonAvatar } from "./person-avatar";
import { useRosterStore } from "./roster-store";
import { readThreadTurnAttachments } from "./thread-runtime-attachments";
import { useLocalDay } from "./use-local-day";
import { useMessageReactionUpdater } from "./use-message-reaction-updater";
import { useThreadAttachmentUpload } from "./use-thread-attachment-upload";

/** The other person in a person DM, seen from the signed-in person's side. */
export function usePersonDmPartner(threadRef: ScopedThreadRef | null) {
  const shell = useChatShell(threadRef).shell;

  // SAFETY: the empty ID is an inactive-query sentinel; no environment request is sent for it.
  const people = useAtomValue(
    environmentPeopleAtom((threadRef?.environmentId ?? "") as EnvironmentId),
  );

  const currentPersonId = people.current?.id ?? null;

  if (!shell || shell.personId == null) return null;

  const partnerId = shell.personId === currentPersonId ? shell.createdBy : shell.personId;

  if (partnerId == null) return null;

  const displayName =
    people.directory.find((person) => person.personId === partnerId)?.displayName ?? null;

  return { personId: partnerId, displayName };
}

/**
 * Otto: A DM between two people. No bot is in it, so a message only reaches the other person:
 * there are no turns, providers or approvals to show.
 */
export function PersonThreadLanding({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const { t, locale } = useI18n();
  const shell = useChatShell(threadRef).shell;
  const people = useAtomValue(environmentPeopleAtom(threadRef.environmentId));
  const currentPersonId = people.current?.id ?? null;
  const partner = usePersonDmPartner(threadRef);
  const partnerName = partner?.displayName ?? t("Someone");
  const archived = shell?.archivedAt != null;
  const [detailsPanelOpen] = useChatDetailsOpen();
  useMarkChatVisited(threadRef);

  const { messages } = useBotConversationMessageProjection(threadRef);
  const unreadSince = useOpenChatUnreadSince(threadRef, null);
  const startTurn = useAtomCommand(threadEnvironment.startTurn, { reportFailure: false });
  const uploadAttachment = useThreadAttachmentUpload();
  const updateReaction = useMessageReactionUpdater(threadRef);
  const [replyTarget, setReplyTarget] = useState<MessageReplyTarget | null>(null);
  const [sending, setSending] = useState(false);

  const replyTo = useCallback<MessageReplyHandler>(
    (messageId, label, text) => setReplyTarget({ messageId, label, text }),
    [],
  );

  const send = useCallback(
    async (prompt: string, files: readonly File[]): Promise<boolean> => {
      if (!shell) return false;
      setSending(true);

      try {
        const attachments = await readThreadTurnAttachments(
          files,
          uploadAttachment(threadRef.environmentId),
        );

        const result = await startTurn({
          environmentId: threadRef.environmentId,
          input: {
            threadId: threadRef.threadId,
            message: { messageId: newMessageId(), role: "user", text: prompt, attachments },
            runtimeMode: shell.runtimeMode ?? DEFAULT_BOT_RUNTIME_MODE,
            interactionMode: DEFAULT_INTERACTION_MODE,
            createdAt: new Date().toISOString(),
          },
        });

        return !Predicate.isTagged(result, "Failure");
      } catch {
        return false;
      } finally {
        setSending(false);
      }
    },
    [shell, startTurn, threadRef, uploadAttachment],
  );

  // A first message from New chat goes out once the chat can send.
  const prompt = useRosterStore((state) =>
    state.promptRequest?.threadId === threadRef.threadId ? state.promptRequest : null,
  );

  const promptReady = prompt !== null && shell !== null;

  useEffect(() => {
    const roster = useRosterStore.getState();
    const request = roster.promptRequest;

    // Read the store, not the render: a re-run before the next render must not send twice.
    if (!promptReady || request?.threadId !== threadRef.threadId) return;
    roster.requestPrompt(null);
    void send(request.text, request.files ?? []);
  }, [promptReady, send, threadRef.threadId]);

  const today = useLocalDay();

  const entries = useMemo(
    () => buildBotConversationEntries(messages, today, t("Today"), locale),
    [messages, today, t, locale],
  );

  const newId = useMemo(
    () => firstUnseenMessageId(messages, unreadSince, null),
    [messages, unreadSince],
  );

  const arrived = useMessageArrivals(
    { owner: `person:${partner?.personId ?? ""}`, thread: threadRef.threadId },
    messages.map((message) => message.id),
  );

  return (
    <SidebarInset
      tone="foreground"
      aria-label={t("Chat with {name}", { name: partnerName })}
      className="h-dvh min-h-0 overflow-hidden"
      data-testid="person-thread-landing"
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <WorkspacePageHeader detailsPanelOpen={detailsPanelOpen}>
          <WorkspaceHeaderTitle
            visual={
              <PersonAvatar name={partnerName} personId={partner?.personId} className="size-4" />
            }
          >
            {partnerName}
          </WorkspaceHeaderTitle>
          <div data-chat-header-actions className="ml-auto flex items-center gap-1.5">
            <ChatActionsMenu threadRef={threadRef} />
          </div>
        </WorkspacePageHeader>
        <BotConversationScrollArea
          followKey={messages.findLast((message) => message.role === "user")?.id}
          anchorKey={newId}
        >
          {entries.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 py-12">
              <PersonAvatar name={partnerName} personId={partner?.personId} className="size-12" />
              <h1 className="text-lg font-medium">{t("Message {name}", { name: partnerName })}</h1>
            </div>
          ) : (
            entries.map(({ message, separator, startsGroup }, index) => {
              if (message.role !== "user") return null;
              const mine = message.authorPersonId === currentPersonId;

              return (
                <Fragment key={message.id}>
                  {message.id === newId ? (
                    <ConversationSeparator
                      label={t("New")}
                      variant="primary"
                      boundaryId={message.id}
                    />
                  ) : null}
                  {separator ? <ConversationSeparator label={separator} /> : null}
                  <UserMessageRow
                    message={message}
                    replySourceMessageId={findReplySourceMessageId(messages, index, message.text)}
                    arrived={arrived.has(message.id)}
                    testId="person-dm-message"
                    startsGroup={startsGroup}
                    replyLabel={mine ? "you" : "participant"}
                    authorName={mine ? null : (message.authorDisplayName ?? partnerName)}
                    showChannelOrigin={false}
                    skills={undefined}
                    environmentId={threadRef.environmentId}
                    currentPersonId={currentPersonId}
                    onReply={replyTo}
                    onReactionChange={updateReaction}
                  />
                </Fragment>
              );
            })
          )}
        </BotConversationScrollArea>
        {archived ? (
          <ArchivedChatBar threadRef={threadRef} />
        ) : (
          <BotPromptComposer
            botName={partnerName}
            draftKey={`person-dm:${threadRef.threadId}`}
            disabled={shell === null}
            busy={sending}
            replyPreview={replyTarget}
            onCancelReply={() => setReplyTarget(null)}
            onSubmit={async (text, files) => {
              const sent = await send(buildReplyPrompt(replyTarget, text), files);

              if (sent) setReplyTarget(null);

              return sent;
            }}
          />
        )}
      </div>
    </SidebarInset>
  );
}
