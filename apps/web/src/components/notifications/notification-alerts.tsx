import { useEffect, useRef } from "react";

import { arrivedNotifications } from "./notification-alerts.logic";
import { readNotificationPermission } from "./notification-permission";
import { useNotifications } from "./use-notifications";

const inBackground = () => document.visibilityState === "hidden" || !document.hasFocus();

/**
 * Otto: A notification that arrives while Otto is in the background also shows as an OS
 * notification: native in the desktop app, the browser's once the person allows it. A browser
 * that has not been asked yet is asked when Otto opens, or on the person's first click where the
 * browser only asks after one. Clicking a notification brings Otto forward and opens what it is
 * about.
 */
export function NotificationAlerts() {
  const notifications = useNotifications();
  const latest = useRef(notifications);
  const known = useRef<ReadonlySet<string> | null>(null);
  latest.current = notifications;

  useEffect(() => {
    if (readNotificationPermission() !== "default") return;

    const ask = () => {
      if (readNotificationPermission() === "default") void window.Notification.requestPermission();
    };

    ask();
    window.addEventListener("pointerdown", ask, { once: true });

    return () => window.removeEventListener("pointerdown", ask);
  }, []);

  useEffect(
    () =>
      window.desktopBridge?.onNotificationClick?.((id) => {
        const notification = latest.current.notifications.find((item) => item.id === id);

        if (notification) latest.current.open(notification);
      }),
    [],
  );

  useEffect(() => {
    if (!notifications.loaded) return;

    const arrived = arrivedNotifications(known.current, notifications.notifications);
    known.current = new Set(notifications.notifications.map((notification) => notification.id));

    if (arrived.length === 0 || !inBackground()) return;

    for (const notification of arrived) {
      const { text } = latest.current.describe(notification);
      const showNotification = window.desktopBridge?.showNotification;

      if (showNotification) {
        void showNotification({ id: notification.id, title: text, body: notification.excerpt });
        continue;
      }

      if (readNotificationPermission() !== "granted") return;

      const alert = new window.Notification(text, {
        body: notification.excerpt,
        tag: notification.id,
      });

      alert.addEventListener("click", () => {
        window.focus();
        alert.close();
        latest.current.open(notification);
      });
    }
  }, [notifications.loaded, notifications.notifications]);

  return null;
}
