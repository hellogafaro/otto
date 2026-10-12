import { toastManager } from "./ui/toast";

export function showDesktopUpdateDownloadedToast(): void {
  toastManager.add({
    type: "success",
    title: "Update downloaded",
    description: "Restart the app from the update button to install it.",
  });
}
