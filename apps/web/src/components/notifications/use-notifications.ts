import {
  BotId,
  type EnvironmentId,
  type Notification,
  type NotificationType,
  type WorkParticipant,
} from "@otto/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import { AsyncResult } from "effect/unstable/reactivity";

import { useI18n } from "../../i18n";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { notificationEnvironment } from "../../state/notifications";
import { useEnvironmentQuery } from "../../state/query";
import { environmentSnapshotAtom } from "../../state/shell";
import { useAtomCommand } from "../../state/use-atom-command";
import { participantName, useWorkParticipants } from "../work/work-participants";

const NOTIFICATION_TEXT = {
  assigned: "{name} assigned you {title}",
  owner: "{name} made you the owner of {title}",
  mention: "{name} mentioned you on {title}",
  reply: "{name} replied to you on {title}",
  comment: "{name} commented on {title}",
  chat_mention: "{name} mentioned you in {title}",
} as const satisfies Record<NotificationType, string>;

/**
 * Otto: The signed-in person's notifications wherever they show: who did it and the sentence
 * saying what, opening the task or chat (which marks it read), and Mark all read.
 */
export function useNotifications() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const environmentId = usePrimaryEnvironmentId();
  // SAFETY: the empty environment ID is an inactive-query sentinel; the atom sends no request until an environment exists.
  const snapshot = useAtomValue(environmentSnapshotAtom(environmentId ?? ("" as never)));
  const participants = useWorkParticipants(snapshot ?? null);

  const query = useEnvironmentQuery(
    environmentId ? notificationEnvironment.list({ environmentId, input: {} }) : null,
  );

  const markReadCommand = useAtomCommand(notificationEnvironment.markRead);

  const markRead = async (target: EnvironmentId, ids?: readonly string[]) => {
    const result = await markReadCommand({
      environmentId: target,
      input: ids === undefined ? {} : { ids: [...ids] },
    });

    if (AsyncResult.isSuccess(result)) query.refresh();
  };

  const actor = (notification: Notification): WorkParticipant | null => {
    if (notification.actor === null) return null;

    if (notification.actor.type === "bot") {
      return { kind: "bot", botId: BotId.make(notification.actor.id) };
    }

    const personId = notification.actor.id;

    return (
      participants.people.find((person) => person.personId === personId) ?? {
        kind: "person",
        personId,
        displayName: t("Someone"),
      }
    );
  };

  const describe = (notification: Notification) => {
    const who = actor(notification);

    return {
      who,
      text: t(NOTIFICATION_TEXT[notification.type], {
        name: who ? participantName(who, participants.allBots) : t("Someone"),
        title: notification.title,
      }),
    };
  };

  const open = (notification: Notification) => {
    if (environmentId && notification.readAt === null)
      void markRead(environmentId, [notification.id]);

    if (notification.entityType === "task") {
      void navigate({ to: "/tasks/$taskId", params: { taskId: notification.entityId } });

      return;
    }

    void navigate({ to: "/chats/$threadId", params: { threadId: notification.entityId } });
  };

  return {
    loaded: query.data !== null,
    notifications: query.data?.notifications ?? [],
    unread: query.data?.unread ?? 0,
    bots: participants.allBots,
    markAllRead: () => {
      if (environmentId) void markRead(environmentId);
    },
    describe,
    open,
  };
}
