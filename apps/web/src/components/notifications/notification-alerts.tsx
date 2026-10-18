import { useEffect, useRef, useState } from "react";

import { arrivedNotifications } from "./notification-alerts.logic";
import { useNotifications } from "./use-notifications";

type NotificationPermissionState = NotificationPermission | "unsupported";

const readPermission = (): NotificationPermissionState => {
  if (window.desktopBridge?.showNotification) return "granted";

  return "Notification" in window ? window.Notification.permission : "unsupported";
};

/** Whether Otto may notify on this device: always in the desktop app, once allowed in a browser. */
export function useNotificationPermission() {
  const [permission, setPermission] = useState(readPermission);

  return {
    permission,
    request: async () => {
      setPermission(await window.Notification.requestPermission());
    },
  };
}

const inBackground = () => document.visibilityState === "hidden" || !document.hasFocus();

/**
 * Otto: A notification that arrives while Otto is in the background also shows as an OS
 * notification: native in the desktop app, the browser's once the person allows it. Clicking it
 * brings Otto forward and opens what it is about.
 */
export function NotificationAlerts() {
  const notifications = useNotifications();
  const latest = useRef(notifications);
  const known = useRef<ReadonlySet<string> | null>(null);
  latest.current = notifications;

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

      if (readPermission() !== "granted") return;

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
