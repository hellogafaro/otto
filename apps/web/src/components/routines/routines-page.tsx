import {
  type RoutineAdapterSchedule,
  routineFrequencyLabel,
  routineTimeLabel,
  toRoutinePanelItem,
} from "@otto/client-runtime/routines";
import {
  BotId,
  type EnvironmentId,
  ROUTINE_LIST_SORTS,
  ROUTINE_STATUSES,
  type Routine,
  type RoutineListResult,
  type RoutineListSort,
  RoutineListView,
  type RoutineThreadMode,
  type Visibility,
} from "@otto/contracts";
import { useAtomValue } from "@effect/atom-react";
import { RiAddLine, RiProgress4Line, RiRobot3Line, RiTimeLine } from "@remixicon/react";
import { useNavigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { AsyncResult } from "effect/unstable/reactivity";
import { useCallback, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { useCreateRequest } from "../../create-request-store";
import { useListPages } from "../../hooks/use-list-pages";
import { useI18n } from "../../i18n";
import { usePageActions, type PageAction } from "../../page-actions-registry";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { routineChangesAtom, routineEnvironment } from "../../state/routines";
import { environmentSnapshotAtom } from "../../state/shell";
import { useAtomCommand } from "../../state/use-atom-command";
import { useCopyPageActions } from "../copy-menu-items";
import { type ListFilter, ListFilterBar, ListFilterMenu, ListSortMenu } from "../list-toolbar";
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
import {
  NoMatches,
  WorkColumn,
  WorkEmpty,
  WorkHeaderAction,
  WorkPage,
  withField,
} from "../work/work-pages";
import { VisibilityComposerControl } from "../roster/visibility-composer-control";
import { RoutineChatControl } from "./routine-chat-options";
import { useRoutineDeleteAction } from "./routine-page";
import { ROUTINE_STATUS_ICON, routineStatus, useRoutineStatusLabel } from "./routine-status";
import { encodeRoutineSearch } from "./routines.logic";

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
        if (routine.trigger?.type === "app") {
          return <DataTableChip>{routine.trigger.title}</DataTableChip>;
        }

        const routineSchedule = schedule(routine);

        return (
          <>
            <DataTableChip>{routineFrequencyLabel(routineSchedule, i18n)}</DataTableChip>
            <DataTableChip>{routineTimeLabel(routineSchedule, i18n)}</DataTableChip>
          </>
        );
      },
    },
  ];
}

/** Each sort's natural order, the one a fresh list uses. */
const ROUTINE_SORT_ORDER: Record<RoutineListSort, "asc" | "desc"> = {
  status: "asc",
  next: "asc",
  updated: "desc",
  created: "desc",
  title: "asc",
};

const encodeRoutineView = Schema.encodeSync(Schema.fromJsonString(RoutineListView));

const nextRoutineCursor = (page: RoutineListResult) => page.nextCursor;

/**
 * Otto: Routines, the Tasks page pattern: one table grouped by status (Active, Draft, Paused, Failed),
 * each row the job with its bot's avatar after it, then two chips, how often and at what time (an app routine
 * has one chip, its app event, and sorts after scheduled ones by next run); a row opens the
 * routine's page. It is a bounded server list like Tasks: Filter (status, bot) and Sort live in the URL,
 * the server answers 100 routines a page, and the table loads the next page near the end.
 * New routine is a conversation: the prompt opens a fresh chat with the chosen bot, which sets
 * the routine up there for the user to approve.
 */
