"use client";

import {
  RiArchiveLine,
  RiBookShelfLine,
  RiBox3Line,
  RiChat1Line,
  RiChatNewLine,
  RiFileAddLine,
  RiFolderAddLine,
  RiHomeLine,
  RiInbox2Line,
  RiRobot2Line,
  RiBarChartLine,
  RiImageLine,
  RiListCheck3,
  RiTimeLine,
  RiTranslate2,
  RiDiscussLine,
  RiMoonLine,
  RiShapesLine,
  RiSettings3Line,
  RiSunLine,
  type RemixiconComponentType,
} from "@remixicon/react";
import type { NavigationKeybindingCommand } from "@otto/contracts";
import { GENERAL_PROJECT_ID, WORK_STATUSES } from "@otto/contracts";
import { Match, Predicate } from "effect";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";

import { useTheme } from "../hooks/use-theme";
import { isPreviewFocused } from "../lib/preview-focus";
import { activeComposerModelPicker } from "../composer-model-picker-registry";
import { useI18n } from "../i18n";
import { activePageActions } from "../page-actions-registry";
import { requestCreate, type CreateKind } from "../create-request-store";
import { NAVIGATION_PATHS } from "./global-shortcuts";
import {
  buildPageCommandPaletteItems,
  buildChatSearchCommandPaletteItems,
  buildEnvironmentOwnerNames,
  buildLanguageCommandPaletteAction,
  buildModelPickerCommandPaletteAction,
  COMMAND_PALETTE_SEARCH_GROUP_LIMIT,
  COMMAND_PALETTE_TAB_LIMIT,
  filterCommandPaletteGroups,
  ITEM_ICON_CLASS,
  normalizeSearchText,
  type CommandPaletteActionItem,
  type CommandPaletteChat,
  type CommandPaletteGroup,
} from "./command-palette.logic";
import { CommandPaletteContent } from "./command-palette-content";
import { CommandPaletteResults } from "./command-palette-results";
import { useCommandPaletteStore } from "~/command-palette-bus";
import { DetailsTabs } from "./details-aside";
import { openSettings } from "~/settings-dialog-store";
import { openCustomize } from "~/customize-navigation";
import { primaryServerKeybindingsAtom } from "../state/server";
import { allEnvironmentRostersAtom } from "../state/bots";
import { useThreadShells } from "../state/entities";
import { environmentSnapshotAtom } from "../state/shell";
import { useMyTasksSearch, useTaskPages } from "../state/tasks";
import { useEnvironments, usePrimaryEnvironmentId } from "../state/environments";
import { useThreadSearch } from "../state/queries";
import { findLatestGroupThreadIds, latestGroupThreadKey } from "./roster/bot-thread-runtime.logic";
import { useRosterStore } from "./roster/roster-store";
import { BotAvatarView } from "./roster/bot-avatar-view";
import { PersonAvatar } from "./roster/person-avatar";
import { useLibraryPages } from "./library/use-library";
import { LIBRARY_TYPE_ICONS } from "./library/library-visuals";
import { WorkStatusIcon } from "./work/work-status";
import { projectStatus } from "./work/work.logic";
import { StatusIcon } from "./status-icon";
import { ROUTINE_STATUS_ICON, routineStatus } from "./routines/routine-status";
import { useRoutineSearch } from "./routines/use-routine-search";
import { resolveShortcutCommand } from "../keybindings";
import { CommandDialog, CommandDialogPopup } from "./ui/command";
import { toast } from "sonner";

const COMMAND_PALETTE_TABS = [
  "all",
  "chats",
  "bots",
  "people",
  "tasks",
  "projects",
  "routines",
  "library",
  "actions",
] as const;

type CommandPaletteTab = (typeof COMMAND_PALETTE_TABS)[number];

export function CommandPalette({ children }: { children: ReactNode }) {
  const open = useCommandPaletteStore((state) => state.open);
  const setOpen = useCommandPaletteStore((state) => state.setOpen);
  const toggle = useCommandPaletteStore((state) => state.toggle);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented) return;

      // Resolve with the focus context so customized bindings using a
      // documented `when` condition (e.g. previewFocus) still work.
      const command = resolveShortcutCommand(event, keybindings, {
        context: {
          previewFocus: isPreviewFocused(),
        },
      });

      if (command !== "commandPalette.toggle") return;
      event.preventDefault();
      event.stopPropagation();
      toggle();
    };

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [keybindings, toggle]);

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      {children}
      <CommandPaletteDialog setOpen={setOpen} />
    </CommandDialog>
  );
}

