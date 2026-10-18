import {
  type RoutineAdapterSchedule,
  routineFrequencyLabel,
  toRoutinePanelItem,
} from "@otto/client-runtime/routines";
import {
  BotId,
  type EnvironmentId,
  type Routine,
  type RoutineThreadMode,
  type Visibility,
} from "@otto/contracts";
import { useAtomValue } from "@effect/atom-react";
import { RiAddLine, RiTimeLine } from "@remixicon/react";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { useCreateRequest } from "../../create-request-store";
import { useI18n } from "../../i18n";
import { usePageActions, type PageAction } from "../../page-actions-registry";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { environmentSnapshotAtom } from "../../state/shell";
import { useCopyPageActions } from "../copy-menu-items";
import { PromptDialog } from "../prompt-dialog";
import { BotPicker } from "../roster/bot-picker";
import { useStartChat } from "../roster/chat-navigation";
import { ProjectComposerControl, useProjectChoice } from "../roster/project-composer-control";
import { useRosterStore } from "../roster/roster-store";
import type { Bot } from "../roster/types";
import { StatusIcon } from "../status-icon";
import { Button } from "../ui/button";
import { DataTable, DataTableChip, type DataTableColumn } from "../ui/data-table";
import { SkeletonTableRows } from "../ui/skeleton";
import { useRowHighlight } from "../use-row-highlight";
import { ParticipantAvatar } from "../work/work-participants";
import { WorkColumn, WorkEmpty, WorkHeaderAction, WorkPage } from "../work/work-pages";
import { VisibilityComposerControl } from "../roster/visibility-composer-control";
import { RoutineChatControl } from "./routine-chat-options";
import { useRoutineDeleteAction } from "./routine-page";
import { ROUTINE_STATUS_ICON, routineStatus, type RoutineStatus } from "./routine-status";

function routineColumns({
  i18n,
  bots,
  schedule,
}: {
  readonly i18n: ReturnType<typeof useI18n>;
  readonly bots: readonly Bot[];
  readonly schedule: (routine: Routine) => RoutineAdapterSchedule;
}): DataTableColumn<Routine>[] {
  return [
    {
      id: "title",
      type: "title",
      cell: (routine) => routine.job,
      after: (routine) => (
        <ParticipantAvatar
          participant={{ kind: "bot", botId: BotId.make(routine.botId) }}
          bots={bots}
        />
      ),
    },
    {
      id: "schedule",
      type: "chips",
      cell: (routine) => {
        const routineSchedule = schedule(routine);
        const { frequency, time } = routineSchedule;

        return (
          <>
            <DataTableChip>{routineFrequencyLabel(routineSchedule, i18n)}</DataTableChip>
            <DataTableChip>{frequency === "hourly" ? `:${time.slice(3, 5)}` : time}</DataTableChip>
          </>
        );
      },
    },
  ];
}

/**
 * Otto: Routines, the Tasks page pattern: one table grouped by status (Active, Paused, Failed),
 * each row the job with its bot's avatar after it, then two chips, how often and at what time; a row opens the
 * routine's page.
 * New routine is a conversation: the prompt opens a fresh chat with the chosen bot, which sets
 * the routine up there for the user to approve.
 */
export function RoutinesPage() {
  const i18n = useI18n();
  const { t } = i18n;
  const navigate = useNavigate();
  const environmentId = usePrimaryEnvironmentId();
  // SAFETY: the empty environment ID is an inactive-query sentinel; the atom sends no request until an environment exists.
  const snapshot = useAtomValue(environmentSnapshotAtom(environmentId ?? ("" as never)));
  const bots = useRosterStore((state) => state.bots);
  const [creating, setCreating] = useState(false);
  const routines = (snapshot?.routines ?? []).filter((routine) => routine.lifecycle !== "deleted");
  const openNewRoutine = useCallback(() => setCreating(true), []);

  const openRoutine = useCallback(
    (routine: Routine) =>
      void navigate({ to: "/routines/$routineId", params: { routineId: routine.id } }),
    [navigate],
  );

  const highlighted = useRowHighlight(routines, (routine) => routine.id, openRoutine);

  useCreateRequest("routine", Boolean(snapshot), openNewRoutine);

  const pageActions = useMemo(
    (): PageAction[] => [
      {
        id: "new-routine",
        title: t("New routine"),
        icon: RiAddLine,
        searchTerms: ["new routine", "create", "schedule", "automation"],
        shortcutCommand: "item.new",
        run: openNewRoutine,
      },
    ],
    [openNewRoutine, t],
  );

  usePageActions(t("Routines"), pageActions);

  const statusLabel: Record<RoutineStatus, string> = {
    active: t("Active"),
    paused: t("Paused"),
    failed: t("Failed"),
  };

  const schedule = (routine: Routine) =>
    toRoutinePanelItem(
      routine,
      snapshot?.routineRuns ?? [],
      snapshot?.skillAssignments ?? [],
      snapshot?.mcpServers ?? [],
    ).schedule;

  return (
    <WorkPage
      actions={
        routines.length > 0 ? (
          <WorkHeaderAction
            label={t("New routine")}
            icon={RiAddLine}
            onClick={() => setCreating(true)}
          />
        ) : null
      }
    >
      {!snapshot ? (
        <WorkColumn title={t("Routines")}>
          <SkeletonTableRows label={t("Loading routines…")} />
        </WorkColumn>
      ) : routines.length === 0 ? (
        <WorkEmpty
          icon={<RiTimeLine />}
          title={t("Put recurring work on autopilot")}
          description={t(
            "Ask any bot for a morning briefing, a weekly report, or a regular check, and it runs on time without you.",
          )}
          action={
            <Button onClick={() => setCreating(true)}>
              <RiAddLine />
              {t("New routine")}
            </Button>
          }
        />
      ) : (
        <WorkColumn title={t("Routines")}>
          <DataTable
            rows={routines}
            columns={routineColumns({ i18n, bots, schedule })}
            getRowKey={(routine) => routine.id}
            getRowLabel={(routine) => `${routine.job}, ${statusLabel[routineStatus(routine)]}`}
            onRowClick={openRoutine}
            highlightedKey={highlighted?.id ?? null}
            groupBy={{
              groups: (["active", "paused", "failed"] as const).map((status) => ({
                id: status,
                label: statusLabel[status],
                icon: <StatusIcon status={ROUTINE_STATUS_ICON[status]} />,
              })),
              getGroupId: routineStatus,
            }}
          />
        </WorkColumn>
      )}
      {environmentId && highlighted ? (
        <RoutineRowActions
          key={highlighted.id}
          environmentId={environmentId}
          routine={highlighted}
          pageActions={pageActions}
        />
      ) : null}
      <NewRoutineDialog open={creating} onOpenChange={setCreating} />
    </WorkPage>
  );
}