export function RoutinesPage({ view }: { readonly view: RoutineListView }) {
  const i18n = useI18n();
  const { t } = i18n;
  const navigate = useNavigate();
  const environmentId = usePrimaryEnvironmentId();
  // SAFETY: the empty environment ID is an inactive-query sentinel; the atom sends no request until an environment exists.
  const snapshot = useAtomValue(environmentSnapshotAtom(environmentId ?? ("" as never)));
  const bots = useRosterStore((state) => state.bots);
  const liveBots = useLiveBots();
  const listRoutines = useAtomCommand(routineEnvironment.list, { reportFailure: false });
  // SAFETY: the empty environment ID is an inactive sentinel, like the snapshot's above.
  const routineChanges = useAtomValue(routineChangesAtom(environmentId ?? ("" as never)));
  const [creating, setCreating] = useState(false);
  const openNewRoutine = useCallback(() => setCreating(true), []);
  const sort = view.sort ?? "status";

  const list = useListPages({
    view: `${environmentId}:${encodeRoutineView(view)}`,
    revision: routineChanges,
    getNextCursor: nextRoutineCursor,
    fetchPage: async (cursor) => {
      if (!environmentId) return null;

      const result = await listRoutines({
        environmentId,
        input: cursor === undefined ? view : { ...view, cursor },
      });

      return AsyncResult.isSuccess(result) ? result.value : null;
    },
  });

  const routines = list.pages.flatMap((page) => page.routines);
  const filtered = Object.keys(view).some((key) => key !== "sort" && key !== "order");

  const setView = (next: RoutineListView) =>
    void navigate({ to: "/routines", search: encodeRoutineSearch(next), replace: true });

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

  const statusLabel = useRoutineStatusLabel();

  const schedule = (routine: Routine) => toRoutinePanelItem(routine, [], []).schedule;

  const filters: ListFilter[] = [
    {
      id: "status",
      label: t("Status"),
      icon: <RiProgress4Line aria-hidden />,
      multiple: true,
      options: ROUTINE_STATUSES.map((status) => ({
        value: status,
        label: statusLabel(status),
        icon: <StatusIcon status={ROUTINE_STATUS_ICON[status]} />,
      })),
      selected: view.status ?? [],
      ...((view.status?.length ?? 0) > 1
        ? { selectedLabel: t("{count} statuses", { count: view.status?.length ?? 0 }) }
        : {}),
      onChange: (selected) =>
        setView(
          withField(
            view,
            "status",
            selected.length > 0
              ? ROUTINE_STATUSES.filter((status) => selected.includes(status))
              : undefined,
          ),
        ),
    },
    {
      id: "bot",
      label: t("Bot"),
      icon: <RiRobot3Line aria-hidden />,
      multiple: false,
      options: liveBots.map((bot) => ({
        value: bot.id,
        label: bot.name,
        icon: (
          <ParticipantAvatar
            participant={{ kind: "bot", botId: BotId.make(bot.id) }}
            bots={bots}
            className="size-4"
          />
        ),
      })),
      selected: view.bot ? [view.bot] : [],
      ...(view.bot !== undefined
        ? { selectedLabel: bots.find((bot) => bot.id === view.bot)?.name ?? view.bot }
        : {}),
      onChange: ([bot]) =>
        setView(withField(view, "bot", bot === undefined ? undefined : BotId.make(bot))),
    },
  ];

  const sortLabels: Record<RoutineListSort, string> = {
    status: t("Status"),
    next: t("Next run"),
    updated: t("Last updated"),
    created: t("Created"),
    title: t("Title"),
  };

  return (
    <WorkPage
      actions={
        routines.length > 0 || filtered ? (
          <>
            <ListFilterMenu filters={filters} />
            <ListSortMenu
              sort={{
                options: ROUTINE_LIST_SORTS.map((value) => ({ value, label: sortLabels[value] })),
                value: sort,
                order: view.order ?? ROUTINE_SORT_ORDER[sort],
                onChange: (nextSort, order) =>
                  setView(
                    withField(
                      withField(view, "sort", nextSort === "status" ? undefined : nextSort),
                      "order",
                      order === ROUTINE_SORT_ORDER[nextSort] ? undefined : order,
                    ),
                  ),
              }}
            />
            <WorkHeaderAction
              label={t("New routine")}
              icon={RiAddLine}
              onClick={() => setCreating(true)}
            />
          </>
        ) : null
      }
    >
      {!snapshot || (list.status === "loading" && routines.length === 0) ? (
        <WorkColumn title={t("Routines")}>
          <SkeletonTableRows label={t("Loading routines…")} />
        </WorkColumn>
      ) : !filtered && list.status !== "error" && routines.length === 0 ? (
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
          <div className="flex flex-col gap-3">
            <ListFilterBar
              filters={filters}
              onClear={() =>
                setView({
                  ...(view.sort === undefined ? {} : { sort: view.sort }),
                  ...(view.order === undefined ? {} : { order: view.order }),
                })
              }
            />
            {list.status === "error" && routines.length === 0 ? (
              <p className="text-13px text-muted-foreground">{t("Routines couldn't be loaded.")}</p>
            ) : routines.length === 0 ? (
              <NoMatches to="/routines" />
            ) : (
              <DataTable
                rows={routines}
                columns={routineColumns({ i18n, bots, schedule })}
                getRowKey={(routine) => routine.id}
                getRowLabel={(routine) => `${routine.job}, ${statusLabel(routineStatus(routine))}`}
                onRowClick={openRoutine}
                highlightedKey={highlighted?.id ?? null}
                paging={{
                  hasMore: list.hasMore,
                  loading: list.status !== "ready",
                  onLoadMore: list.loadMore,
                }}
                {...(sort === "status"
                  ? {
                      groupBy: {
                        groups: ROUTINE_STATUSES.map((status) => ({
                          id: status,
                          label: statusLabel(status),
                          icon: <StatusIcon status={ROUTINE_STATUS_ICON[status]} />,
                        })),
                        getGroupId: routineStatus,
                        getGroupCount: (status: string) =>
                          list.pages.at(-1)?.statusCounts.find((entry) => entry.status === status)
                            ?.count ?? 0,
                      },
                    }
                  : {})}
              />
            )}
          </div>
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

  const submit = (prompt: string, files: readonly File[]) => {
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
        files,
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
      attachable
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