function CommandPaletteDialog(props: { readonly setOpen: (open: boolean) => void }) {
  const { t } = useI18n();

  return (
    <CommandDialogPopup
      aria-label={t("Command palette")}
      variant="palette"
      className="overflow-hidden"
      data-command-palette="true"
      data-testid="command-palette"
      finalFocus={false}
      onBackdropPointerDown={() => {
        props.setOpen(false);
      }}
    >
      <OpenCommandPaletteDialog setOpen={props.setOpen} />
    </CommandDialogPopup>
  );
}

function OpenCommandPaletteDialog(props: { readonly setOpen: (open: boolean) => void }) {
  const { setOpen } = props;
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<CommandPaletteTab>("all");
  const [highlightedItemValue, setHighlightedItemValue] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const { resolvedTheme, setAppearanceMode } = useTheme();

  // Names the mode you would switch to, so the row reads as a verb.
  const nextAppearance = resolvedTheme === "dark" ? "light" : "dark";

  const appearanceTitle =
    nextAppearance === "dark" ? t("Switch to dark mode") : t("Switch to light mode");

  const actionItems: CommandPaletteActionItem[] = [
    {
      value: "action:toggle-appearance",
      searchTerms: [appearanceTitle, "theme", "appearance", "dark", "light", "mode", "toggle"],
      title: appearanceTitle,
      icon:
        nextAppearance === "dark" ? (
          <RiMoonLine className={ITEM_ICON_CLASS} />
        ) : (
          <RiSunLine className={ITEM_ICON_CLASS} />
        ),
      run: async () => {
        setAppearanceMode(nextAppearance);
      },
    },
    buildModelPickerCommandPaletteAction({
      composerHandle: activeComposerModelPicker(),
      scheduleAfterClose: (openModelPicker) => {
        window.requestAnimationFrame(openModelPicker);
      },
      title: t("Change model"),
      icon: <RiRobot2Line className={ITEM_ICON_CLASS} />,
    }),
    {
      value: "action:customize",
      searchTerms: [
        t("Open Customize"),
        "customize",
        "plugins",
        "apps",
        "mcp",
        "skills",
        "composio",
      ],
      title: t("Open Customize"),
      icon: <RiShapesLine className={ITEM_ICON_CLASS} />,
      run: async () => {
        openCustomize();
      },
    },
    {
      value: "action:usage",
      searchTerms: [t("Open usage"), "usage", "limits", "quota", "plan", "subscription"],
      title: t("Open usage"),
      icon: <RiBarChartLine className={ITEM_ICON_CLASS} />,
      run: async () => {
        openSettings("usage");
      },
    },
    {
      value: "action:image-generation-settings",
      searchTerms: [
        t("Image generation settings"),
        "image generation",
        "images",
        "pictures",
        "chatgpt",
        "grok",
        "settings",
      ],
      title: t("Image generation settings"),
      icon: <RiImageLine className={ITEM_ICON_CLASS} />,
      run: async () => {
        openSettings("images");
      },
    },
    buildLanguageCommandPaletteAction({
      translate: t,
      openSettings,
      icon: <RiTranslate2 className={ITEM_ICON_CLASS} />,
    }),
    {
      value: "action:archived-chats",
      searchTerms: [
        t("Archived chats"),
        t("Archived bots"),
        "archived",
        "archive",
        "unarchive",
        "restore",
        "chats",
        "bots",
      ],
      title: t("Archived"),
      icon: <RiArchiveLine className={ITEM_ICON_CLASS} />,
      run: async () => {
        openSettings("archived");
      },
    },
    {
      value: "action:settings",
      searchTerms: [t("Open settings"), "settings", "preferences", "configuration", "keybindings"],
      title: t("Open settings"),
      icon: <RiSettings3Line className={ITEM_ICON_CLASS} />,
      run: async () => {
        openSettings();
      },
    },
  ];

  // Read once per open: the palette mounts fresh each time it opens.
  const [pageGroup] = useState(() => {
    const page = activePageActions();

    return {
      value: "page",
      label: page.label,
      items: buildPageCommandPaletteItems({
        actions: page.actions,
        renderIcon: (action) => {
          const Icon = action.icon ?? RiDiscussLine;

          return <Icon className={ITEM_ICON_CLASS} />;
        },
      }),
    };
  });

  const createItems = useCreateItems();
  const goToItems = useGoToItems();

  const groups: CommandPaletteGroup[] = [
    ...(pageGroup.items.length > 0 ? [pageGroup] : []),
    { value: "create", label: t("Create"), items: createItems },
    { value: "go-to", label: t("Go to"), items: goToItems },
    { value: "actions", label: t("Actions"), items: actionItems },
  ];

  // Rows follow the query the input shows, so Enter never runs a row from an
  // earlier query. Message search debounces its own RPC.
  const limit = tab === "all" ? COMMAND_PALETTE_SEARCH_GROUP_LIMIT : COMMAND_PALETTE_TAB_LIMIT;
  const chatSearch = useChatSearchItems(query, limit);
  const searchQuery = query.startsWith(">") ? "" : query;

  const libraryGroup = useLibrarySearchGroup(
    searchQuery,
    tab === "library" || (tab === "all" && normalizeSearchText(searchQuery).length > 0),
    limit,
  );

  const workspaceGroups = [...useWorkspaceSearchGroups(searchQuery, tab), libraryGroup];
  const actionGroups = filterCommandPaletteGroups({ groups, query });

  const chatGroups =
    chatSearch.items.length > 0
      ? [{ value: "chats", label: t("Chats"), items: chatSearch.items }]
      : [];

  const workspaceResults = filterCommandPaletteGroups({
    groups: workspaceGroups.filter((group) => tab === "all" || group.value === tab),
    query: searchQuery,
    limit,
  });

  // All lists actions until something is typed; a category lists its newest items until then.
  const filteredGroups = Match.value(tab).pipe(
    Match.when("all", () => [
      ...actionGroups,
      ...(normalizeSearchText(searchQuery).length > 0 ? [...chatGroups, ...workspaceResults] : []),
    ]),
    Match.when("actions", () => actionGroups),
    Match.when("chats", () => chatGroups),
    Match.orElse(() => workspaceResults),
  );

  const tabLabels: Record<CommandPaletteTab, string> = {
    all: t("All"),
    chats: t("Chats"),
    bots: t("Bots"),
    people: t("People"),
    tasks: t("Tasks"),
    projects: t("Projects"),
    routines: t("Routines"),
    library: t("Library"),
    actions: t("Actions"),
  };

  function changeTab(next: CommandPaletteTab): void {
    setHighlightedItemValue(null);
    setTab(next);
  }

  // ← and → switch categories once the caret cannot move further that way.
  function onInputKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    const input = event.currentTarget;

    const step = Match.value(event.key).pipe(
      Match.when("ArrowLeft", () => -1),
      Match.when("ArrowRight", () => 1),
      Match.orElse(() => 0),
    );

    if (step === 0 || input.selectionStart !== input.selectionEnd) return;

    if (step === -1 ? input.selectionStart !== 0 : input.selectionEnd !== input.value.length) {
      return;
    }

    const next = COMMAND_PALETTE_TABS[COMMAND_PALETTE_TABS.indexOf(tab) + step];

    if (next === undefined) return;
    event.preventDefault();
    changeTab(next);
  }

  // The list highlights its first row again after the query changes without reporting it.
  const activeItemValue =
    highlightedItemValue ??
    filteredGroups.flatMap((group) => group.items).find((item) => !item.disabled)?.value ??
    null;

  function executeItem(item: CommandPaletteActionItem): void {
    if (item.disabled) return;
    setOpen(false);
    void item.run().catch(() => {
      toast.error(t("Command couldn't be run"));
    });
  }

  return (
    <CommandPaletteContent
      aria-label={t("Command palette")}
      autoHighlight="always"
      footerActionLabel={t("Select")}
      inputProps={{
        placeholder: t("Search chats, tasks, files and more..."),
        ref: inputRef,
        onKeyDown: onInputKeyDown,
      }}
      mode="none"
      onItemHighlighted={(value) => {
        setHighlightedItemValue(Predicate.isString(value) ? value : null);
      }}
      onValueChange={(nextQuery: string) => {
        setHighlightedItemValue(null);
        setQuery(nextQuery);
      }}
      tabs={
        <DetailsTabs
          label={t("Search categories")}
          tabs={COMMAND_PALETTE_TABS.map((value) => ({ value, label: tabLabels[value] }))}
          value={tab}
          onValueChange={(next) => {
            changeTab(next);
            inputRef.current?.focus();
          }}
        />
      }
      value={query}
    >
      <CommandPaletteResults
        groups={filteredGroups}
        highlightedItemValue={activeItemValue}
        keybindings={keybindings}
        onExecuteItem={executeItem}
        emptyStateMessage={t("No results")}
        loadingLabel={
          chatSearch.isPending && (tab === "all" || tab === "chats") ? t("Searching chats…") : null
        }
      />
    </CommandPaletteContent>
  );
}

