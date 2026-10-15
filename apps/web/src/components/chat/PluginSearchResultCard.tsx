import { RiAddLine } from "@remixicon/react";
import type { MessageKey } from "@otto/client-runtime/i18n";
import type { OttoPluginRecommendation, OttoPluginSearchResult } from "@otto/contracts";

import { memo } from "react";

import { loadDirectoryCatalog } from "../../../../../plugins";
import { openCustomize, openCustomizeApp } from "../../customizeNavigation";
import { useI18n } from "~/i18n";
import { cn } from "~/lib/utils";
import { LogoTile } from "../customize/CustomizeGroup";
import { AppLogo } from "../customize/CustomizeIntegrations";
import { SettingsCard } from "../settings/settingsLayout";
import { Button } from "../ui/button";

const DIRECTORY_PLUGINS = new Map(loadDirectoryCatalog().map((plugin) => [plugin.id, plugin]));

function recommendationActionLabel(
  recommendation: OttoPluginRecommendation,
  setupRequired: boolean,
  t: (key: MessageKey) => string,
): string {
  if (recommendation.action === "install") return t("Install");

  if (setupRequired) return t("Set up");

  if (recommendation.action === "connect") return t("Connect");

  if (recommendation.action === "unavailable") return t("Unavailable");

  return t("Manage");
}

function composioSlug(recommendation: OttoPluginRecommendation): string | null {
  return recommendation.source === "composio" ? recommendation.id.replace(/^composio:/, "") : null;
}

function recommendationLogo(recommendation: OttoPluginRecommendation): string | undefined {
  if (recommendation.logoUrl) return recommendation.logoUrl;

  const slug = composioSlug(recommendation);

  if (slug) return `https://logos.composio.dev/api/${encodeURIComponent(slug)}`;

  return recommendation.source === "directory"
    ? DIRECTORY_PLUGINS.get(recommendation.id)?.logo.src
    : undefined;
}

function recommendationUsesComposio(recommendation: OttoPluginRecommendation): boolean {
  if (recommendation.source === "composio") return true;
  const plugin = DIRECTORY_PLUGINS.get(recommendation.id);

  return plugin?.connection.type === "brokered" && plugin.connection.broker.name === "Composio";
}

/**
 * Otto: The app a bot suggests, as one Customize row in a card: the logo tile, the name over one
 * muted line, and an outline action that opens the app's page, where accounts are connected.
 */
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

  const setupRequired =
    recommendation.action === "connect" &&
    recommendationUsesComposio(recommendation) &&
    result.sources.composio === "setup-required";

  const action = recommendationActionLabel(recommendation, setupRequired, t);
  const slug = composioSlug(recommendation);

  const detail = setupRequired
    ? t("Set up Composio first")
    : recommendation.action === "open"
      ? t("Connected")
      : recommendation.description;

  return (
    <section
      aria-label={t("{name} plugin", { name: recommendation.name })}
      className={cn("max-w-xl min-w-0", className)}
    >
      <SettingsCard>
        <div data-settings-row="" className="flex items-center gap-3 py-3 ps-4 pe-3">
          <LogoTile>
            <AppLogo
              src={recommendationLogo(recommendation)}
              name={recommendation.name}
              className="size-4"
            />
          </LogoTile>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-13px font-medium text-foreground">
              {recommendation.name}
            </span>
            {detail ? (
              <span className="block truncate text-xs text-muted-foreground">{detail}</span>
            ) : null}
          </span>
          <Button
            aria-label={t("{action} {name}", { action, name: recommendation.name })}
            disabled={recommendation.action === "unavailable"}
            size="sm"
            variant="outline"
            onClick={() =>
              slug ? openCustomizeApp(slug) : openCustomize("integrations", recommendation.name)
            }
          >
            {recommendation.action === "connect" && !setupRequired ? (
              <RiAddLine aria-hidden />
            ) : null}
            {action}
          </Button>
        </div>
      </SettingsCard>
    </section>
  );
});
