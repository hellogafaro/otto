import { RiArrowRightSLine } from "@remixicon/react";
import {
  Link,
  type LinkComponentProps,
  type RegisteredRouter,
  type ValidateLinkOptions,
} from "@tanstack/react-router";

import type { ReactNode } from "react";

import { cn } from "../../lib/utils";
import type { Icon } from "../icons";
import type { ConnectionTone } from "./provider-status";

const TONE_DOT_CLASS: Readonly<Record<ConnectionTone, string>> = {
  positive: "bg-success",
  neutral: "bg-muted-foreground/35",
  attention: "bg-warning",
  pending: "bg-muted-foreground/20",
};

/** A dot and a word or two. The one status a list row or page header shows. */
export function SettingsStatus({
  tone,
  label,
  className,
}: {
  readonly tone: ConnectionTone;
  readonly label: string;
  readonly className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 text-xs whitespace-nowrap",
        tone === "attention" ? "text-foreground" : "text-muted-foreground",
        className,
      )}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", TONE_DOT_CLASS[tone])} />
      {label}
    </span>
  );
}

/** Brand mark for a provider or channel. String icons are monochrome SVG files. */
export function SettingsEntityIcon({
  icon: IconComponent,
  className,
}: {
  readonly icon: Icon;
  readonly className?: string;
}) {
  return <IconComponent aria-hidden className={cn("size-4 shrink-0", className)} />;
}

function IconTile({ icon, size }: { readonly icon: Icon; readonly size: "sm" | "lg" }) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center border border-border/70",
        size === "sm" ? "size-8 rounded-lg" : "size-11 rounded-xl",
      )}
    >
      <SettingsEntityIcon icon={icon} className={size === "sm" ? "size-4" : "size-5"} />
    </span>
  );
}

/**
 * A list row that opens a subpage. Several of these in one `SettingsSection`
 * group into a single card, like plain `SettingsRow`s.
 */
export function SettingsLinkRow<TRouter extends RegisteredRouter, TOptions>({
  id,
  link,
  icon,
  title,
  description,
  tone,
  statusLabel,
}: {
  /** Anchor so other pages can open Settings on this row. */
  readonly id?: string;
  readonly link: ValidateLinkOptions<TRouter, TOptions>;
  readonly icon: Icon;
  readonly title: string;
  readonly description?: ReactNode;
  readonly tone: ConnectionTone;
  readonly statusLabel: string;
}) {
  // SAFETY: ValidateLinkOptions has already checked these route options; Link erases the generic route parameter.
  return (
    <Link
      {...(link as LinkComponentProps)}
      {...(id ? { id } : {})}
      data-settings-row=""
      className="group relative flex min-h-14 items-center gap-3 rounded-lg px-4 py-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-1.5 inset-y-1 rounded-lg transition-colors group-hover:bg-muted/50"
      />
      <span className="relative flex min-w-0 flex-1 items-center gap-3">
        <IconTile icon={icon} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">{title}</span>
          {description ? (
            <span className="block truncate text-13px text-muted-foreground/80">{description}</span>
          ) : null}
        </span>
        <SettingsStatus tone={tone} label={statusLabel} />
        <RiArrowRightSLine
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-muted-foreground"
        />
      </span>
    </Link>
  );
}

/** Header of a settings subpage: a way back, then what the page is about. */
export function SettingsDetailHeader({
  icon,
  title,
  tone,
  statusLabel,
  description,
  action,
}: {
  readonly icon: Icon;
  readonly title: string;
  readonly tone: ConnectionTone;
  readonly statusLabel: string;
  readonly description?: ReactNode;
  readonly action?: ReactNode;
}) {
  return (
    <header className="space-y-4 px-4">
      <div className="flex items-center gap-3.5">
        <IconTile icon={icon} size="lg" />
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <h1 className="truncate text-22px leading-title font-medium tracking-title-lg text-foreground">
              {title}
            </h1>
            <SettingsStatus tone={tone} label={statusLabel} />
          </div>
          {description ? (
            <p className="truncate text-13px text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
      </div>
    </header>
  );
}

/** Full-width message row for a grouped section: an empty, loading, or error state. */
export function SettingsMessageRow({
  children,
  action,
  tone = "neutral",
}: {
  readonly children: ReactNode;
  readonly action?: ReactNode;
  readonly tone?: "neutral" | "error";
}) {
  return (
    <div
      data-settings-row=""
      role={tone === "error" ? "alert" : undefined}
      className="flex min-h-14 flex-wrap items-center justify-between gap-3 rounded-lg p-4"
    >
      <p
        className={cn(
          "min-w-0 text-13px leading-copy",
          tone === "error" ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {children}
      </p>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}
