import { RoutineId, type EnvironmentId, type Routine } from "@otto/contracts";
import { RiDeleteBinLine, RiMoreLine, RiPauseCircleLine, RiPlayCircleLine } from "@remixicon/react";
import { useNavigate } from "@tanstack/react-router";

import { requestConfirmDialog } from "../../confirmDialog";
import { useClientSettings } from "../../hooks/useSettings";
import { useI18n } from "../../i18n";
import { cn } from "../../lib/utils";
import { hasTag } from "../../lib/taggedUnion";
import { routineEnvironment } from "../../state/routines";
import { useAtomCommand } from "../../state/use-atom-command";
import { BotAvatarView } from "../roster/BotAvatarView";
import { formatRosterTimestamp } from "../roster/roster.logic";
import {
  ROSTER_NAME_CLASS,
  ROSTER_TIME_CLASS,
  ROSTER_TRAIL_ACTIONS_CLASS,
  ROSTER_TRAIL_CLASS,
  ROSTER_TRAIL_INFO_CLASS,
} from "../roster/rosterRowClasses";
import type { Bot } from "../roster/types";
import { AppIcon } from "../ui/app-icon";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { StatusIcon } from "../StatusIcon";

/**
 * Otto: One routine in the Routines panel, shaped like a chat row: the bot's
 * 16px avatar, the job, and at the right its status icon (running, paused or
 * error) and next run. It opens the routine's page, where the bot changes it; hovering swaps the time for an actions menu that can still pause, resume
 * or delete it when the bot can't answer.
 */
export function RoutineRow({
  environmentId,
  routine,
  bot,
  active,
  running,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly routine: Routine;
  readonly bot: Bot | undefined;
  readonly active: boolean;
  /** A run is going right now. */
  readonly running: boolean;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const timestampFormat = useClientSettings((s) => s.timestampFormat);
  const pause = useAtomCommand(routineEnvironment.pause, { reportFailure: false });
  const enable = useAtomCommand(routineEnvironment.enable, { reportFailure: false });
  const remove = useAtomCommand(routineEnvironment.delete, { reportFailure: false });
  const failed = routine.lifecycle === "failed" || routine.lifecycle === "blocked";

  const time = routine.nextRunAt ? formatRosterTimestamp(routine.nextRunAt, timestampFormat) : null;

  const status = failed
    ? t("Failed")
    : !routine.enabled
      ? t("Paused")
      : time
        ? t("Next {time}", { time })
        : t("Not scheduled");

  const icon = running
    ? ({ status: "working", label: t("Running") } as const)
    : failed
      ? ({ status: "error", label: t("Failed") } as const)
      : !routine.enabled
        ? ({ status: "paused", label: t("Paused") } as const)
        : null;

  const run = async (
    action: (input: { environmentId: EnvironmentId }) => Promise<{ readonly _tag: string }>,
    failure: string,
  ) => {
    if (!environmentId) return;

    const result = await action({ environmentId });

    if (!hasTag(result, "Success")) toastManager.add({ type: "error", title: failure });
  };

  const routineId = RoutineId.make(routine.id);

  return (
    <li
      className={cn(
        "group/row relative list-none rounded-md",
        active ? "sidebar-row-current" : "sidebar-row-plain hover:sidebar-row-hovered",
      )}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-current={active || undefined}
              onClick={() =>
                void navigate({ to: "/routines/$routineId", params: { routineId: routine.id } })
              }
              className={cn(
                "flex h-7 w-full cursor-pointer items-center gap-2 rounded-md ps-1.5 pe-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
            >
              {bot ? (
                <BotAvatarView avatar={bot.avatar} name={bot.name} className="size-4" />
              ) : null}
              <span
                className={cn(
                  ROSTER_NAME_CLASS,
                  active && "text-sidebar-foreground dark:text-sidebar-foreground",
                )}
              >
                {routine.job}
              </span>
            </button>
          }
        />
        <TooltipPopup side="right">{`${bot?.name ?? t("Unknown bot")} · ${status}`}</TooltipPopup>
      </Tooltip>
      <span className={ROSTER_TRAIL_CLASS}>
        <span className={ROSTER_TRAIL_INFO_CLASS}>
          {icon ? <StatusIcon status={icon.status} label={icon.label} /> : null}
          {routine.enabled && !failed && time ? (
            <span className={ROSTER_TIME_CLASS}>{time}</span>
          ) : null}
        </span>
        <span className={ROSTER_TRAIL_ACTIONS_CLASS}>
          <Menu>
            <MenuTrigger
              render={
                <Button
                  size="icon-row"
                  variant="sidebar-ghost"
                  aria-label={t("Actions for {name}", { name: routine.job })}
                >
                  <AppIcon icon={RiMoreLine} className="size-3.5" />
                </Button>
              }
            />
            <MenuPopup align="end">
              {routine.enabled ? (
                <MenuItem
                  onClick={() =>
                    void run(
                      ({ environmentId }) =>
                        pause({
                          environmentId,
                          input: {
                            routineId,
                            reason: "Paused by the user.",
                            createdAt: new Date().toISOString(),
                          },
                        }),
                      t("Could not pause routine"),
                    )
                  }
                >
                  <RiPauseCircleLine />
                  {t("Pause")}
                </MenuItem>
              ) : (
                <MenuItem
                  onClick={() =>
                    void run(
                      ({ environmentId }) =>
                        enable({
                          environmentId,
                          input: { routineId, createdAt: new Date().toISOString() },
                        }),
                      t("Could not resume routine"),
                    )
                  }
                >
                  <RiPlayCircleLine />
                  {t("Resume")}
                </MenuItem>
              )}
              <MenuSeparator />
              <MenuItem
                variant="destructive"
                onClick={async () => {
                  const confirmed =
                    (await requestConfirmDialog(
                      t("Delete {name}?\nIt stops running. Its chat and past runs stay.", {
                        name: routine.job,
                      }),
                      { variant: "destructive", confirmLabel: t("Delete") },
                    )) ?? false;

                  if (!confirmed) return;
                  await run(
                    ({ environmentId }) =>
                      remove({
                        environmentId,
                        input: { routineId, createdAt: new Date().toISOString() },
                      }),
                    t("Could not delete routine"),
                  );
                }}
              >
                <RiDeleteBinLine />
                {t("Delete")}
              </MenuItem>
            </MenuPopup>
          </Menu>
        </span>
      </span>
    </li>
  );
}
