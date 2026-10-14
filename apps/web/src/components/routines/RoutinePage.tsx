import {
  absoluteRunTime,
  routineScheduleLabel,
  toRoutinePanelItem,
  type RoutineAdapterItem,
} from "@otto/client-runtime/routines";
import { RoutineId, RoutineRunId, type EnvironmentId, type Routine } from "@otto/contracts";
import { useAtomValue } from "@effect/atom-react";
import {
  RiDeleteBinLine,
  RiMoreLine,
  RiPauseCircleLine,
  RiPencilLine,
  RiPlayCircleLine,
  RiPlayLine,
  RiTimeLine,
} from "@remixicon/react";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { requestConfirmDialog } from "../../confirmDialog";
import { useI18n } from "../../i18n";
import { randomUUID } from "../../lib/utils";
import { hasTag } from "../../lib/taggedUnion";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { routineEnvironment } from "../../state/routines";
import { environmentSnapshotAtom } from "../../state/shell";
import { useAtomCommand } from "../../state/use-atom-command";
import { DetailsRow } from "../DetailsAside";
import { PromptDialog } from "../PromptDialog";
import { BotAvatarView } from "../roster/BotAvatarView";
import { useRosterStore } from "../roster/rosterStore";
import { StatusIcon, type StatusKind } from "../StatusIcon";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { WorkDetailPage } from "../work/WorkDetail";
import { RoutineHistory } from "./RoutineHistory";
import { WorkEmpty, WorkPage } from "../work/WorkPages";

/**
 * Otto: A routine's own page, the task/project pattern read-only: its name and
 * instructions in the main column, then its run history; bot, schedule, status and
 * run times in the details sidebar. The bot owns every change: Edit asks for one, then
 * opens the routine's chat with the request sent, and the bot answers with a review card.
 */
export function RoutinePage({ routineId }: { readonly routineId: RoutineId }) {
  const { t } = useI18n();
  const environmentId = usePrimaryEnvironmentId();
  // SAFETY: the empty environment ID is an inactive-query sentinel; the atom sends no request until an environment exists.
  const snapshot = useAtomValue(environmentSnapshotAtom(environmentId ?? ("" as never)));

  const routine = snapshot?.routines?.find(
    (candidate) => candidate.id === routineId && candidate.lifecycle !== "deleted",
  );

  if (!snapshot) return <WorkPage>{null}</WorkPage>;

  if (!routine || environmentId === null) {
    return (
      <WorkPage>
        <WorkEmpty
          icon={<RiTimeLine />}
          title={t("Routine not found")}
          description={t("It may have been deleted, or the link points to another workspace.")}
        />
      </WorkPage>
    );
  }

  const item = toRoutinePanelItem(
    routine,
    snapshot.routineRuns ?? [],
    snapshot.skillAssignments ?? [],
    snapshot.mcpServers ?? [],
  );

  return <RoutineDetail environmentId={environmentId} routine={routine} item={item} />;
}

