import type { Notification } from "@otto/contracts";

/**
 * The unread notifications that arrived since the last look. The first look only learns what is
 * already there, so opening Otto never replays old ones.
 */
export function arrivedNotifications(
  known: ReadonlySet<string> | null,
  notifications: readonly Notification[],
): Notification[] {
  if (known === null) return [];

  return notifications.filter(
    (notification) => notification.readAt === null && !known.has(notification.id),
  );
}
