import { scopeThreadRef } from "@otto/client-runtime/environment";
import type { EnvironmentId, OrchestrationThreadShell } from "@otto/contracts";
import { useMemo } from "react";

import { useI18n } from "../../i18n";
import { useChatUnread } from "../chat/useChatUnread";
import { StatusIcon } from "../StatusIcon";
import { resolveBotPresence, rosterChatStatus, type RosterPresence } from "./roster.logic";

const CHAT_STATUS_LABEL = {
  working: "Working",
  waiting: "Waiting",
  completed: "Completed",
} as const;

/** A chat's status icon on the right of its row, or nothing while it is idle and seen. */
export function ChatStatusIcon({
  presence,
  unread,
}: {
  readonly presence: RosterPresence;
  readonly unread: boolean;
}) {
  const { t } = useI18n();
  const status = rosterChatStatus(presence, unread);

  if (status === null) return null;

  return <StatusIcon status={status} label={t(CHAT_STATUS_LABEL[status])} />;
}

/** One chat's status in a bot's chat list; the open chat never counts as unread. */
export function ThreadStatusIcon({
  environmentId,
  shell,
  current,
}: {
  readonly environmentId: EnvironmentId;
  readonly shell: OrchestrationThreadShell;
  readonly current: boolean;
}) {
  const ref = useMemo(() => scopeThreadRef(environmentId, shell.id), [environmentId, shell.id]);
  const unread = useChatUnread(ref);

  return <ChatStatusIcon presence={resolveBotPresence(shell)} unread={unread && !current} />;
}