/**
 * Otto: Something new from anywhere: a chat opens the New chat dialog; anything else goes to its
 * page, unless already there, which opens its own New flow.
 */
function useCreateItems(): CommandPaletteActionItem[] {
  const { t } = useI18n();
  const navigate = useNavigate();
  const myTasks = useMyTasksSearch();

  const create = (
    kind: CreateKind,
    to: "/tasks" | "/projects" | "/routines" | "/library",
    title: string,
    Icon: RemixiconComponentType,
  ): CommandPaletteActionItem => ({
    value: `create:${kind}`,
    searchTerms: [title, "new", "create", "add", kind],
    title,
    icon: <Icon className={ITEM_ICON_CLASS} />,
    run: async () => {
      requestCreate(kind);

      if (window.location.pathname !== to) {
        await navigate(to === "/tasks" ? { to, search: myTasks } : { to });
      }
    },
  });

  return [
    {
      value: "create:chat",
      searchTerms: [t("New chat"), "new", "create", "chat", "message", "dm", "group"],
      title: t("New chat"),
      icon: <RiChatNewLine className={ITEM_ICON_CLASS} />,
      run: async () => {
        useRosterStore.getState().openNewChat({});
      },
    },
    create("task", "/tasks", t("New task"), RiListCheck3),
    create("project", "/projects", t("New project"), RiBox3Line),
    create("routine", "/routines", t("New routine"), RiTimeLine),
    create("document", "/library", t("New document"), RiFileAddLine),
    create("folder", "/library", t("New folder"), RiFolderAddLine),
  ];
}

