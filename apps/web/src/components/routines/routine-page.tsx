import {
  absoluteRunTime,
  routineScheduleLabel,
  toRoutinePanelItem,
  type RoutineAdapterItem,
} from "@otto/client-runtime/routines";
import {
  RoutineId,
  RoutineRunId,
  type EnvironmentId,
  type ProjectId,
  type Routine,
  type RoutineSchedule,
  type RoutineThreadMode,
  type Visibility,
} from "@otto/contracts";
import { useAtomValue } from "@effect/atom-react";
import {
  RiBox3Line,
  RiChat1Line,
  RiDeleteBinLine,
  RiGlobalLine,
  RiMoreLine,
  RiPauseCircleLine,
  RiPencilLine,
  RiPlayCircleLine,
  RiPlayLine,
  RiTimeLine,
} from "@remixicon/react";
import { useNavigate } from "@tanstack/react-router";
import { AsyncResult } from "effect/unstable/reactivity";
import { useEffect, useMemo, useState } from "react";

import { requestConfirmDialog } from "../../confirm-dialog";
import { useI18n } from "../../i18n";
import { usePageActions, type PageAction } from "../../page-actions-registry";
import { randomUUID } from "../../lib/utils";
import { hasTag } from "../../lib/tagged-union";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { routineCacheAtom, routineChangesAtom, routineEnvironment } from "../../state/routines";
import { serverEnvironment } from "../../state/server";
import { environmentSnapshotAtom } from "../../state/shell";
import { useAtomCommand } from "../../state/use-atom-command";
import { CopyMenuItems, useCopyPageActions } from "../copy-menu-items";
import { DetailsRow } from "../details-aside";
import { LibraryVisibilitySelect } from "../library/library-actions";
import { PageActionMenuItem } from "../page-action-menu-item";
import { PromptDialog } from "../prompt-dialog";
import { BotAvatarView } from "../roster/bot-avatar-view";
import { useRosterStore } from "../roster/roster-store";
import { StatusIcon, type StatusKind } from "../status-icon";
import { Button } from "../ui/button";
import { Menu, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { toast } from "sonner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { projectStatus } from "../work/work.logic";
import { WorkDetailPage, useWorkPickers } from "../work/work-detail";
import { ProjectSelect } from "../work/work-dialogs";
import { WorkEmpty, WorkPage, useWorkData } from "../work/work-pages";
import { RoutineChatSelect } from "./routine-chat-options";
import { RoutineHistory } from "./routine-history";
import { RoutineScheduleEdit } from "./routine-schedule";
import { ROUTINE_STATUS_ICON, routineStatus, useRoutineStatusLabel } from "./routine-status";

/**
 * Otto: A routine's own page, the task/project pattern: its title (edited in place; a
 * cleared title is generated again from the instructions) and instructions in the main
 * column, then its run history; bot, chat, project, schedule, status and run times in the
 * details sidebar, where the schedule is edited in place. Instructions change through the bot:
 * Edit asks for one, then opens the routine's chat with the request sent, and the bot answers
 * with a review card.
 */
export function RoutinePage({ routineId }: { readonly routineId: RoutineId }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const back = { label: t("Routines"), onBack: () => void navigate({ to: "/routines" }) };
  const environmentId = usePrimaryEnvironmentId();
  // SAFETY: the empty environment ID is an inactive-query sentinel; the atom sends no request until an environment exists.
  const snapshot = useAtomValue(environmentSnapshotAtom(environmentId ?? ("" as never)));
  // SAFETY: the empty environment ID is an inactive sentinel, like the snapshot's above.
  const cache = useAtomValue(routineCacheAtom(environmentId ?? ("" as never)));
  // SAFETY: the same inactive sentinel; its counter stays at zero.
  const routineChanges = useAtomValue(routineChangesAtom(environmentId ?? ("" as never)));
  const getRoutine = useAtomCommand(routineEnvironment.get, { reportFailure: false });
  const [missingId, setMissingId] = useState<RoutineId | null>(null);
  const cached = cache.routines.get(routineId);
  const routine = cached?.lifecycle === "deleted" ? undefined : cached;
  const uncached = cached === undefined;

  // Otto: The routine comes from the cache, filled by lists and live events; on a miss it is
  // read from the server once the live snapshot has arrived, and a routine the server won't
  // show reads as not found.
  const connected = routineChanges > 0;
  useEffect(() => {
    if (environmentId === null || !connected || !uncached) return;
    let current = true;

    void getRoutine({ environmentId, input: { routineId } }).then((result) => {
      if (current && !(AsyncResult.isSuccess(result) && result.value !== null)) {
        setMissingId(routineId);
      }
    });

    return () => {
      current = false;
    };
  }, [connected, environmentId, getRoutine, routineId, uncached]);

  const history = useEnvironmentQuery(
    environmentId === null
      ? null
      : serverEnvironment.routineRuns({ environmentId, input: { routineId } }),
  );

  if (!snapshot || (!routine && environmentId !== null && missingId !== routineId && uncached)) {
    return <WorkPage back={back}>{null}</WorkPage>;
  }

  if (!routine || environmentId === null) {
    return (
      <WorkPage back={back}>
        <WorkEmpty
          icon={<RiTimeLine />}
          title={t("Routine not found")}
          description={t("It may have been deleted, or the link points to another workspace.")}
        />
      </WorkPage>
    );
  }

  // Otto: The routine cache carries the runs the stream sent live; the rest come from the
  // routine's full history. A running run whose chat waits on someone's approval or answer
  // shows as waiting for approval, not as running.
  const liveRuns = [...cache.runs.values()].filter((run) => run.routineId === routine.id);

  const waitingChats = new Set(
    snapshot.threads
      .filter((thread) => thread.hasPendingApprovals || thread.hasPendingUserInput)
      .map((thread) => thread.id),
  );

  const item = toRoutinePanelItem(
    routine,
    [
      ...liveRuns,
      ...(history.data?.runs ?? []).filter((run) => !liveRuns.some((live) => live.id === run.id)),
    ].map((run) =>
      run.status === "running" && run.threadRef !== null && waitingChats.has(run.threadRef)
        ? { ...run, status: "waiting-for-approval" as const }
        : run,
    ),
    snapshot.mcpServers ?? [],
  );

  return (
    <RoutineDetail
      environmentId={environmentId}
      routine={routine}
      item={item}
      back={back}
      currentPersonId={snapshot.currentPersonId ?? null}
      originalChatAvailable={snapshot.threads.some(
        (thread) =>
          thread.id === routine.targetThreadId &&
          thread.archivedAt === null &&
          thread.botId === routine.botId,
      )}
    />
  );
}

const act = async (result: Promise<{ readonly _tag: string }>, failure: string) => {
  if (!hasTag(await result, "Success")) toast.error(failure);
};

const createdAt = () => new Date().toISOString();

/** Delete under ⌘⌫, after a confirm; the routine's chat and past runs stay. */
export function useRoutineDeleteAction(
  environmentId: EnvironmentId,
  routine: Pick<Routine, "id" | "job">,
): PageAction {
  const { t } = useI18n();
  const remove = useAtomCommand(routineEnvironment.delete, { reportFailure: false });

  return useMemo(
    (): PageAction => ({
      id: "delete",
      title: t("Delete"),
      icon: RiDeleteBinLine,
      searchTerms: ["delete", "remove"],
      shortcutCommand: "item.delete",
      run: async () => {
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
            input: { routineId: RoutineId.make(routine.id), createdAt: createdAt() },
          }),
          t("Routine couldn't be deleted"),
        );
      },
    }),
    [environmentId, remove, routine.id, routine.job, t],
  );
}

