import { RiErrorWarningLine, RiLoopRightLine } from "@remixicon/react";
import type { ReactNode } from "react";

import {
  fullTechnicalDetails,
  presentThreadError,
  type ThreadErrorContext,
} from "@otto/client-runtime/errors";
import type { EnvironmentId } from "@otto/contracts";

import { useI18n } from "../../i18n";

import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { ProviderCatalogEntry } from "../settings/provider-catalog";
import { ProviderLogoTile, ProviderRepairAction } from "./provider-unavailable-notice";

/** What the whole error adds to its one-line description: the lines after it, or all of it. */
export function errorDetailsBeyond(description: string, fullError: string): string | null {
  const [firstLine = "", ...rest] = fullError.split("\n");

  const sameFirstLine =
    firstLine.trim().replace(/[.:。：]$/, "") === description.trim().replace(/[.:。：]$/, "");

  const details = (sameFirstLine ? rest.join("\n") : fullError).trim();

  return details === "" || details === description.trim() ? null : details;
}

/**
 * Otto: A chat's failure is an inline card at the end of the transcript, like Capy's: the icon (or
 * the provider's logo), the title, the description and then the whole error in muted text, with
 * no disclosure and no dismiss. The provider's fix and a quiet retry icon sit at its top right.
 */
export function ThreadErrorCard({
  error,
  context,
  environmentId = null,
  onResume,
  resuming = false,
}: {
  readonly error: string;
  /** The failure's category and names, plus the provider page that fixes it. */
  readonly context?: ThreadErrorContext & { readonly provider?: ProviderCatalogEntry | null };
  readonly environmentId?: EnvironmentId | null;
  readonly onResume?: () => void;
  readonly resuming?: boolean;
}) {
  const { t } = useI18n();
  const presentation = presentThreadError(error, context, t);
  const provider = presentation.action === "providers" ? (context?.provider ?? null) : null;
  const [, ...laterLines] = fullTechnicalDetails(error).split("\n");

  const details = errorDetailsBeyond(
    presentation.description,
    [presentation.technicalDetails, ...laterLines].join("\n"),
  );

  return (
    <ChatAlertCard
      icon={provider ? <ProviderLogoTile provider={provider} /> : undefined}
      title={presentation.title}
      description={presentation.description}
      details={details}
      actions={
        <>
          <ProviderRepairAction
            action={presentation.action}
            reason={presentation.reason}
            provider={provider}
            environmentId={environmentId}
          />
          {onResume ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    aria-label={t("Try again")}
                    disabled={resuming}
                    onClick={onResume}
                    size="icon-sm"
                    type="button"
                    variant="ghost-muted"
                  />
                }
              >
                {resuming ? <Spinner /> : <RiLoopRightLine />}
              </TooltipTrigger>
              <TooltipPopup side="top">{t("Try again")}</TooltipPopup>
            </Tooltip>
          ) : null}
        </>
      }
    />
  );
}

/**
 * Otto: Every alert inside a chat is this inline card: a red warning icon (or the given icon), the
 * title, a muted description and then the whole error in fainter text, with its actions at the
 * top right.
 */
export function ChatAlertCard({
  icon,
  title,
  description,
  details,
  actions,
}: {
  readonly icon?: ReactNode;
  readonly title: string;
  readonly description: string;
  readonly details?: string | null;
  readonly actions?: ReactNode;
}) {
  return (
    <section
      aria-atomic="true"
      className="my-2 flex min-w-0 items-start gap-2.5 rounded-lg border bg-card p-4 text-card-foreground"
      data-testid="thread-error"
      role="alert"
    >
      {icon ?? (
        <RiErrorWarningLine
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0 text-destructive"
        />
      )}
      <div className="min-w-0 flex-1 space-y-0.5 break-words">
        <p className="text-sm font-medium leading-5">{title}</p>
        <p className="text-13px leading-5 text-muted-foreground">{description}</p>
        {details ? (
          <p className="text-xs leading-5 whitespace-pre-wrap text-muted-foreground/70">
            {details}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="-me-1.5 -mt-1 flex shrink-0 items-center gap-1.5">{actions}</div>
      ) : null}
    </section>
  );
}
