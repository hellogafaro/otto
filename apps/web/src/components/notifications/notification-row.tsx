import type { Notification } from "@otto/contracts";
import { RiInbox2Line } from "@remixicon/react";

import { formatRelativeTimeLabel } from "../../timestamp-format";
import { CustomizeRow } from "../customize/customize-group";
import { ParticipantAvatar } from "../work/work-participants";
import type { useNotifications } from "./use-notifications";

/** One notification: the actor's avatar, what happened, the excerpt, its time and an unread dot. */
export function NotificationRow({
  notification,
  notifications,
}: {
  readonly notification: Notification;
  readonly notifications: Pick<ReturnType<typeof useNotifications>, "bots" | "describe" | "open">;
}) {
  const { who, text } = notifications.describe(notification);

  return (
    <CustomizeRow
      logo={<RiInbox2Line aria-hidden className="size-4" />}
      avatar={
        who ? (
          <ParticipantAvatar
            participant={who}
            bots={notifications.bots}
            className="size-8 text-xs"
          />
        ) : undefined
      }
      name={text}
      detail={notification.excerpt || undefined}
      status={
        <span className="flex shrink-0 items-center gap-2">
          <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground tabular-nums">
            {formatRelativeTimeLabel(notification.createdAt)}
          </span>
          {notification.readAt === null ? (
            <span aria-hidden className="size-1.5 rounded-full bg-destructive" />
          ) : null}
        </span>
      }
      onOpen={() => notifications.open(notification)}
    />
  );
}
