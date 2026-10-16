import { RiAlertLine } from "@remixicon/react";

import { useCallback, useEffect, useState } from "react";
import { isElectron } from "../../env";
import { useMediaQuery } from "../../hooks/use-media-query";
import { useI18n } from "../../i18n";
import { cn } from "../../lib/utils";
import { ensureLocalApi } from "../../local-api";
import { useDesktopUpdateState } from "../../state/desktop-update";
import { toast } from "sonner";
import {
  canCheckForUpdate,
  getArm64IntelBuildWarningDescription,
  getDesktopUpdateActionError,
  getDesktopUpdateButtonTooltip,
  getDesktopUpdateInstallConfirmationMessage,
  isDesktopUpdateButtonDisabled,
  resolveDesktopUpdateButtonAction,
  shouldShowArm64IntelBuildWarning,
  shouldToastDesktopUpdateActionResult,
} from "../desktop-update.logic";
import { showDesktopUpdateDownloadedToast } from "../desktop-update.toast";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { SidebarMenuItem } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  DesktopUpdateStatusIcon,
  shouldContinueDesktopUpdateCheckAnimation,
  shouldShowDesktopUpdateCheckIcon,
} from "./desktop-update-status-icon";

function resolveSidebarUpdatePresentation({
  action,
  isDownloading,
  showCheckIcon,
}: {
  readonly action: ReturnType<typeof resolveDesktopUpdateButtonAction>;
  readonly isDownloading: boolean;
  readonly showCheckIcon: boolean;
}) {
  const showUpdateDetails = action !== "none" || isDownloading;

  const iconStatus = showCheckIcon
    ? "checking"
    : action === "install"
      ? "downloaded"
      : isDownloading
        ? "downloading"
        : action === "download"
          ? "available"
          : "idle";

  return {
    iconStatus,
    showUpdateDetails,
    showUpdateIconState: showUpdateDetails && !showCheckIcon,
  } as const;
}

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

export function SidebarUpdatePill() {
  return isElectron ? <SidebarUpdateControl /> : null;
}

function SidebarUpdateControl() {
  const { t } = useI18n();
  const state = useDesktopUpdateState();
  const [isActionPending, setIsActionPending] = useState(false);
  const [checkAnimationKey, setCheckAnimationKey] = useState(0);
  const [isCheckAnimationLatched, setIsCheckAnimationLatched] = useState(false);
  const prefersReducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");

  useEffect(() => {
    if (prefersReducedMotion) {
      setIsCheckAnimationLatched(false);
    } else if (state?.status === "checking") {
      setIsCheckAnimationLatched(true);
    }
  }, [prefersReducedMotion, state?.status]);

  const action = state ? resolveDesktopUpdateButtonAction(state) : "none";
  const isDownloading = state?.status === "downloading";

  const showCheckIcon = shouldShowDesktopUpdateCheckIcon({
    isAnimationLatched: isCheckAnimationLatched,
    isChecking: state?.status === "checking",
    prefersReducedMotion,
  });

  const { iconStatus, showUpdateDetails, showUpdateIconState } = resolveSidebarUpdatePresentation({
    action,
    isDownloading,
    showCheckIcon,
  });

  const tooltip = showUpdateDetails
    ? state
      ? getDesktopUpdateButtonTooltip(state)
      : t("Update available")
    : showCheckIcon
      ? t("Checking for updates…")
      : t("Check for updates");

  const disabled = showCheckIcon
    ? true
    : showUpdateDetails
      ? isDesktopUpdateButtonDisabled(state)
      : !canCheckForUpdate(state);

  const isInteractionDisabled = disabled || isActionPending;

  const handleAction = useCallback(async () => {
    const bridge = window.desktopBridge;

    if (!bridge || !state) return;

    if (isInteractionDisabled) return;

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

    if (action === "install") {
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

      return;
    }

    if (!prefersReducedMotion) {
      setIsCheckAnimationLatched(true);
      setCheckAnimationKey((key) => key + 1);
    }

    void bridge
      .checkForUpdate()
      .then((result) => {
        if (result.checked) return;
        toast.error(t("Updates couldn't be checked"));
      })
      .catch(() => {
        toast.error(t("Updates couldn't be checked"));
      })
      .finally(() => setIsActionPending(false));
  }, [action, isInteractionDisabled, prefersReducedMotion, state, t]);

  const handleCheckAnimationIteration = useCallback(() => {
    setIsCheckAnimationLatched(
      shouldContinueDesktopUpdateCheckAnimation({
        isChecking: state?.status === "checking",
        prefersReducedMotion,
      }),
    );
  }, [prefersReducedMotion, state?.status]);

  return (
    <SidebarMenuItem className="shrink-0">
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label={tooltip}
              aria-disabled={isInteractionDisabled || undefined}
              className={cn(
                "inline-flex size-8 items-center justify-center rounded-(--control-radius) outline-hidden ring-ring transition-colors focus-visible:ring-2",
                isInteractionDisabled ? "cursor-not-allowed" : "cursor-pointer",
                showUpdateIconState ? "text-sidebar-foreground" : "text-(--sidebar-icon-color)",
                !isInteractionDisabled &&
                  "hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
                disabled && !showUpdateIconState && "opacity-60",
              )}
              onClick={handleAction}
            >
              <DesktopUpdateStatusIcon
                key={showCheckIcon ? checkAnimationKey : iconStatus}
                downloadPercent={state?.downloadPercent ?? null}
                isCheckAnimating={showCheckIcon && !prefersReducedMotion}
                onCheckAnimationIteration={handleCheckAnimationIteration}
                status={iconStatus}
              />
            </button>
          }
        />
        <TooltipPopup align="center" side="top" variant={showUpdateDetails ? "glass" : "default"}>
          {tooltip}
        </TooltipPopup>
      </Tooltip>
    </SidebarMenuItem>
  );
}