function RoutineDetail({
  environmentId,
  routine,
  item,
}: {
  readonly environmentId: EnvironmentId;
  readonly routine: Routine;
  readonly item: RoutineAdapterItem;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const navigate = useNavigate();
  const [changing, setChanging] = useState(false);
  const bot = useRosterStore((state) => state.bots.find((entry) => entry.id === routine.botId));
  const pause = useAtomCommand(routineEnvironment.pause, { reportFailure: false });
  const enable = useAtomCommand(routineEnvironment.enable, { reportFailure: false });
  const run = useAtomCommand(routineEnvironment.run, { reportFailure: false });
  const remove = useAtomCommand(routineEnvironment.delete, { reportFailure: false });

  const running = item.latestRun?.status === "running";
  const failed = routine.lifecycle === "failed" || routine.lifecycle === "blocked";

  const status: { readonly icon: StatusKind; readonly label: string } = running
    ? { icon: "in_progress", label: t("Running") }
    : failed
      ? { icon: "error", label: t("Failed") }
      : routine.enabled
        ? { icon: "pending", label: t("Active") }
        : { icon: "paused", label: t("Paused") };

  const botName = bot?.name ?? t("Unknown bot");

  const openChat = () => {
    useRosterStore
      .getState()
      .openBotChat(
        routine.botId,
        routine.targetThreadId,
        `/${environmentId}/${routine.targetThreadId}`,
      );

    void navigate({ to: "/bots/$botId", params: { botId: routine.botId } });
  };

  const act = async (result: Promise<{ readonly _tag: string }>, failure: string) => {
    if (!hasTag(await result, "Success")) toastManager.add({ type: "error", title: failure });
  };

  const createdAt = () => new Date().toISOString();
  const routineIdValue = RoutineId.make(routine.id);

  return (
    <>
      <WorkDetailPage
        type="routine"
        title={routine.job}
        description={routine.procedure}
        actions={
          <>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon"
                    variant="ghost-muted"
                    aria-label={t("Edit")}
                    onClick={() => setChanging(true)}
                  >
                    <RiPencilLine aria-hidden className="size-4" />
                  </Button>
                }
              />
              <TooltipPopup side="bottom">{t("Edit")}</TooltipPopup>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon"
                    variant="ghost-muted"
                    aria-label={t("Run now")}
                    disabled={running}
                    onClick={() =>
                      void act(
                        run({
                          environmentId,
                          input: {
                            routineId: routineIdValue,
                            runId: RoutineRunId.make(randomUUID()),
                            trigger: "manual",
                            createdAt: createdAt(),
                          },
                        }),
                        t("Could not start routine"),
                      )
                    }
                  >
                    <RiPlayLine aria-hidden className="size-4" />
                  </Button>
                }
              />
              <TooltipPopup side="bottom">{t("Run now")}</TooltipPopup>
            </Tooltip>
            <Menu>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <MenuTrigger
                      render={
                        <Button size="icon" variant="ghost-muted" aria-label={t("More actions")}>
                          <RiMoreLine aria-hidden className="size-4" />
                        </Button>
                      }
                    />
                  }
                />
                <TooltipPopup side="bottom">{t("More actions")}</TooltipPopup>
              </Tooltip>
              <MenuPopup align="end">
                {routine.enabled ? (
                  <MenuItem
                    onClick={() =>
                      void act(
                        pause({
                          environmentId,
                          input: {
                            routineId: routineIdValue,
                            reason: "Paused by the user.",
                            createdAt: createdAt(),
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
                      void act(
                        enable({
                          environmentId,
                          input: { routineId: routineIdValue, createdAt: createdAt() },
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
                    await act(
                      remove({
                        environmentId,
                        input: { routineId: routineIdValue, createdAt: createdAt() },
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
          </>
        }
        sections={[
          {
            key: "history",
            content: <RoutineHistory runs={item.runHistory} onOpenRun={openChat} />,
          },
        ]}
        aside={
          <div className="flex flex-col">
            <DetailsRow label={t("Status")}>
              <span className="flex items-center gap-1.5 px-2.5 text-sm">
                <StatusIcon status={status.icon} />
                {status.label}
              </span>
            </DetailsRow>
            <DetailsRow label={t("Bot")}>
              <Button size="sm" variant="ghost" onClick={openChat}>
                {bot ? (
                  <BotAvatarView avatar={bot.avatar} name={bot.name} className="size-4" />
                ) : null}
                {botName}
              </Button>
            </DetailsRow>
            <DetailsRow label={t("Schedule")}>
              <span className="px-2.5 text-end text-sm">
                {routineScheduleLabel(item.schedule, i18n)}
              </span>
            </DetailsRow>
            <DetailsRow label={t("Next run")}>
              <span className="px-2.5 text-sm tabular-nums">
                {routine.enabled && routine.nextRunAt
                  ? absoluteRunTime(routine.nextRunAt, i18n)
                  : t("Not scheduled")}
              </span>
            </DetailsRow>
            <DetailsRow label={t("Last run")}>
              <span className="px-2.5 text-sm tabular-nums">
                {routine.lastRunAt ? absoluteRunTime(routine.lastRunAt, i18n) : t("Never")}
              </span>
            </DetailsRow>
          </div>
        }
      />
      <PromptDialog
        open={changing}
        onOpenChange={setChanging}
        title={t("Edit {name}", { name: routine.job })}
        placeholder={t("What should change? For example, run at 8:00 instead.")}
        submitLabel={t("Ask {name}", { name: botName })}
        onSubmit={(prompt) => {
          useRosterStore.getState().requestPrompt({
            botId: routine.botId,
            threadId: routine.targetThreadId,
            text: t("Change the routine \u201c{name}\u201d: {prompt}", {
              name: routine.job,
              prompt,
            }),
          });

          setChanging(false);
          openChat();
        }}
      />
    </>
  );
}
