import { RiErrorWarningLine } from "@remixicon/react";

import { botInboxKindLabel, type BotInboxItem } from "@otto/client-runtime/bot-inbox";
import { useI18n } from "../../i18n";
import { Button } from "../ui/button";
import { ComposerBannerStack } from "../chat/composer-banner-stack";

export function BotInboxAlertStack({
  items,
  onOpenDetails,
}: {
  readonly items: ReadonlyArray<BotInboxItem>;
  readonly onOpenDetails: () => void;
}) {
  const { t } = useI18n();

  const visibleItems = items.filter(
    (item) => item.kind !== "approval-request" && item.kind !== "routine-failure",
  );

  if (visibleItems.length === 0) return null;

  return (
    <ComposerBannerStack
      className="relative z-0 mx-4 sm:mx-6"
      items={visibleItems.map((item) => ({
        id: item.id,
        variant: "error",
        icon: <RiErrorWarningLine />,
        title: `${item.botName} · ${item.taskOrRoutine} · ${t(botInboxKindLabel(item.kind))}`,
        description: (
          <>
            <span>{item.lastFailure}</span>
            <span>{t("Next: {action}", { action: item.nextAction })}</span>
          </>
        ),
        actions: (
          <Button size="xs" variant="ghost" onClick={onOpenDetails}>
            {t("View details")}
          </Button>
        ),
      }))}
    />
  );
}
