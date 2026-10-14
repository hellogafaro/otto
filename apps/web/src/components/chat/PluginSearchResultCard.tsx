import { RiCheckboxCircleLine, RiToolsLine } from "@remixicon/react";
import type { MessageKey } from "@otto/client-runtime/i18n";
import type { OttoPluginRecommendation, OttoPluginSearchResult } from "@otto/contracts";

import { memo } from "react";

import { loadDirectoryCatalog } from "../../../../../plugins";
import { openCustomize } from "../../customizeNavigation";
import { useI18n } from "~/i18n";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";

const DIRECTORY_PLUGINS = new Map(loadDirectoryCatalog().map((plugin) => [plugin.id, plugin]));

function recommendationActionLabel(
  recommendation: OttoPluginRecommendation,
  composioStatus: OttoPluginSearchResult["sources"]["composio"],
  t: (key: MessageKey) => string,
): string {
  if (recommendation.action === "install") return t("Install");

  if (
    recommendation.action === "connect" &&
    recommendationUsesComposio(recommendation) &&
    composioStatus === "setup-required"
  ) {
    return t("Set up");
  }

  if (recommendation.action === "connect") return t("Connect");

  if (recommendation.action === "unavailable") return t("Unavailable");

  return t("Manage");
}

function recommendationLogo(recommendation: OttoPluginRecommendation): string | undefined {
  if (recommendation.logoUrl) return recommendation.logoUrl;

  if (recommendation.source === "composio") {
    const slug = recommendation.id.replace(/^composio:/, "");

    return `https://logos.composio.dev/api/${encodeURIComponent(slug)}`;
  }

  return recommendation.source === "directory"
    ? DIRECTORY_PLUGINS.get(recommendation.id)?.logo.src
    : undefined;
}

function recommendationProviderLabel(recommendation: OttoPluginRecommendation): string {
  if (recommendation.source === "composio") return "Composio";
  const plugin = DIRECTORY_PLUGINS.get(recommendation.id);

  return plugin?.connection.type === "brokered" ? plugin.connection.broker.name : "Otto";
}

function recommendationUsesComposio(recommendation: OttoPluginRecommendation): boolean {
  return recommendationProviderLabel(recommendation) === "Composio";
}

export const PluginSearchResultCard = memo(function PluginSearchResultCard({
  result,
  className,
}: {
  readonly result: OttoPluginSearchResult;
  readonly className?: string;
}) {
  const { t } = useI18n();
  const recommendation = result.recommendations[0];

  if (!recommendation) return null;

  const logo = recommendationLogo(recommendation);
  const action = recommendationActionLabel(recommendation, result.sources.composio, t);
  const connected = recommendation.action === "open";

  const setupRequired =
    recommendation.action === "connect" &&
    recommendationUsesComposio(recommendation) &&
    result.sources.composio === "setup-required";

  return (
    <section
      aria-label={t("{name} plugin", { name: recommendation.name })}
      className={cn(
        "flex max-w-xl min-w-0 items-center gap-3 rounded-lg border border-border/70 bg-card/55 px-3 py-2.5",
        className,
      )}
    >
      <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted p-1.5">
        {logo ? (
          <img alt="" className="size-full object-contain" src={logo} />
        ) : (
          <RiToolsLine aria-hidden="true" className="size-4 text-muted-foreground" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium">{recommendation.name}</p>
          <span className="shrink-0 text-11px text-muted-foreground">
            {recommendationProviderLabel(recommendation)}
          </span>
        </div>
        {connected ? (
          <p className="flex items-center gap-1 text-xs text-plugin-connected">
            <RiCheckboxCircleLine aria-hidden="true" className="size-3" />
            {t("Connected")}
          </p>
        ) : (
          <p className="truncate text-xs text-muted-foreground">
            {setupRequired ? t("Set up Composio first") : recommendation.description}
          </p>
        )}
      </div>
      <Button
        aria-label={t("{action} {name}", { action, name: recommendation.name })}
        presentation="plugin-action"
        className="h-8"
        disabled={recommendation.action === "unavailable"}
        size="sm"
        variant="secondary"
        onClick={() => openCustomize("integrations", recommendation.name)}
      >
        {action}
      </Button>
    </section>
  );
});