const GO_TO_PLACES: ReadonlyArray<readonly [NavigationKeybindingCommand, RemixiconComponentType]> =
  [
    ["navigation.home", RiHomeLine],
    ["navigation.notifications", RiInbox2Line],
    ["navigation.chats", RiChat1Line],
    ["navigation.routines", RiTimeLine],
    ["navigation.tasks", RiListCheck3],
    ["navigation.projects", RiBox3Line],
    ["navigation.library", RiBookShelfLine],
  ];

/** Otto: The rail's places in rail order, each with its ⌥ key. */
function useGoToItems(): CommandPaletteActionItem[] {
  const { t } = useI18n();
  const navigate = useNavigate();
  const myTasks = useMyTasksSearch();

  const titles: Record<NavigationKeybindingCommand, string> = {
    "navigation.home": t("Home"),
    "navigation.notifications": t("Notifications"),
    "navigation.chats": t("Chats"),
    "navigation.routines": t("Routines"),
    "navigation.tasks": t("Tasks"),
    "navigation.projects": t("Projects"),
    "navigation.library": t("Library"),
  };

  return GO_TO_PLACES.map(([place, Icon]) => ({
    value: `go-to:${place}`,
    searchTerms: [titles[place], "go to", "open", "navigate"],
    title: titles[place],
    icon: <Icon className={ITEM_ICON_CLASS} />,
    shortcutCommand: place,
    run: async () => {
      const to = NAVIGATION_PATHS[place];

      await navigate(to === "/tasks" ? { to, search: myTasks } : { to });
    },
  }));
}

/**
 * Everything else the palette finds by name, newest first within each group: live bots, people,
 * tasks, projects and routines of the primary environment. The server already left
 * out what this person can't see. Tasks are asked of the server only once something is typed or
 * the Tasks tab is open.
 */