/** Otto: The held routine row's item keys, Copy link, Copy ID and Delete, beside New routine. */
function RoutineRowActions({
  environmentId,
  routine,
  pageActions,
}: {
  readonly environmentId: EnvironmentId;
  readonly routine: Routine;
  readonly pageActions: ReadonlyArray<PageAction>;
}) {
  const copy = useCopyPageActions(`/routines/${routine.id}`, routine.id);
  const deleteRoutine = useRoutineDeleteAction(environmentId, routine);

  const actions = useMemo(
    () => [...pageActions, copy.link, copy.id, deleteRoutine],
    [copy, deleteRoutine, pageActions],
  );

  usePageActions(routine.job, actions);

  return null;
}

/**
 * Otto: New routine, the New chat composer: an optional title (left empty, the bot names
 * it), what should run and when, then the bot, the project and the chat it posts in. The
 * request goes to the bot in that chat, which answers with its review card.
 */
function NewRoutineDialog({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const startChat = useStartChat();
  const bots = useLiveBots();
  const { t } = useI18n();
  const [botId, setBotId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [threadMode, setThreadMode] = useState<RoutineThreadMode>("target");
  const [visibility, setVisibility] = useState<Visibility>("user");
  const projectChoice = useProjectChoice();
  const { project } = projectChoice;
  const chosen = bots.find((bot) => bot.id === botId)?.id ?? bots[0]?.id ?? null;

  const close = () => {
    setTitle("");
    setThreadMode("target");
    setVisibility("user");
    onOpenChange(false);
  };

  const submit = (prompt: string) => {
    if (chosen === null) return;
    const named = title.trim();

    const request = [
      named
        ? t("Set up a routine called \u201c{title}\u201d: {prompt}", { title: named, prompt })
        : t("Set up a routine: {prompt}", { prompt }),
      ...(threadMode === "per-run" ? [t("Start a new chat for every run.")] : []),
      ...(threadMode === "single"
        ? [t("Start one new chat for this routine and post every run there.")]
        : []),
    ].join(" ");

    close();

    void startChat(
      { kind: "bot", id: chosen },
      {
        prompt: request,
        visibility,
        ...(project ? { projectId: project.id } : {}),
        ...(named ? { title: named } : {}),
      },
    );
  };

  return (
    <PromptDialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      title={t("New routine")}
      titleInput={{ value: title, onChange: setTitle, label: t("Routine title") }}
      placeholder={t("What should run, and when?")}
      pickers={
        <>
          <BotPicker bots={bots} value={chosen} onChange={setBotId} />
          <ProjectComposerControl choice={projectChoice} />
          <RoutineChatControl value={threadMode} onChange={setThreadMode} />
          <VisibilityComposerControl value={visibility} onChange={setVisibility} />
        </>
      }
      submitLabel={t("Start")}
      canSubmit={chosen !== null && project !== null}
      onSubmit={submit}
    />
  );
}

function useLiveBots() {
  const { bots, pinnedItems } = useRosterStore(
    useShallow((state) => ({ bots: state.bots, pinnedItems: state.pinnedItems })),
  );

  return useMemo(() => {
    const live = bots.filter((bot) => bot.archivedAt === null);
    // Pinned bots lead, in pin order; everything else keeps roster order.
    const pinnedIds = pinnedItems.flatMap((item) => (item.kind === "bot" ? [item.id] : []));

    return [
      ...pinnedIds.flatMap((id) => live.filter((bot) => bot.id === id)),
      ...live.filter((bot) => !pinnedIds.includes(bot.id)),
    ];
  }, [bots, pinnedItems]);
}
