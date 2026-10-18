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
import { useMemo, useState } from "react";

import { requestConfirmDialog } from "../../confirm-dialog";
import { useI18n } from "../../i18n";
import { usePageActions, type PageAction } from "../../page-actions-registry";
import { randomUUID } from "../../lib/utils";
import { hasTag } from "../../lib/tagged-union";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { routineEnvironment } from "../../state/routines";
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

/**
 * Otto: A routine's own page, the task/project pattern: its title (edited in place; a
 * cleared title is generated again from the instructions) and instructions in the main
 * column, then its run history; bot, chat, project, schedule, status and run times in the
 * details sidebar. Instructions and schedule change through the bot: Edit asks for one,
 * then opens the routine's chat with the request sent, and the bot answers with a review card.
 */
export function RoutinePage({ routineId }: { readonly routineId: RoutineId }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const back = { label: t("Routines"), onBack: () => void navigate({ to: "/routines" }) };
  const environmentId = usePrimaryEnvironmentId();
  // SAFETY: the empty environment ID is an inactive-query sentinel; the atom sends no request until an environment exists.
  const snapshot = useAtomValue(environmentSnapshotAtom(environmentId ?? ("" as never)));

  const routine = snapshot?.routines?.find(
    (candidate) => candidate.id === routineId && candidate.lifecycle !== "deleted",
  );

  if (!snapshot) return <WorkPage back={back}>{null}</WorkPage>;

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

  const item = toRoutinePanelItem(
    routine,
    snapshot.routineRuns ?? [],
    snapshot.skillAssignments ?? [],
    snapshot.mcpServers ?? [],
  );

  return (
    <RoutineDetail
      environmentId={environmentId}
      routine={routine}
      item={item}
      back={back}
      currentPersonId={snapshot.currentPersonId ?? null}
    />
  );
}

const act = async (result: Promise<{ readonly _tag: string }>, failure: string) => {
  if (!hasTag(await result, "Success")) toast.error(failure);
};

const createdAt = () => new Date().toISOString();

function RoutineDetail({
  environmentId,
  routine,
  item,
  back,
  currentPersonId,
}: {
  readonly environmentId: EnvironmentId;
  readonly currentPersonId: string | null;
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
  const remove = useAtomCommand(routineEnvironment.delete, { reportFailure: false });
  const update = useAtomCommand(routineEnvironment.update, { reportFailure: false });

  const { projects } = useWorkData();
  const copy = useCopyPageActions(`/routines/${routine.id}`, routine.id);
  const { open: openPicker, props: picker } = useWorkPickers<"project" | "visibility">("routine");

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

  const openChat = (threadId: string = routine.targetThreadId) =>
    void navigate({ to: "/chats/$threadId", params: { threadId } });

  const routineIdValue = RoutineId.make(routine.id);

  const runNow = useMemo(
    (): PageAction => ({
      id: "run-now",
      title: t("Run now"),
      icon: RiPlayLine,
      searchTerms: ["run now", "start", "trigger"],
      disabled: running,
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
    [environmentId, routine.id, run, running, t],
  );

  const pauseOrResume = useMemo(
    (): PageAction =>
      routine.enabled
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
    [enable, environmentId, pause, routine.enabled, routine.id, t],
  );

  const deleteRoutine = useMemo(
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
      pauseOrResume,
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
                    disabled={running}
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
                <PageActionMenuItem action={pauseOrResume} />
                <MenuSeparator />
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
              <span className="flex items-center gap-1.5 px-2.5 text-sm">
                <StatusIcon status={status.icon} />
                {status.label}
              </span>
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
