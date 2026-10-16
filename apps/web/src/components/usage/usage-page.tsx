import { RiBarChartLine, RiLoopRightLine } from "@remixicon/react";
import { useAtomValue } from "@effect/atom-react";
import type { ServerProvider } from "@otto/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { formatModelSlug } from "@otto/shared/model";
import type { MemberTotals, ModelTotals } from "@otto/shared/usageMerge";
import {
  enumerateDays,
  enumerateHourStarts,
  formatCount,
  formatDateTimeShort,
  formatDayShort,
  formatPercent,
  formatTokens,
  formatUsd,
  makeWindow,
} from "@otto/shared/usageFormat";

import { primaryServerProvidersAtom } from "../../state/server";
import { useUsage } from "../../state/usage";
import { getDisplayModelName } from "../chat/provider-icon-utils";
import { BotAvatarView } from "../roster/bot-avatar-view";
import { PersonAvatar } from "../roster/person-avatar";
import { useRosterStore } from "../roster/roster-store";
import type { Bot } from "../roster/types";
import { SETTINGS_SECTION_TITLE_CLASS, SettingsPageContainer } from "../settings/settings-layout";
import { Button } from "../ui/button";
import { DataTable, type DataTableColumn } from "../ui/data-table";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../ui/empty";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { PLAN_PROVIDER_ORDER, UsagePlanLimits } from "./usage-charts";
import {
  isUsageMetric,
  isUsageWindowDays,
  METRIC_OPTIONS,
  readUsagePagePreferences,
  saveUsagePagePreferences,
  type UsageMetric,
  WINDOW_OPTIONS,
} from "./usage-page-preferences";
import {
  ProviderMark,
  UsageCoverageNotice,
  UsageDeviceStrip,
  UsageSkeleton,
} from "./usage-page-sections";
import { UsageProviderChart } from "./usage-provider-chart";
import { PROVIDER_PRESENTATION, providersWithUsage } from "./usage-providers";

// Otto: plan limits reload every 5 minutes; there is no setting for it.
const USAGE_REFRESH_MS = 5 * 60 * 1000;

/** The figures every usage row ends with, in fixed-width columns so they line up down the page. */
function figureColumns<T extends { readonly costUsd: number; readonly totalTokens: number }>(
  metric: UsageMetric,
  totalTokens: number,
  costShare: (row: T) => number,
): DataTableColumn<T>[] {
  return [
    {
      id: "tokens",
      type: "meta",
      header: "Tokens",
      className: "w-24 justify-end",
      cell: (row) => formatTokens(row.totalTokens),
    },
    {
      id: "share",
      type: "meta",
      header: "Share",
      className: "w-14 justify-end",
      cell: (row) =>
        formatPercent(
          metric === "cost"
            ? costShare(row)
            : totalTokens === 0
              ? 0
              : row.totalTokens / totalTokens,
        ),
    },
    {
      id: "cost",
      type: "meta",
      header: "Cost",
      className: "w-20 justify-end",
      cell: (row) => formatUsd(row.costUsd),
    },
  ];
}

/** A model row: its provider's mark and the name the model pickers show, then the shared figures. */
function modelColumns(
  metric: UsageMetric,
  totalTokens: number,
  providers: readonly ServerProvider[],
): DataTableColumn<ModelTotals>[] {
  const modelName = (slug: string) => {
    const model = providers
      .flatMap((provider) => provider.models)
      .find((candidate) => candidate.slug === slug);

    return model ? getDisplayModelName(model) : formatModelSlug(slug);
  };

  return [
    {
      id: "provider",
      type: "icon",
      cell: (model) => <ProviderMark provider={model.provider} className="size-3.5" />,
    },
    { id: "model", type: "title", header: "Model", cell: (model) => modelName(model.model) },
    ...figureColumns<ModelTotals>(metric, totalTokens, (model) => model.costShare),
  ];
}

