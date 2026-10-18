import { useEffect, useState } from "react";

export type NotificationPermissionState = NotificationPermission | "unsupported";

/** Whether Otto may notify on this device: always in the desktop app, once allowed in a browser. */
export const readNotificationPermission = (): NotificationPermissionState => {
  if (typeof window === "undefined") return "unsupported";

  if (window.desktopBridge?.showNotification) return "granted";

  return "Notification" in window ? window.Notification.permission : "unsupported";
};

/** The device's notification permission, kept current while the person changes it elsewhere. */
export function useNotificationPermission() {
  const [permission, setPermission] = useState(readNotificationPermission);

  useEffect(() => {
    const sync = () => setPermission(readNotificationPermission());

    window.addEventListener("focus", sync);

    return () => window.removeEventListener("focus", sync);
  }, []);

  return {
    permission,
    request: async () => {
      setPermission(await window.Notification.requestPermission());
    },
  };
}
