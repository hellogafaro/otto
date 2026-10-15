import type { WorkStatus } from "@otto/contracts";
import { RiArchiveLine, RiInboxUnarchiveLine, RiMoreLine } from "@remixicon/react";

import { useI18n } from "../../i18n";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ComposerSelectControl } from "../chat/composer-control";
import { StatusIcon } from "../status-icon";
import { WORK_STATUS_CHOICES } from "./work.logic";

/** A task or project status glyph; archived is not a status choice but still shows. */
export function WorkStatusIcon({
  status,
  className,
}: {
  readonly status: WorkStatus;
  readonly className?: string;
}) {
  if (status === "archived") {
    return (
      <RiArchiveLine
        aria-hidden
        className={cn("size-3 shrink-0 text-muted-foreground", className)}
      />
    );
  }

  return <StatusIcon status={status} className={className} />;
}

export function useWorkStatusLabel(): (status: WorkStatus) => string {
  const { t } = useI18n();

  return (status) => {
    switch (status) {
      case "backlog":
        return t("Backlog");
      case "pending":
        return t("Pending");
      case "in_progress":
        return t("In progress");
      case "completed":
        return t("Completed");
      case "cancelled":
        return t("Cancelled");
      case "archived":
        return t("Archived");
    }
  };
}

function isWorkStatus(value: unknown): value is WorkStatus {
  return WORK_STATUS_CHOICES.some((status) => status === value);
}

/**
 * A status pill: the glyph and its name, opening the status list. Archive is an action in
 * the page's More actions menu, not a status to pick.
 */
export function WorkStatusSelect({
  value,
  onChange,
  className,
  variant,
}: {
  readonly value: WorkStatus;
  readonly onChange: (status: WorkStatus) => void;
  readonly className?: string;
  /** `ghost` is the quiet property row on a task page; `composer` a composer control. */
  readonly variant?: "ghost" | "composer";
}) {
  const { t } = useI18n();
  const label = useWorkStatusLabel();
  const Trigger = variant === "composer" ? ComposerSelectControl : SelectTrigger;

  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (isWorkStatus(next)) onChange(next);
      }}
    >
      <Trigger
        size="sm"
        variant={variant === "ghost" ? "ghost" : undefined}
        className={cn("w-auto min-w-0", className)}
        aria-label={t("Status")}
      >
        <SelectValue>
          <span className="flex items-center gap-1.5">
            <WorkStatusIcon status={value} />
            {label(value)}
          </span>
        </SelectValue>
      </Trigger>
      <SelectPopup alignItemWithTrigger={false}>
        {WORK_STATUS_CHOICES.map((status) => (
          <SelectItem key={status} hideIndicator value={status}>
            <span className="flex items-center gap-2">
              <WorkStatusIcon status={status} />
              {label(status)}
            </span>
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

/**
 * A task or project page's More actions menu. Archiving lives here rather than in the
 * status list; unarchiving puts the work back to Pending.
 */
export function WorkMoreActions({
  status,
  onStatusChange,
}: {
  readonly status: WorkStatus;
  readonly onStatusChange: (status: WorkStatus) => void;
}) {
  const { t } = useI18n();

  return (
    <Menu>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              render={
                <Button size="icon-sm" variant="ghost-muted" aria-label={t("More actions")}>
                  <RiMoreLine aria-hidden className="size-4" />
                </Button>
              }
            />
          }
        />
        <TooltipPopup side="bottom">{t("More actions")}</TooltipPopup>
      </Tooltip>
      <MenuPopup align="end">
        {status === "archived" ? (
          <MenuItem onClick={() => onStatusChange("pending")}>
            <RiInboxUnarchiveLine />
            {t("Unarchive")}
          </MenuItem>
        ) : (
          <MenuItem onClick={() => onStatusChange("archived")}>
            <RiArchiveLine />
            {t("Archive")}
          </MenuItem>
        )}
      </MenuPopup>
    </Menu>
  );
}
