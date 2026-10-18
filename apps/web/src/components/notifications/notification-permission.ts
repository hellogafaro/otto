import * as Schema from "effect/Schema";
import { useEffect, useState } from "react";

import { getLocalStorageItem, useLocalStorage } from "../../hooks/use-local-storage";

export type NotificationPermissionState = NotificationPermission | "unsupported";

/** Otto: The device's own on/off for Otto's notifications; on until the person turns it off. */
const DEVICE_NOTIFICATIONS_KEY = "otto:device-notifications";

/** Whether Otto may notify on this device: always in the desktop app, once allowed in a browser. */
export const readNotificationPermission = (): NotificationPermissionState => {
  if (typeof window === "undefined") return "unsupported";

  if (window.desktopBridge?.showNotification) return "granted";

  return "Notification" in window ? window.Notification.permission : "unsupported";
};

/** Whether the person left Otto's notifications on for this device. */
export const deviceNotificationsOn = () =>
  getLocalStorageItem(DEVICE_NOTIFICATIONS_KEY, Schema.Boolean) ?? true;

/**
 * This device's notifications: the person's switch and the browser's permission, kept current
 * while the person changes the permission elsewhere. Turning the switch on asks a browser that
 * has not decided yet.
 */
export function useDeviceNotifications() {
  const [permission, setPermission] = useState(readNotificationPermission);
  const [on, setOn] = useLocalStorage(DEVICE_NOTIFICATIONS_KEY, true, Schema.Boolean);

  useEffect(() => {
    const sync = () => setPermission(readNotificationPermission());

    window.addEventListener("focus", sync);

    return () => window.removeEventListener("focus", sync);
  }, []);

  return {
    permission,
    on: on && permission === "granted",
    setOn: async (next: boolean) => {
      setOn(next);

      if (next && permission === "default") {
        setPermission(await window.Notification.requestPermission());
      }
    },
  };
}
