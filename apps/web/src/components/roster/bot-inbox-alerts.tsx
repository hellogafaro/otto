import { RiCloseLine } from "@remixicon/react";
import { Predicate } from "effect";
import { useState } from "react";

import { botInboxKindLabel, type BotInboxItem } from "@otto/client-runtime/bot-inbox";
import type { EnvironmentId } from "@otto/contracts";

import { useI18n } from "../../i18n";
import { botInboxEnvironment } from "../../state/bot-inbox";
import { useAtomCommand } from "../../state/use-atom-command";
import { ChatAlertCard } from "../chat/thread-error-card";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/**
 * Otto: A bot's open failures (a provider connection or the watchdog) sit at the end of its chats
 * as chat alerts: what failed, what happens next and the error itself. Dismissing one resolves it.
 * Approvals have their inline card, routine failures stay in the inbox, and a browser failure
 * (only older ones exist) is already in the bot's own reply.
 */
export function BotInboxAlerts({
  items,
  environmentId,
  onResolved,
}: {
  readonly items: ReadonlyArray<BotInboxItem>;
  readonly environmentId: EnvironmentId | null;
  /** The chat reads subscriptionAuth.inbox. Resolve only refreshes botInbox.list. */
  readonly onResolved?: () => void;
}) {
  const { t } = useI18n();
  const resolveIncident = useAtomCommand(botInboxEnvironment.resolve);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());

  const dismiss = (id: string) => {
    if (environmentId === null) return;
    setDismissed((current) => new Set(current).add(id));
    void resolveIncident({ environmentId, input: { id } }).then((result) => {
      if (Predicate.isTagged(result, "Success")) {
        onResolved?.();

        return;
      }

      setDismissed((current) => {
        const next = new Set(current);
        next.delete(id);

        return next;
      });
    });
  };

  return items
    .filter(
      (item) =>
        item.kind !== "approval-request" &&
        item.kind !== "routine-failure" &&
        !dismissed.has(item.id),
    )
    .map((item) => (
      <ChatAlertCard
        key={item.id}
        title={t(botInboxKindLabel(item.kind))}
        description={item.nextAction}
        details={item.lastFailure}
        actions={
          environmentId === null ? null : (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    aria-label={t("Dismiss")}
                    onClick={() => dismiss(item.id)}
                    size="icon-sm"
                    type="button"
                    variant="ghost-muted"
                  />
                }
              >
                <RiCloseLine />
              </TooltipTrigger>
              <TooltipPopup side="top">{t("Dismiss")}</TooltipPopup>
            </Tooltip>
          )
        }
      />
    ));
}