function useWorkspaceSearchGroups(query: string, tab: CommandPaletteTab): CommandPaletteGroup[] {
  const { t } = useI18n();
  const navigate = useNavigate();
  const environmentId = usePrimaryEnvironmentId();
  // SAFETY: the empty environment ID is an inactive-query sentinel; the atom sends no request until an environment exists.
  const snapshot = useAtomValue(environmentSnapshotAtom(environmentId ?? ("" as never)));
  const bots = useRosterStore((state) => state.bots);
  const taskSearch = normalizeSearchText(query).slice(0, 300).trim();

  const taskList = useTaskPages(
    environmentId,
    taskSearch === "" && tab !== "tasks"
      ? null
      : {
          status: WORK_STATUSES,
          sort: "updated",
          ...(taskSearch === "" ? { limit: COMMAND_PALETTE_TAB_LIMIT } : { search: taskSearch }),
        },
  );

  const newestFirst = <A extends { readonly updatedAt: string }>(items: ReadonlyArray<A>) =>
    items.toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));

  const projectTitles = new Map(
    (snapshot?.projects ?? []).map((project) => [
      project.id,
      project.id === GENERAL_PROJECT_ID ? t("No project") : project.title,
    ]),
  );

  const botNames = new Map(bots.map((bot) => [bot.id, bot.name]));
  const routines = useRoutineSearch(query);

  return [
    {
      value: "bots",
      label: t("Bots"),
      items: newestFirst(bots.filter((bot) => bot.archivedAt === null)).map((bot) => ({
        value: `bot:${bot.id}`,
        searchTerms: [bot.name, bot.title, bot.label ?? ""],
        title: bot.name,
        description: bot.title,
        icon: <BotAvatarView avatar={bot.avatar} name={bot.name} className="size-4" />,
        run: async () => {
          await navigate({ to: "/bots/$botId", params: { botId: bot.id } });
        },
      })),
    },
    {
      value: "people",
      label: t("People"),
      items: (snapshot?.people ?? []).map((person) => ({
        value: `person:${person.personId}`,
        searchTerms: [person.displayName, person.email ?? ""],
        title: person.displayName,
        ...(person.email ? { description: person.email } : {}),
        icon: (
          <PersonAvatar
            name={person.displayName}
            personId={person.personId}
            className="size-4 text-7px"
          />
        ),
        run: async () => {
          await navigate({
            to: "/settings/$section",
            params: { section: "members" },
            search: { q: person.email ?? person.displayName },
          });
        },
      })),
    },
    {
      value: "tasks",
      label: t("Tasks"),
      items: (taskList.pages[0]?.tasks ?? []).map((task) => ({
        value: `task:${task.id}`,
        searchTerms: [task.title, task.description],
        title: task.title,
        ...(projectTitles.has(task.projectId)
          ? { description: projectTitles.get(task.projectId) }
          : {}),
        icon: <WorkStatusIcon status={task.status} className="size-4" />,
        run: async () => {
          await navigate({ to: "/tasks/$taskId", params: { taskId: task.id } });
        },
      })),
    },
    {
      value: "projects",
      label: t("Projects"),
      items: newestFirst(
        (snapshot?.projects ?? []).filter((project) => project.id !== GENERAL_PROJECT_ID),
      ).map((project) => ({
        value: `project:${project.id}`,
        searchTerms: [project.title, project.description ?? ""],
        title: project.title,
        icon: <WorkStatusIcon status={projectStatus(project)} className="size-4" />,
        run: async () => {
          await navigate({ to: "/projects/$projectId", params: { projectId: project.id } });
        },
      })),
    },
    {
      value: "routines",
      label: t("Routines"),
      items: newestFirst(routines.filter((routine) => routine.lifecycle !== "deleted")).map(
        (routine) => ({
          value: `routine:${routine.id}`,
          searchTerms: [routine.job, botNames.get(routine.botId) ?? ""],
          title: routine.job,
          ...(botNames.has(routine.botId) ? { description: botNames.get(routine.botId) } : {}),
          icon: (
            <StatusIcon status={ROUTINE_STATUS_ICON[routineStatus(routine)]} className="size-4" />
          ),
          run: async () => {
            await navigate({ to: "/routines/$routineId", params: { routineId: routine.id } });
          },
        }),
      ),
    },
  ];
}

/**
 * The palette's Library group: the newest files whose titles contain the query, or the newest
 * files before anything is typed, each with the folder it sits in.
 */
