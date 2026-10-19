import { RiAddLine, RiArrowRightSLine } from "@remixicon/react";
import type { ReactNode } from "react";

import { SettingsSection } from "../settings/settings-layout";
import { Button } from "../ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../ui/empty";
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

/**
 * One entity in a group card: its tile, name, an optional muted line, a status and a chevron.
 * Otto: A person or bot shows its own 32px round avatar in the tile's place, never inside a tile.
 */
export function CustomizeRow({
  logo,
  avatar,
  name,
  detail,
  status,
  onOpen,
}: {
  readonly logo?: ReactNode;
  readonly avatar?: ReactNode;
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
        {avatar ?? <LogoTile>{logo}</LogoTile>}
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
 * Otto: A card's first row, as on Bots and Skills: how many items the card holds and, at the
 * right, the plus that adds one. It stays while the card is empty.
 */
export function CardCountRow({
  label,
  action,
}: {
  readonly label: string;
  readonly action: ReactNode;
}) {
  return (
    <div data-settings-row="" className="flex items-center justify-between gap-3 px-4 py-3">
      <span className="text-13px font-medium text-foreground">{label}</span>
      {action}
    </div>
  );
}

/**
 * Otto: A Customize group is a settings section: its 16px title above the card on the card edge,
 * its count in a lighter weight right after the title, and its action (a quiet plus menu or one
 * button) at the right.
 * A `header` row, such as CardCountRow, leads the card and replaces the count and action.
 * An empty card holds the icon-and-description empty state.
 */
export function CustomizeGroup({
  title,
  count,
  empty,
  action,
  header,
  children,
}: {
  readonly title: string;
  readonly count?: number | undefined;
  /** Shown as the icon-and-description empty state while the group holds nothing. */
  readonly empty: { readonly icon: ReactNode; readonly description: string } | null;
  readonly action?: ReactNode;
  readonly header?: ReactNode;
  readonly children?: ReactNode;
}) {
  return (
    <SettingsSection title={title} count={count} headerAction={action}>
      {header}
      {empty ? (
        <div data-settings-row="">
          <Empty className="flex-none px-6 py-8 md:p-8">
            <EmptyHeader>
              <EmptyMedia variant="icon">{empty.icon}</EmptyMedia>
              <EmptyTitle>{empty.description}</EmptyTitle>
            </EmptyHeader>
          </Empty>
        </div>
      ) : (
        children
      )}
    </SettingsSection>
  );
}

/** The shared empty state for a settings card or page: icon tile, title, optional description. */
export function CustomizeEmpty({
  icon,
  title,
  description,
  action,
}: {
  readonly icon: ReactNode;
  readonly title: string;
  readonly description?: string;
  readonly action?: ReactNode;
}) {
  return (
    <Empty className="flex-none px-6 py-10">
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon}</EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {description ? <EmptyDescription>{description}</EmptyDescription> : null}
        {action ? <EmptyContent>{action}</EmptyContent> : null}
      </EmptyHeader>
    </Empty>
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