function RoutineDetail({
  environmentId,
  routine,
  item,
  back,
  currentPersonId,
  originalChatAvailable,
}: {
  readonly environmentId: EnvironmentId;
  readonly currentPersonId: string | null;
  readonly originalChatAvailable: boolean;
  readonly routine: Routine;
  readonly item: RoutineAdapterItem;
  readonly back: { readonly label: string; readonly onBack: () => void };
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const navigate = useNavigate();
  const [changing, setChanging] = useState(false);
  const bot = useRosterStore((state) => state.bots.find((entry) => entry.id === routine.botId));
  const pause = useAtomCommand(routineEnvironment.pause, { reportFailure: false });
  const enable = useAtomCommand(routineEnvironment.enable, { reportFailure: false });
  const run = useAtomCommand(routineEnvironment.run, { reportFailure: false });
  const update = useAtomCommand(routineEnvironment.update, { reportFailure: false });

  const { projects } = useWorkData();
  const copy = useCopyPageActions(`/routines/${routine.id}`, routine.id);
  const { open: openPicker, props: picker } = useWorkPickers<"project" | "visibility">("routine");

  const waiting = item.latestRun?.status === "waiting-for-approval";
  const running = waiting || item.latestRun?.status === "running";
  const statusLabel = useRoutineStatusLabel();
  const routineState = routineStatus(routine);

  const status: { readonly icon: StatusKind; readonly label: string } = waiting
    ? { icon: "waiting", label: t("Waiting for approval") }
    : running
      ? { icon: "in_progress", label: t("Running") }
      : { icon: ROUTINE_STATUS_ICON[routineState], label: statusLabel(routineState) };

  const botName = bot?.name ?? t("Unknown bot");

  const openChat = (threadId: string = routine.targetThreadId) =>
    void navigate({ to: "/chats/$threadId", params: { threadId } });

  const routineIdValue = RoutineId.make(routine.id);

  const runNow = useMemo(
    (): PageAction => ({
      id: "run-now",
      title: t("Run now"),
      icon: RiPlayLine,
      searchTerms: ["run now", "start", "trigger"],
      disabled: running || routineState === "draft",
      run: () =>
        act(
          run({
            environmentId,
            input: {
              routineId: RoutineId.make(routine.id),
              runId: RoutineRunId.make(randomUUID()),
              trigger: "manual",
              createdAt: createdAt(),
            },
          }),
          t("Routine couldn't be started"),
        ),
    }),
    [environmentId, routine.id, routineState, run, running, t],
  );

  const pauseOrResume = useMemo(
    (): PageAction | null =>
      routineState === "draft"
        ? null
        : routine.enabled
          ? {
              id: "pause",
              title: t("Pause"),
              icon: RiPauseCircleLine,
              searchTerms: ["pause", "stop", "disable", "status"],
              shortcutCommand: "property.status",
              run: () =>
                act(
                  pause({
                    environmentId,
                    input: {
                      routineId: RoutineId.make(routine.id),
                      reason: "Paused by the user.",
                      createdAt: createdAt(),
                    },
                  }),
                  t("Routine couldn't be paused"),
                ),
            }
          : {
              id: "resume",
              title: t("Resume"),
              icon: RiPlayCircleLine,
              searchTerms: ["resume", "enable", "start", "status"],
              shortcutCommand: "property.status",
              run: () =>
                act(
                  enable({
                    environmentId,
                    input: { routineId: RoutineId.make(routine.id), createdAt: createdAt() },
                  }),
                  t("Routine couldn't be resumed"),
                ),
            },
    [enable, environmentId, pause, routine.enabled, routine.id, routineState, t],
  );

  const deleteRoutine = useRoutineDeleteAction(environmentId, routine);

  const projectEditable = routine.threadMode !== "target";
  const visibilityEditable = routine.createdBy != null && routine.createdBy === currentPersonId;

  const pageActions = useMemo(
    (): PageAction[] => [
      {
        id: "edit",
        title: t("Edit"),
        icon: RiPencilLine,
        searchTerms: ["edit", "change", "instructions", "schedule"],
        run: () => setChanging(true),
      },
      runNow,
      ...(pauseOrResume ? [pauseOrResume] : []),
      {
        id: "open-chat",
        title: t("Open chat"),
        icon: RiChat1Line,
        searchTerms: ["open chat", "bot"],
        shortcutCommand: "property.bot",
        run: () =>
          void navigate({ to: "/chats/$threadId", params: { threadId: routine.targetThreadId } }),
      },
      ...(projectEditable
        ? [
            {
              id: "project",
              title: t("Project"),
              icon: RiBox3Line,
              searchTerms: ["project"],
              shortcutCommand: "property.project",
              run: () => openPicker("project"),
            } satisfies PageAction,
          ]
        : []),
      ...(visibilityEditable
        ? [
            {
              id: "visibility",
              title: t("Visibility"),
              icon: RiGlobalLine,
              searchTerms: ["visibility", "share", "private"],
              shortcutCommand: "property.visibility",
              run: () => openPicker("visibility"),
            } satisfies PageAction,
          ]
        : []),
      copy.link,
      copy.id,
      deleteRoutine,
    ],
    [
      copy,
      deleteRoutine,
      navigate,
      openPicker,
      pauseOrResume,
      projectEditable,
      routine.targetThreadId,
      runNow,
      t,
      visibilityEditable,
    ],
  );

  usePageActions(t("This routine"), pageActions);

  const save = (fields: {
    readonly job?: string;
    readonly regenerateTitle?: true;
    readonly threadMode?: RoutineThreadMode;
    readonly projectId?: ProjectId;
    readonly visibility?: Visibility;
    readonly schedule?: RoutineSchedule;
    readonly timezone?: string;
  }) =>
    act(
      update({
        environmentId,
        input: { routineId: routineIdValue, ...fields, createdAt: createdAt() },
      }),
      t("Routine couldn't be updated"),
    );

  return (
    <>
      <WorkDetailPage
        type="routine"
        back={back}
        title={routine.job}
        onTitleSave={(job) => void save({ job })}
        onTitleClear={() => void save({ regenerateTitle: true })}
        description={routine.procedure}
        actions={
          <>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-sm"
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
                    size="icon-sm"
                    variant="ghost-muted"
                    aria-label={t("Run now")}
                    disabled={runNow.disabled}
                    onClick={() => void runNow.run()}
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
                {pauseOrResume ? (
                  <>
                    <PageActionMenuItem action={pauseOrResume} />
                    <MenuSeparator />
                  </>
                ) : null}
                <CopyMenuItems actions={copy} />
                <MenuSeparator />
                <PageActionMenuItem action={deleteRoutine} variant="destructive" />
              </MenuPopup>
            </Menu>
          </>
        }
        sections={[
          {
            key: "history",
            content: (
              <RoutineHistory
                runs={item.runHistory}
                onOpenRun={(entry) => openChat(entry.threadId ?? undefined)}
              />
            ),
          },
        ]}
        aside={
          <div className="flex flex-col">
            <DetailsRow label={t("Status")}>
              {waiting ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => openChat(item.latestRun?.threadId ?? undefined)}
                >
                  <StatusIcon status={status.icon} />
                  {status.label}
                </Button>
              ) : (
                <span className="flex items-center gap-1.5 px-2.5 text-sm">
                  <StatusIcon status={status.icon} />
                  {status.label}
                </span>
              )}
            </DetailsRow>
            <DetailsRow label={t("Bot")}>
              <Button size="sm" variant="ghost" onClick={() => openChat()}>
                {bot ? (
                  <BotAvatarView avatar={bot.avatar} name={bot.name} className="size-4" />
                ) : null}
                {botName}
              </Button>
            </DetailsRow>
            <DetailsRow label={t("Chat")}>
              <RoutineChatSelect
                value={routine.threadMode}
                onChange={(threadMode) => void save({ threadMode })}
                originalChatAvailable={originalChatAvailable}
              />
            </DetailsRow>
            <DetailsRow label={t("Project")}>
              {projectEditable ? (
                <ProjectSelect
                  variant="ghost"
                  value={routine.projectId}
                  onChange={(projectId) => void save({ projectId })}
                  picker={picker("project")}
                  projects={projects.filter(
                    (project) =>
                      project.id === routine.projectId || projectStatus(project) !== "archived",
                  )}
                />
              ) : (
                <span className="truncate px-2.5 text-sm text-foreground">
                  {projects.find((project) => project.id === routine.projectId)?.title ?? ""}
                </span>
              )}
            </DetailsRow>
            <DetailsRow label={t("Visibility")}>
              <LibraryVisibilitySelect
                value={routine.visibility}
                editable={visibilityEditable}
                onChange={(visibility) => void save({ visibility })}
                picker={picker("visibility")}
              />
            </DetailsRow>
            <DetailsRow label={t("Schedule")}>
              <RoutineScheduleEdit
                schedule={routine.schedule}
                timezone={routine.timezone}
                label={routineScheduleLabel(item.schedule, i18n)}
                onSave={(next) => void save(next)}
              />
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
