import type { WorkStatus } from "@otto/contracts";
import {
  RiAddLine,
  RiArchiveLine,
  RiDeleteBinLine,
  RiInboxUnarchiveLine,
  RiMoreLine,
} from "@remixicon/react";
import { useMemo } from "react";

import { useI18n } from "../../i18n";
import { usePageActions, type PageAction } from "../../page-actions-registry";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Menu, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ComposerSelectControl } from "../chat/composer-control";
import { CopyMenuItems, useCopyPageActions } from "../copy-menu-items";
import type { PickerOpenState } from "../details-aside";
import { PageActionMenuItem } from "../page-action-menu-item";
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
  picker,
}: {
  readonly value: WorkStatus;
  readonly onChange: (status: WorkStatus) => void;
  readonly className?: string;
  /** `ghost` is the quiet property row on a task page; `composer` a composer control. */
  readonly variant?: "ghost" | "composer";
  readonly picker?: PickerOpenState;
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
      open={picker?.open}
      onOpenChange={picker?.onOpenChange}
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
      <SelectPopup alignItemWithTrigger={false} finalFocus={picker?.finalFocus}>
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

const NO_PROPERTIES: ReadonlyArray<PageAction> = [];

/**
 * A task or project page's More actions menu: New task on a project, Copy link and Copy ID, then
 * Archive. The same entries are the page's command palette group and its keys. Archiving lives
 * here rather than in the status list; unarchiving puts the work back to Pending.
 */
export function WorkMoreActions({
  label,
  path,
  id,
  status,
  onStatusChange,
  onNewTask,
  onDelete,
  properties = NO_PROPERTIES,
}: {
  /** The palette group title, such as This task. */
  readonly label: string;
  readonly path: string;
  readonly id: string;
  readonly status: WorkStatus;
  readonly onStatusChange: (status: WorkStatus) => void;
  readonly onNewTask?: () => void;
  /** Deletes the item for good, last in the menu and asking first; only tasks offer it. */
  readonly onDelete?: () => void;
  /** The page's property keys, which open its pickers; they join the palette, not this menu. */
  readonly properties?: ReadonlyArray<PageAction>;
}) {
  const { t } = useI18n();
  const copy = useCopyPageActions(path, id);
  const archive = useArchiveAction(status, onStatusChange);

  const newTask = useMemo(
    (): PageAction | null =>
      onNewTask
        ? {
            id: "new-task",
            title: t("New task"),
            icon: RiAddLine,
            searchTerms: ["new task", "create", "add", "todo"],
            shortcutCommand: "item.new",
            run: onNewTask,
          }
        : null,
    [onNewTask, t],
  );

  const remove = useMemo(
    (): PageAction | null =>
      onDelete
        ? {
            id: "delete",
            title: t("Delete"),
            icon: RiDeleteBinLine,
            searchTerms: ["delete", "remove"],
            run: onDelete,
          }
        : null,
    [onDelete, t],
  );

  const actions = useMemo(
    () => [
      ...(newTask ? [newTask] : []),
      ...properties,
      copy.link,
      copy.id,
      archive,
      ...(remove ? [remove] : []),
    ],
    [archive, copy, newTask, properties, remove],
  );

  usePageActions(label, actions);

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
        {newTask ? (
          <>
            <PageActionMenuItem action={newTask} />
            <MenuSeparator />
          </>
        ) : null}
        <CopyMenuItems actions={copy} />
        <MenuSeparator />
        <PageActionMenuItem action={archive} />
        {remove ? <PageActionMenuItem action={remove} variant="destructive" /> : null}
      </MenuPopup>
    </Menu>
  );
}

/** Archive, or Unarchive back to Pending, under E. */
function useArchiveAction(
  status: WorkStatus,
  onStatusChange: (status: WorkStatus) => void,
): PageAction {
  const { t } = useI18n();

  return useMemo(
    (): PageAction =>
      status === "archived"
        ? {
            id: "unarchive",
            title: t("Unarchive"),
            icon: RiInboxUnarchiveLine,
            searchTerms: ["unarchive", "restore"],
            shortcutCommand: "item.archive",
            run: () => onStatusChange("pending"),
          }
        : {
            id: "archive",
            title: t("Archive"),
            icon: RiArchiveLine,
            searchTerms: ["archive", "hide"],
            shortcutCommand: "item.archive",
            run: () => onStatusChange("archived"),
          },
    [onStatusChange, status, t],
  );
}

/**
 * Otto: The item keys of the task or project row J and K hold on Tasks or Projects: Copy link,
 * Copy ID and Archive, joined to the index page's own actions while the row is held.
 */
export function WorkRowActions({
  label,
  path,
  id,
  status,
  onStatusChange,
  pageActions,
}: {
  readonly label: string;
  readonly path: string;
  readonly id: string;
  readonly status: WorkStatus;
  readonly onStatusChange: (status: WorkStatus) => void;
  readonly pageActions: ReadonlyArray<PageAction>;
}) {
  const copy = useCopyPageActions(path, id);
  const archive = useArchiveAction(status, onStatusChange);

  const actions = useMemo(
    () => [...pageActions, copy.link, copy.id, archive],
    [archive, copy, pageActions],
  );

  usePageActions(label, actions);

  return null;
}
