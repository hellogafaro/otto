import type { PreviewViewportSetting } from "@otto/contracts";

import { browserViewportSettingKey } from "~/browser/browser-viewport-layout";

export function shouldRollbackPreviewViewport(
  previous: PreviewViewportSetting,
  requested: PreviewViewportSetting,
  latest: PreviewViewportSetting,
  operationServerEpoch: string | null,
  currentServerEpoch: string | null,
): boolean {
  const requestedKey = browserViewportSettingKey(requested);

  return (
    currentServerEpoch === operationServerEpoch &&
    browserViewportSettingKey(latest) === requestedKey &&
    browserViewportSettingKey(previous) !== requestedKey
  );
}
