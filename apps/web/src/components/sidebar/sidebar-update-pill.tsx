import { RiAlertLine, RiDownloadCloud2Line, RiResetRightLine } from "@remixicon/react";

import { useState } from "react";
import { toast } from "sonner";
import { isElectron } from "../../env";
import { useI18n } from "../../i18n";
import { ensureLocalApi } from "../../local-api";
import { useDesktopUpdateState } from "../../state/desktop-update";
import {
  getArm64IntelBuildWarningDescription,
  getDesktopUpdateActionError,
  getDesktopUpdateInstallConfirmationMessage,
  isDesktopUpdateButtonDisabled,
  resolveDesktopUpdateButtonAction,
  shouldShowArm64IntelBuildWarning,
  shouldShowDesktopUpdateButton,
  shouldToastDesktopUpdateActionResult,
} from "../desktop-update.logic";
import { showDesktopUpdateDownloadedToast } from "../desktop-update.toast";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function SidebarUpdateArchitectureWarning() {
  return isElectron ? <SidebarUpdateArchitectureWarningContent /> : null;
}

function SidebarUpdateArchitectureWarningContent() {
  const { t } = useI18n();
  const state = useDesktopUpdateState();
  const visible = shouldShowArm64IntelBuildWarning(state);
  const description = state && visible ? getArm64IntelBuildWarningDescription(state) : null;

  if (!visible || !description) return null;

  return (
    <Alert variant="warning" presentation="sidebar-warning">
      <RiAlertLine />
      <AlertTitle>{t("Intel build on Apple Silicon")}</AlertTitle>
      <AlertDescription>{description}</AlertDescription>
    </Alert>
  );
}

/** Otto: Shown only while an update can be downloaded, is downloading, or waits for a restart. */
export function SidebarUpdatePill() {
  return isElectron ? <SidebarUpdateControl /> : null;
}

function SidebarUpdateControl() {
  const { t } = useI18n();
  const state = useDesktopUpdateState();
  const [isActionPending, setIsActionPending] = useState(false);

  if (!state || !shouldShowDesktopUpdateButton(state)) return null;

  const action = resolveDesktopUpdateButtonAction(state);

  const isDownloading =
    state.status === "downloading" || (isActionPending && action === "download");

  const disabled = isDesktopUpdateButtonDisabled(state) || isActionPending;

  const tooltip = isDownloading
    ? t("Downloading update…")
    : action === "install"
      ? t("Restart to update")
      : t("Update available");

  const handleAction = async () => {
    const bridge = window.desktopBridge;

    if (!bridge || disabled) return;

    setIsActionPending(true);

    if (action === "download") {
      void bridge
        .downloadUpdate()
        .then((result) => {
          if (result.completed) {
            showDesktopUpdateDownloadedToast();
          }

          if (!shouldToastDesktopUpdateActionResult(result)) return;
          const actionError = getDesktopUpdateActionError(result);

          if (!actionError) return;
          toast.error(t("Update couldn't be downloaded"));
        })
        .catch(() => {
          toast.error(t("Update couldn't be downloaded"));
        })
        .finally(() => setIsActionPending(false));

      return;
    }

    let confirmed = false;

    try {
      confirmed = await ensureLocalApi().dialogs.confirm(
        getDesktopUpdateInstallConfirmationMessage(state),
      );
    } catch {
      setIsActionPending(false);
      toast.error(t("Update couldn't be confirmed"));

      return;
    }

    if (!confirmed) {
      setIsActionPending(false);

      return;
    }

    void bridge
      .installUpdate()
      .then((result) => {
        if (!shouldToastDesktopUpdateActionResult(result)) return;
        const actionError = getDesktopUpdateActionError(result);

        if (!actionError) return;
        toast.error(t("Update couldn't be installed"));
      })
      .catch(() => {
        toast.error(t("Update couldn't be installed"));
      })
      .finally(() => setIsActionPending(false));
  };

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost-primary"
            size="icon"
            aria-label={tooltip}
            aria-busy={isDownloading || undefined}
            aria-disabled={disabled || undefined}
            onClick={() => void handleAction()}
          >
            {isDownloading ? (
              <Spinner aria-hidden className="size-4" />
            ) : action === "install" ? (
              <RiResetRightLine aria-hidden className="size-4" />
            ) : (
              <RiDownloadCloud2Line aria-hidden className="size-4" />
            )}
          </Button>
        }
      />
      <TooltipPopup side="right">{tooltip}</TooltipPopup>
    </Tooltip>
  );
}
