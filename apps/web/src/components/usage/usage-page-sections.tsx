import { RiCheckLine, RiCloseLine } from "@remixicon/react";
import type { UsageProviderKind } from "@otto/contracts";

import { cn } from "../../lib/utils";
import type { EnvironmentUsageStatus } from "@otto/client-runtime/usage";
import { Skeleton, SkeletonTableRows } from "../ui/skeleton";
import { PROVIDER_PRESENTATION } from "./usage-providers";

/** Brand mark for the harness a row belongs to. */
export function ProviderMark({
  provider,
  className,
}: {
  readonly provider: UsageProviderKind;
  readonly className: string;
}) {
  const Mark = PROVIDER_PRESENTATION[provider].mark;

  return <Mark className={cn("shrink-0", className)} aria-hidden />;
}

/**
 * Says plainly when the totals are incomplete: an environment that failed, or
 * one whose transcripts another environment already reported. Environments
 * that are still answering never reach this notice; the page shows the
 * loading skeleton until every one is terminal.
 */
export function UsageCoverageNotice({
  environments,
  duplicateSources,
  staleEnvironments,
}: {
  readonly environments: readonly EnvironmentUsageStatus[];
  readonly duplicateSources: readonly string[];
  readonly staleEnvironments: readonly string[];
}) {
  const failed = environments.filter((environment) => environment.error !== null);

  const stale = environments.filter((environment) =>
    staleEnvironments.includes(environment.environmentId),
  );

  if (failed.length === 0 && stale.length === 0 && duplicateSources.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-1 border border-border px-3 py-2 text-xs text-muted-foreground">
      {failed.map((environment) => (
        <span key={environment.label}>{environment.label} could not report usage.</span>
      ))}
      {stale.map((environment) => (
        <span key={environment.label}>
          {environment.label} runs an older server version and is excluded from totals.
        </span>
      ))}
      {duplicateSources.length > 0 ? (
        <span>
          Counted once across clients sharing an environment usage store:{" "}
          {duplicateSources.join(", ")}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Per-device progress while the page waits for every environment to answer.
 * Only rendered with two or more devices; a lone device has nothing to
 * enumerate.
 */
export function UsageDeviceStrip({
  environments,
}: {
  readonly environments: readonly EnvironmentUsageStatus[];
}) {
  const scanning = environments.filter(
    (environment) => environment.summary === null && environment.error === null,
  );

  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border border-border px-3 py-2 text-xs">
      {environments.map((environment) => {
        if (environment.summary !== null) {
          return (
            <span
              key={environment.environmentId}
              className="flex items-center gap-1 text-foreground"
            >
              <RiCheckLine className="size-3 text-success-foreground" aria-hidden />
              {environment.label}
            </span>
          );
        }

        if (environment.error !== null) {
          return (
            <span
              key={environment.environmentId}
              className="flex items-center gap-1 text-destructive"
            >
              <RiCloseLine className="size-3" aria-hidden />
              {environment.label}
            </span>
          );
        }

        return (
          <span
            key={environment.environmentId}
            className="animate-status-pulse text-muted-foreground"
          >
            {environment.label}…
          </span>
        );
      })}
      <span className="ms-auto text-muted-foreground">
        {scanning.length === 1
          ? "1 device still scanning"
          : `${scanning.length} devices still scanning`}
      </span>
    </div>
  );
}

/**
 * Stand-in with the loaded page's shape: the total and chart card, then the breakdown rows.
 * Static like other long-lived loading states; it fills in once when the last device answers.
 */
export function UsageSkeleton() {
  return (
    <>
      <div className="flex flex-col gap-3 rounded-lg border border-border/70 bg-settings-surface p-4">
        <div className="flex flex-col gap-1">
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton tone="faint" className="h-56" />
      </div>
      <SkeletonTableRows label="Loading usage" rows={4} />
    </>
  );
}
