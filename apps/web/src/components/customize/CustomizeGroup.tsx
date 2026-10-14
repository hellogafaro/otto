import { RiAddLine, RiArrowRightSLine } from "@remixicon/react";
import type { ReactNode } from "react";

import { SETTINGS_SECTION_TITLE_CLASS, SettingsCard } from "../settings/settingsLayout";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyMedia } from "../ui/empty";
import { Menu, MenuPopup, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/** A 32px tile holding an app's logo or a glyph, on the card surface. */
export function LogoTile({ children }: { readonly children: ReactNode }) {
  return (
    <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border/70 bg-card text-muted-foreground">
      {children}
    </span>
  );
}

/** One entity in a group card: its tile, name, an optional muted line, a status and a chevron. */
export function CustomizeRow({
  logo,
  name,
  detail,
  status,
  onOpen,
}: {
  readonly logo: ReactNode;
  readonly name: string;
  readonly detail?: string | undefined;
  readonly status?: ReactNode;
  readonly onOpen: () => void;
}) {
  return (
    <div data-settings-row="">
      <button
        type="button"
        className="flex w-full items-center gap-3 px-4 py-3 text-left outline-none hover:bg-foreground/3.5 focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onOpen}
      >
        <LogoTile>{logo}</LogoTile>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-13px font-medium text-foreground">{name}</span>
          {detail ? (
            <span className="block truncate text-xs text-muted-foreground">{detail}</span>
          ) : null}
        </span>
        {status}
        <RiArrowRightSLine aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      </button>
    </div>
  );
}

/** One read-only entry in a card, such as a tool: its tile, name and full description. */
export function CustomizeItem({
  icon,
  name,
  description,
}: {
  readonly icon: ReactNode;
  readonly name: string;
  readonly description?: string | undefined;
}) {
  return (
    <div data-settings-row="" className="flex items-center gap-3 px-4 py-3">
      <LogoTile>{icon}</LogoTile>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-13px font-medium text-foreground">{name}</span>
        {description ? (
          <span className="block text-xs leading-copy text-muted-foreground">{description}</span>
        ) : null}
      </span>
    </div>
  );
}

/**
 * Otto: A Customize group copies Capy's MCP & plugins page: a 16px title, then a card whose first row counts what it holds beside its action, a quiet plus menu or one button.
 * An empty card holds the icon-and-description empty state.
 */
export function CustomizeGroup({
  title,
  count,
  empty,
  action,
  children,
}: {
  readonly title: string;
  readonly count: string;
  /** Shown as the icon-and-description empty state while the group holds nothing. */
  readonly empty: { readonly icon: ReactNode; readonly description: string } | null;
  readonly action: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className={`px-4 ${SETTINGS_SECTION_TITLE_CLASS}`}>{title}</h2>
      <SettingsCard>
        <div data-settings-row="" className="flex h-12 items-center gap-2 ps-4 pe-2.5">
          <span className="flex-1 text-13px font-medium text-foreground">{count}</span>
          {action}
        </div>
        {empty ? (
          <div data-settings-row="">
            <Empty>
              <EmptyMedia variant="icon">{empty.icon}</EmptyMedia>
              <EmptyDescription>{empty.description}</EmptyDescription>
            </Empty>
          </div>
        ) : (
          children
        )}
      </SettingsCard>
    </section>
  );
}

/** The quiet plus beside a group's count, opening what can be added there. */
export function AddMenu({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <Menu>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              render={
                <Button size="icon-sm" variant="ghost-muted" aria-label={label}>
                  <RiAddLine aria-hidden className="size-4" />
                </Button>
              }
            />
          }
        />
        <TooltipPopup side="bottom">{label}</TooltipPopup>
      </Tooltip>
      <MenuPopup align="end">{children}</MenuPopup>
    </Menu>
  );
}
