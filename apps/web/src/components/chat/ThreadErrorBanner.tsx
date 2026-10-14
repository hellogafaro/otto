import {
  RiArrowRightSLine,
  RiCheckLine,
  RiCloseLine,
  RiErrorWarningLine,
  RiFileCopyLine,
} from "@remixicon/react";

import { memo, useState } from "react";

import {
  fullTechnicalDetails,
  presentThreadError,
  type ThreadErrorContext,
} from "@otto/client-runtime/errors";
import type { EnvironmentId } from "@otto/contracts";

import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { useI18n } from "../../i18n";
import { cn } from "~/lib/utils";

import { BOT_COMPOSER_QUIET_SURFACE_CLASS_NAME } from "../roster/botConversationPresentation";
import { Button } from "../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { ProviderCatalogEntry } from "../settings/providerCatalog";
import { ProviderLogoTile, ProviderRepairAction } from "./ProviderUnavailableNotice";

export function getThreadErrorBannerKey(threadKey: string, error: string | null): string | null {
  return error === null ? null : `${threadKey}\u0000${error}`;
}

export function shouldShowThreadErrorBanner(
  threadKey: string,
  error: string | null,
  isDismissed: boolean,
): boolean {
  return getThreadErrorBannerKey(threadKey, error) !== null && !isDismissed;
}

const sessionDismissedThreadErrorBannerKeys = new Set<string>();

export function dismissThreadErrorBannerForSession(bannerKey: string | null): void {
  if (bannerKey !== null) {
    sessionDismissedThreadErrorBannerKeys.add(bannerKey);
  }
}

export function isThreadErrorBannerDismissedForSession(bannerKey: string | null): boolean {
  return bannerKey !== null && sessionDismissedThreadErrorBannerKeys.has(bannerKey);
}

export const ThreadErrorBanner = memo(function ThreadErrorBanner({
  error,
  threadKey,
  onDismiss,
  onResume,
  resuming = false,
  context,
  environmentId = null,
  onOpenUsage,
}: {
  error: string | null;
  threadKey: string;
  /** The failure's category and names, plus the provider page that fixes it. */
  context?: ThreadErrorContext & { readonly provider?: ProviderCatalogEntry | null };
  environmentId?: EnvironmentId | null;
  onOpenUsage?: () => void;
  onDismiss?: () => void;
  onResume?: () => void;
  resuming?: boolean;
}) {
  const { t } = useI18n();
  const [locallyDismissedKey, setLocallyDismissedKey] = useState<string | null>(null);
  const bannerKey = getThreadErrorBannerKey(threadKey, error);

  if (
    !error ||
    bannerKey === locallyDismissedKey ||
    isThreadErrorBannerDismissedForSession(bannerKey)
  ) {
    return null;
  }

  const presentation = presentThreadError(error, context, t);

  const provider = presentation.action === "providers" ? (context?.provider ?? null) : null;

  const dismiss = () => {
    dismissThreadErrorBannerForSession(bannerKey);
    setLocallyDismissedKey(bannerKey);
    onDismiss?.();
  };

  const fullError = fullTechnicalDetails(error);

  const hasRepair =
    presentation.action === "providers" || (presentation.action === "usage" && !!onOpenUsage);

  // A card like the question and approval cards: what failed and why on top, the whole error
  // opening full width beneath it, and the fixes in a bordered footer.
  return (
    <div className="mx-auto w-min-46rem-pct-2rem pt-2">
      <section
        aria-atomic="true"
        className={cn(
          BOT_COMPOSER_QUIET_SURFACE_CLASS_NAME,
          "rounded-lg border text-card-foreground",
        )}
        role="alert"
      >
        <Collapsible>
          <div className="flex min-w-0 items-start gap-2.5 p-4">
            {provider ? (
              <ProviderLogoTile provider={provider} />
            ) : (
              <RiErrorWarningLine
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-destructive"
              />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium leading-5">{presentation.title}</p>
              <CollapsibleTrigger
                presentation="inline-disclosure"
                aria-label={t("Full error")}
                className="mt-0.5"
              >
                <span className="line-clamp-2 text-left break-words">
                  {presentation.description}
                </span>
                <RiArrowRightSLine
                  aria-hidden="true"
                  className="size-3.5 shrink-0 transition-transform group-data-panel-open/disclosure:rotate-90"
                />
              </CollapsibleTrigger>
            </div>
            <Button
              aria-label={t("Dismiss error")}
              presentation="muted-dismiss"
              className="-me-1.5 -mt-1"
              onClick={dismiss}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <RiCloseLine />
            </Button>
          </div>
          <CollapsiblePanel>
            <div className="relative px-4 pb-4">
              <pre className="max-h-48 overflow-auto rounded-md bg-muted py-2 ps-3 pe-9 font-mono text-xs leading-5 whitespace-pre-wrap break-words text-muted-foreground">
                {fullError}
              </pre>
              <CopyFullErrorButton text={fullError} />
            </div>
          </CollapsiblePanel>
          {hasRepair || onResume ? (
            <div className="flex flex-wrap items-center justify-end gap-2 border-t px-4 py-3">
              <ProviderRepairAction
                action={presentation.action}
                reason={presentation.reason}
                provider={provider}
                environmentId={environmentId}
                onOpenUsage={onOpenUsage}
              />
              {onResume ? (
                <Button
                  size="sm"
                  type="button"
                  variant="primary"
                  onClick={onResume}
                  disabled={resuming}
                >
                  {resuming ? t("Retrying…") : t("Try again")}
                </Button>
              ) : null}
            </div>
          ) : null}
        </Collapsible>
      </section>
    </div>
  );
});

function CopyFullErrorButton({ text }: { readonly text: string }) {
  const { t } = useI18n();
  const { copyToClipboard, isCopied } = useCopyToClipboard({ target: "error-message" });
  const label = isCopied ? t("Copied error") : t("Copy error");

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={label}
            className="absolute end-5 top-1"
            onClick={() => copyToClipboard(text)}
            size="icon-xs"
            type="button"
            variant="ghost-muted"
          />
        }
      >
        {isCopied ? <RiCheckLine /> : <RiFileCopyLine />}
      </TooltipTrigger>
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
}
