import { type ScopedThreadRef } from "@otto/contracts";

import { useCallback } from "react";
import { toast } from "sonner";

import { previewBridge } from "./preview-bridge";

import { revealInFileExplorerLabel } from "./file-explorer-label";

import { startBrowserRecording, stopBrowserRecording } from "~/browser/browser-recording";

export function usePreviewCapture({
  recordingRuntimeTabId,
  runtimeTabId,
  tabId,
  threadRef,
}: {
  recordingRuntimeTabId: string | null;
  runtimeTabId: string | null;
  tabId: string | null;
  threadRef: ScopedThreadRef;
}) {
  const handleCapture = useCallback(
    (record: boolean) => {
      if (!previewBridge || !runtimeTabId || !tabId) return;
      const bridge = previewBridge;

      if (recordingRuntimeTabId) {
        void stopBrowserRecording(recordingRuntimeTabId).then(
          (artifact) => {
            if (!artifact) return;

            toast.success("Recording has been saved", {
              action: {
                label: revealInFileExplorerLabel(navigator.platform),
                onClick: () => void bridge.revealArtifact(artifact.path),
              },
            });
          },
          () => {
            toast.error("Recording couldn't be stopped");
          },
        );

        return;
      }

      if (record) {
        void startBrowserRecording(runtimeTabId, threadRef, tabId).catch(() => {
          toast.error("Recording couldn't be started");
        });

        return;
      }

      void bridge.captureScreenshot(runtimeTabId).then(
        (artifact) => {
          const toastId = toast.success("Screenshot has been saved", {
            action: {
              label: "Copy image",
              onClick: () =>
                void bridge.copyArtifactToClipboard(artifact.path).then(
                  () => toast.success("Screenshot has been copied", { id: toastId }),
                  () => toast.error("Screenshot couldn't be copied", { id: toastId }),
                ),
            },
          });
        },
        () => {
          toast.error("Screenshot couldn't be captured");
        },
      );
    },
    [recordingRuntimeTabId, runtimeTabId, tabId, threadRef],
  );

  return handleCapture;
}