/** A member's row: a person with their initials, or a bot with its avatar, named from the roster. */
function memberColumns(
  metric: UsageMetric,
  totalTokens: number,
  bots: readonly Bot[],
): DataTableColumn<MemberTotals>[] {
  const botOf = (member: MemberTotals) => bots.find((bot) => bot.id === member.botId);

  return [
    {
      id: "avatar",
      className: "w-5 justify-center",
      cell: (member) => {
        const bot = botOf(member);

        return bot ? (
          <BotAvatarView avatar={bot.avatar} name={bot.name} className="size-5" />
        ) : (
          <PersonAvatar name={member.displayName ?? "?"} className="size-5 text-9px" />
        );
      },
    },
    {
      id: "name",
      type: "title",
      header: "Member",
      cell: (member) => botOf(member)?.name ?? member.displayName ?? "Unknown",
    },
    {
      id: "chats",
      type: "meta",
      header: "Chats",
      className: "w-16 justify-end",
      cell: (member) => formatCount(member.sessions),
    },
    ...figureColumns<MemberTotals>(metric, totalTokens, (member) => member.costShare),
  ];
}

export function UsagePage() {
  const navigate = useNavigate();
  const rosterBots = useRosterStore((state) => state.bots);
  const providers = useAtomValue(primaryServerProvidersAtom);
  const [preferences, setPreferences] = useState(readUsagePagePreferences);

  const [windowSelection, setWindowSelection] = useState(() => ({
    days: preferences.windowDays,
    window: makeWindow(
      preferences.windowDays,
      undefined,
      preferences.windowDays === 1 ? "hour" : "day",
    ),
  }));

  const metric = preferences.metric;
  const { days: windowDays, window } = windowSelection;
  const isPast24Hours = windowDays === 1;
  const { merged, environments, isPending, isPartial, refresh } = useUsage(window);

  const planLimits = PLAN_PROVIDER_ORDER.map((provider) =>
    merged.planLimits.find((entry) => entry.provider === provider && entry.status === "ok"),
  ).filter((entry) => entry !== undefined);

  useEffect(() => {
    const timer = globalThis.setInterval(refresh, USAGE_REFRESH_MS);

    return () => globalThis.clearInterval(timer);
  }, [refresh]);

  const days = useMemo(
    () => enumerateDays(window.sinceDay, window.untilDay),
    [window.sinceDay, window.untilDay],
  );

  const hours = useMemo(
    () =>
      window.sinceTime === undefined || window.untilTime === undefined
        ? []
        : enumerateHourStarts(window.sinceTime, window.untilTime),
    [window.sinceTime, window.untilTime],
  );

  const activeProviders = useMemo(() => providersWithUsage(merged.providers), [merged.providers]);

  const selectWindow = (days: number) => {
    if (!isUsageWindowDays(days)) return;
    const nextPreferences = { metric, windowDays: days };
    setPreferences(nextPreferences);
    saveUsagePagePreferences(nextPreferences);
    setWindowSelection({
      days,
      window: makeWindow(days, undefined, days === 1 ? "hour" : "day"),
    });
  };

  const selectMetric = (nextMetric: UsageMetric) => {
    const nextPreferences = { metric: nextMetric, windowDays };
    setPreferences(nextPreferences);
    saveUsagePagePreferences(nextPreferences);
  };

  const refreshWindow = () => {
    const nextWindow = makeWindow(windowDays, undefined, isPast24Hours ? "hour" : "day");

    if (
      nextWindow.sinceDay === window.sinceDay &&
      nextWindow.untilDay === window.untilDay &&
      nextWindow.sinceTime === window.sinceTime &&
      nextWindow.untilTime === window.untilTime
    ) {
      refresh();
    } else {
      setWindowSelection({ days: windowDays, window: nextWindow });
    }
  };

  const windowLabel =
    isPast24Hours && window.sinceTime !== undefined && window.untilTime !== undefined
      ? `${formatDateTimeShort(window.sinceTime, window.timeZone)} – ${formatDateTimeShort(window.untilTime, window.timeZone)}`
      : `${formatDayShort(window.sinceDay)} – ${formatDayShort(window.untilDay)}`;

  return (
    <SettingsPageContainer>
      {planLimits.length > 0 ? <UsagePlanLimits planLimits={planLimits} /> : null}

      <div id="usage" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup
            aria-label="Usage period"
            variant="segmented"
            value={[String(windowDays)]}
            onValueChange={(next) => {
              const value = next[0];

              if (value) selectWindow(Number(value));
            }}
          >
            {WINDOW_OPTIONS.map((option) => (
              <Toggle key={option.days} value={String(option.days)}>
                {option.label}
              </Toggle>
            ))}
          </ToggleGroup>
          <ToggleGroup
            aria-label="Usage metric"
            variant="segmented"
            className="ms-auto"
            value={[metric]}
            onValueChange={(next) => {
              const value = next[0];

              if (isUsageMetric(value)) selectMetric(value);
            }}
          >
            {METRIC_OPTIONS.map((option) => (
              <Toggle key={option.value} value={option.value}>
                {option.label}
              </Toggle>
            ))}
          </ToggleGroup>
          <Button onClick={refreshWindow} aria-label="Refresh usage" size="icon-sm" variant="ghost">
            <RiLoopRightLine className="size-3.5" />
          </Button>
        </div>

        {isPartial && environments.length > 1 ? (
          <UsageDeviceStrip environments={environments} />
        ) : null}
        <UsageCoverageNotice
          environments={environments}
          duplicateSources={merged.duplicateSources}
          staleEnvironments={merged.staleEnvironments}
        />

        {isPending ? (
          <UsageSkeleton />
        ) : merged.connectedProviders.length === 0 ? (
          merged.staleEnvironments.length > 0 ? null : (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <RiBarChartLine />
                </EmptyMedia>
                <EmptyTitle>No usage yet</EmptyTitle>
                <EmptyDescription>
                  Connect a provider in Settings, and what bots spend shows here.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button
                  onClick={() =>
                    void navigate({ to: "/settings/$section", params: { section: "models" } })
                  }
                >
                  Connect a provider
                </Button>
              </EmptyContent>
            </Empty>
          )
        ) : (
          <div className="flex flex-col gap-3 rounded-lg border border-border/70 bg-settings-surface p-4">
            <div className="flex flex-col gap-0.5">
              <span className="text-lg font-medium text-foreground tabular-nums">
                {metric === "cost"
                  ? formatUsd(merged.costUsd)
                  : `${formatTokens(merged.totalTokens)} tokens`}
              </span>
              <span className="text-xs text-muted-foreground">
                {windowLabel} · {formatCount(merged.sessions)}{" "}
                {merged.sessions === 1 ? "chat" : "chats"}
                {metric === "cost"
                  ? merged.costQuality.unpricedShare > 0
                    ? ` · API estimate, excluding ${formatPercent(merged.costQuality.unpricedShare)} unpriced`
                    : " · API estimate"
                  : null}
              </span>
            </div>
            <UsageProviderChart
              providers={activeProviders}
              days={days}
              daily={merged.daily}
              hours={hours}
              hourly={merged.hourly}
              metric={metric}
              referenceTime={window.untilTime}
              resolution={isPast24Hours ? "hour" : "day"}
              timeZone={window.timeZone}
            />
          </div>
        )}
      </div>

      {!isPending && merged.connectedProviders.length > 0 ? (
        <>
          <section className="flex flex-col gap-3">
            <h2 className={SETTINGS_SECTION_TITLE_CLASS}>Breakdown</h2>
            {merged.models.length === 0 ? (
              <p className="text-13px text-muted-foreground">No activity in this period.</p>
            ) : (
              <DataTable
                rows={merged.models}
                columns={modelColumns(metric, merged.totalTokens, providers)}
                getRowKey={(model) => `${model.provider}:${model.model}`}
                getRowLabel={(model) =>
                  `${PROVIDER_PRESENTATION[model.provider].label} ${model.model}, ${formatUsd(model.costUsd)}`
                }
              />
            )}
          </section>

          {merged.members.length > 0 ? (
            <section className="flex flex-col gap-3">
              <h2 className={SETTINGS_SECTION_TITLE_CLASS}>By member</h2>
              <DataTable
                rows={merged.members}
                columns={memberColumns(metric, merged.totalTokens, rosterBots)}
                getRowKey={(member) => member.personId ?? `bot:${member.botId ?? ""}`}
                getRowLabel={(member) =>
                  `${rosterBots.find((bot) => bot.id === member.botId)?.name ?? member.displayName ?? "Unknown"}, ${formatUsd(member.costUsd)}`
                }
              />
            </section>
          ) : null}
        </>
      ) : null}
    </SettingsPageContainer>
  );
}
