import { scopeThreadRef } from "@otto/client-runtime/environment";
import type { EnvironmentId, OrchestrationThreadShell } from "@otto/contracts";
import { type ReactNode, useMemo } from "react";

import { useI18n } from "../../i18n";
import { useChatUnread } from "../chat/use-chat-unread";
import { StatusIcon } from "../status-icon";
import { resolveBotPresence, rosterChatStatus, type RosterPresence } from "./roster.logic";

const CHAT_STATUS = {
  working: { icon: "in_progress", label: "Working" },
  waiting: { icon: "waiting", label: "Waiting for you" },
  completed: { icon: "completed", label: "Completed" },
} as const;

/**
 * A chat's status icon on the right of its row. The icon takes the place of the row's time, so
 * `fallback` (the time) shows only while the chat is idle and seen.
 */
export function ChatStatusIcon({
  presence,
  unread,
  fallback = null,
}: {
  readonly presence: RosterPresence;
  readonly unread: boolean;
  readonly fallback?: ReactNode;
}) {
  const { t } = useI18n();
  const status = rosterChatStatus(presence, unread);

  if (status === null) return fallback;

  return <StatusIcon status={CHAT_STATUS[status].icon} label={t(CHAT_STATUS[status].label)} />;
}

/** One chat's status in a bot's chat list; the open chat never counts as unread. */
export function ThreadStatusIcon({
  environmentId,
  shell,
  current,
  fallback,
}: {
  readonly environmentId: EnvironmentId;
  readonly shell: OrchestrationThreadShell;
  readonly current: boolean;
  readonly fallback?: ReactNode;
}) {
  const ref = useMemo(() => scopeThreadRef(environmentId, shell.id), [environmentId, shell.id]);
  const unread = useChatUnread(ref);

  return (
    <ChatStatusIcon
      presence={resolveBotPresence(shell)}
      unread={unread && !current}
      fallback={fallback}
    />
  );
}