function useLibrarySearchGroup(
  query: string,
  enabled: boolean,
  limit: number,
): CommandPaletteGroup {
  const { t } = useI18n();
  const navigate = useNavigate();
  const environmentId = usePrimaryEnvironmentId();
  const title = query.trim().slice(0, 200);

  const { files, pages } = useLibraryPages(enabled ? environmentId : null, {
    everywhere: true,
    type: ["document", "image", "file"],
    ...(title ? { title } : {}),
    limit,
  });

  const folderTitles = new Map(
    pages.flatMap((page) => page.folders).map((folder) => [folder.id, folder.title]),
  );

  return {
    value: "library",
    label: t("Library"),
    items: files.map((file) => {
      const Icon = LIBRARY_TYPE_ICONS[file.type];
      const folderTitle = file.folderId ? folderTitles.get(file.folderId) : undefined;

      return {
        value: `file:${file.id}`,
        searchTerms: [file.title],
        title: file.title,
        description: folderTitle ?? t("Library"),
        icon: <Icon className={ITEM_ICON_CLASS} />,
        run: async () => {
          await (file.type === "document"
            ? navigate({ to: "/library/$fileId", params: { fileId: file.id } })
            : navigate({
                to: "/library",
                search: {
                  ...(file.folderId ? { folder: file.folderId } : {}),
                  preview: file.id,
                },
              }));
        },
      };
    }),
  };
}

/**
 * The palette's Chats group for a typed query: chat titles from the loaded
 * shells plus message matches from every connected environment. Bot chats open
 * in the bot's view; a group opens its chat. Chats outside the environment this
 * client shows are listed but cannot be opened here.
 */
function useChatSearchItems(query: string, limit: number) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const shells = useThreadShells();
  const bots = useRosterStore((state) => state.bots);
  const groups = useRosterStore((state) => state.groups);
  const rosters = useAtomValue(allEnvironmentRostersAtom);
  const searchQuery = query.startsWith(">") ? "" : query;

  const connectedEnvironmentIds = useMemo(
    () =>
      environments.flatMap((environment) =>
        environment.connection.phase === "connected" ? [environment.environmentId] : [],
      ),
    [environments],
  );

  const search = useThreadSearch(connectedEnvironmentIds, searchQuery);

  const chats = useMemo((): CommandPaletteChat[] => {
    const connected = new Set<string>(connectedEnvironmentIds);

    const labelById = new Map<string, string>(
      environments.map((environment) => [environment.environmentId, environment.label] as const),
    );

    const botById = new Map(bots.map((bot) => [bot.id, bot] as const));
    const groupById = new Map(groups.map((group) => [group.id, group] as const));
    const latestGroupThreadIds = findLatestGroupThreadIds(shells);
    const ownerNameIn = buildEnvironmentOwnerNames(rosters);

    return shells.flatMap((shell): CommandPaletteChat[] => {
      if (
        shell.archivedAt !== null ||
        shell.parentThreadId != null ||
        !connected.has(shell.environmentId)
      ) {
        return [];
      }

      const base = {
        environmentId: shell.environmentId,
        threadId: shell.id,
        title: shell.title,
        updatedAt: shell.updatedAt,
      };

      if (shell.environmentId !== primaryEnvironmentId) {
        if (shell.botId == null && shell.groupId == null) return [];

        return [
          {
            ...base,
            ownerName: ownerNameIn(shell.environmentId, shell),
            unavailableIn: labelById.get(shell.environmentId) ?? shell.environmentId,
          },
        ];
      }

      const bot = shell.botId ? botById.get(shell.botId) : undefined;

      if (bot && bot.archivedAt === null) {
        return [{ ...base, ownerName: bot.name, unavailableIn: null }];
      }

      // A group shows only its newest chat, so older group chats cannot be opened.
      const group = shell.groupId ? groupById.get(shell.groupId) : undefined;

      if (
        group &&
        latestGroupThreadIds.get(latestGroupThreadKey(shell.environmentId, group.id)) === shell.id
      ) {
        return [{ ...base, ownerName: group.name, unavailableIn: null }];
      }

      return [];
    });
  }, [bots, connectedEnvironmentIds, environments, groups, primaryEnvironmentId, rosters, shells]);

  const items = buildChatSearchCommandPaletteItems({
    query,
    chats,
    matches: search.matches,
    untitledLabel: t("Untitled chat"),
    unavailableLabel: (environment) => t("In {environment}", { environment }),
    icon: <RiDiscussLine className={ITEM_ICON_CLASS} />,
    openChat: async (chat) => {
      await navigate({ to: "/chats/$threadId", params: { threadId: chat.threadId } });
    },
    limit,
  });

  return { items, isPending: search.isPending };
}
