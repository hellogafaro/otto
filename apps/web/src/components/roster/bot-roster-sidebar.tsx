import { Match, Predicate } from "effect";
import { useAtomValue } from "@effect/atom-react";
import { ARCHIVED_BOT_RETENTION_DAYS, BotId } from "@otto/contracts";
import { useNavigate } from "@tanstack/react-router";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { openCommandPalette } from "../../command-palette-bus";
import { useI18n } from "../../i18n";
import {
  isInputFocus,
  resolveShortcutCommand,
  shortcutLabelForCommand,
  threadJumpCommandForIndex,
} from "../../keybindings";
import { isPreviewFocused } from "../../lib/preview-focus";
import { isModelPickerOpen } from "../../model-picker-visibility";
import { selectActiveRightPanel, useRightPanelStore } from "../../right-panel-store";
import { botEnvironment } from "../../state/bots";
import { useThreadShells } from "../../state/entities";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useShortcutHintsVisible } from "../../shortcut-hints";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { SidebarChromeFooter, SidebarStatusStack } from "../sidebar/sidebar-chrome";
import { isRowListMounted } from "../use-row-highlight";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { SidebarContent, SidebarGroup } from "../ui/sidebar";
import { toast } from "sonner";
import {
  filterRosterGroups,
  isRosterPinnable,
  rosterItemKey,
  rosterItemsEqual,
  orderRosterBotsForShortcuts,
  resolveAdjacentRosterItem,
  resolveRosterShortcutBot,
  type RosterEntry,
  type RosterItemRef,
} from "./roster.logic";
import { useRosterStore } from "./roster-store";
import { resolveRosterListState } from "./roster-route-selection";
import { RosterLoadStatus } from "./roster-load-status";
import { useRosterLoadState } from "./use-server-roster";
import type { Bot, Group } from "./types";
import { useOpenChat, useRoutedChat } from "./chat-navigation";
import {
  BotRosterRow,
  ChatRosterRow,
  GroupRosterRow,
  RosterRail,
  RosterSectionLabel,
} from "./roster-rows";
import { RosterPanelHeader, RosterRailNewChat, RosterSidebarHeader } from "./roster-headers";
import { focusTargetAfterRosterArchive } from "./roster-commands.logic";

export { focusTargetAfterRosterArchive, runCreateBotOnce } from "./roster-commands.logic";

export { RosterPanelHeader } from "./roster-headers";

/** Stable row actions, so memoized rows skip re-rendering when the sidebar does. */

const setRosterItemPinned = (item: RosterItemRef, pinned: boolean) =>
  useRosterStore.getState().setItemPinned(item, pinned);

/** `panel` drops the roster's own chrome for the experimental rail layout. */
export default function BotRosterSidebar({ chrome = "full" }: { chrome?: "full" | "panel" } = {}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const environmentId = usePrimaryEnvironmentId();
  const threadShells = useThreadShells();

  const archiveBotCommand = useAtomCommand(botEnvironment.archive, { reportFailure: false });
  const routed = useRoutedChat();
  const openChat = useOpenChat();

  const routedChat = useMemo(
    () =>
      routed
        ? { threadId: routed.threadRef.threadId, botId: routed.botId, groupId: routed.groupId }
        : null,
    [routed],
  );

  const routedBotId = routed?.botId ?? null;

  const { bots, groups, lastMessageByBotId, pinnedItems, unassignedItems } = useRosterStore(
    useShallow((state) => ({
      bots: state.bots,
      groups: state.groups,
      lastMessageByBotId: state.lastMessageByBotId,
      pinnedItems: state.pinnedItems,
      unassignedItems: state.unassignedItems,
    })),
  );

  const rosterEnvironmentId = useRosterStore((state) => state.environmentId);
  const rosterListState = resolveRosterListState(environmentId, rosterEnvironmentId, bots);
  const rosterLoadState = useRosterLoadState();

  const activeBotThreadRef = routed?.threadRef ?? null;

  const previewOpen = useRightPanelStore((state) =>
    activeBotThreadRef
      ? selectActiveRightPanel(state.byThreadKey, activeBotThreadRef) === "preview"
      : false,
  );

  const visibleBots = useMemo(() => bots.filter((bot) => bot.archivedAt === null), [bots]);

  const visibleGroups = useMemo(() => filterRosterGroups(groups, bots, ""), [bots, groups]);

  const pinnedKeys = useMemo(
    () => new Set(pinnedItems.filter(isRosterPinnable).map((item) => rosterItemKey(item))),
    [pinnedItems],
  );

  const liveItem = useCallback(
    (item: RosterItemRef) => {
      if (item.kind === "bot") return visibleBots.some((bot) => bot.id === item.id);

      if (item.kind === "chat") {
        const shell = threadShells.find((candidate) => candidate.id === item.id);

        return (
          shell !== undefined &&
          shell.archivedAt === null &&
          visibleBots.some((bot) => bot.id === shell.botId)
        );
      }

      return visibleGroups.some((group) => group.id === item.id);
    },
    [threadShells, visibleBots, visibleGroups],
  );

  const visiblePinnedItems = useMemo(
    () => pinnedItems.filter((item) => isRosterPinnable(item) && liveItem(item)),
    [liveItem, pinnedItems],
  );

  const visibleUnassignedItems = useMemo(() => {
    const remaining = (item: RosterItemRef) =>
      liveItem(item) && !pinnedKeys.has(rosterItemKey(item));

    if (unassignedItems.length > 0) {
      const ordered = unassignedItems.filter(remaining);
      const seen = new Set(ordered.map(rosterItemKey));

      for (const group of visibleGroups) {
        const item = { kind: "group" as const, id: group.id };

        if (remaining(item) && !seen.has(rosterItemKey(item))) ordered.push(item);
      }

      for (const bot of visibleBots) {
        const item = { kind: "bot" as const, id: bot.id };

        if (remaining(item) && !seen.has(rosterItemKey(item))) ordered.push(item);
      }

      // Groups, then DMs: each kind keeps its saved order in its own section.
      return [
        ...ordered.filter((item) => item.kind === "group"),
        ...ordered.filter((item) => item.kind === "bot"),
      ];
    }

    return [
      ...visibleGroups.map((group) => ({ kind: "group" as const, id: group.id })),
      ...visibleBots.map((bot) => ({ kind: "bot" as const, id: bot.id })),
    ].filter(remaining);
  }, [liveItem, pinnedKeys, unassignedItems, visibleBots, visibleGroups]);

  const firstUnassignedGroup = visibleUnassignedItems.find((item) => item.kind === "group");
  const firstUnassignedBot = visibleUnassignedItems.find((item) => item.kind === "bot");

  const rosterEntries = useMemo<RosterEntry[]>(
    () => [
      ...visiblePinnedItems.map((item) => ({ item, zone: "pinned" as const })),
      ...visibleUnassignedItems.map((item) => ({ item, zone: "unassigned" as const })),
    ],
    [visiblePinnedItems, visibleUnassignedItems],
  );

  const handleSelect = useCallback(
    (bot: Bot) => void openChat({ kind: "bot", id: bot.id }),
    [openChat],
  );

  const handleOpenBotSettings = useCallback(
    (bot: Bot) => {
      useRosterStore.getState().selectBot(bot.id);
      void navigate({ to: "/settings/bots/$botId", params: { botId: bot.id } });
    },
    [navigate],
  );

  const shortcutBots = useMemo(
    () =>
      orderRosterBotsForShortcuts(
        bots,
        pinnedItems.filter((item) => item.kind !== "bot"),
        [],
      ),
    [bots, pinnedItems],
  );

  const rosterItems = useMemo(() => rosterEntries.map((entry) => entry.item), [rosterEntries]);

  const shortcutHintsVisible = useShortcutHintsVisible("option");

  const shortcutLabelByBotId = useMemo(() => {
    if (!shortcutHintsVisible) return new Map<string, string>();

    return new Map(
      shortcutBots.flatMap((bot, index) => {
        const command = threadJumpCommandForIndex(index);
        const label = command ? shortcutLabelForCommand(keybindings, command) : null;

        return label ? [[bot.id, label] as const] : [];
      }),
    );
  }, [keybindings, shortcutBots, shortcutHintsVisible]);

  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.isComposing) return;

      const command = resolveShortcutCommand(event, keybindings, {
        context: {
          previewFocus: isPreviewFocused(),
          previewOpen,
          modelPickerOpen: isModelPickerOpen(),
          inputFocus: isInputFocus(event.target),
        },
      });

      const bot = resolveRosterShortcutBot(command ?? "", shortcutBots);

      const item = bot
        ? { kind: "bot" as const, id: bot.id }
        : isRowListMounted()
          ? null
          : resolveAdjacentRosterItem(command ?? "", rosterItems, routedChat);

      if (!item) return;

      event.preventDefault();
      event.stopPropagation();

      if (item.kind === "chat")
        void navigate({ to: "/chats/$threadId", params: { threadId: item.id } });
      else void openChat(item);
    };

    // Capture, so J and K win over an open question's type-to-answer.
    window.addEventListener("keydown", onWindowKeyDown, true);

    return () => window.removeEventListener("keydown", onWindowKeyDown, true);
  }, [keybindings, navigate, openChat, previewOpen, rosterItems, routedChat, shortcutBots]);

  const [archivingBot, setArchivingBot] = useState<Bot | null>(null);
  const [pendingArchivedBotId, setPendingArchivedBotId] = useState<string | null>(null);
  // Archiving is the one close that cannot go back where it came from: the row
  // menu button focus was on leaves with the row. The confirm names its survivor
  // here and holds it past the close, so the dialog does not restore focus onto
  // a button the projection is about to remove.
  const archivedFocusTarget = useRef<string | null | undefined>(undefined);
  const rosterListRef = useRef<HTMLUListElement | null>(null);

  /** Row keys in the order the roster renders them, so the survivor is the next one down. */
  const rosterRowKeys = useMemo(
    () => rosterEntries.map((entry) => rosterItemKey(entry.item)),
    [rosterEntries],
  );

  const focusRosterRow = useCallback((rowKey: string | null) => {
    const list = rosterListRef.current;

    for (const row of rowKey === null
      ? []
      : (list?.querySelectorAll<HTMLElement>("[data-roster-row]") ?? [])) {
      if (row.dataset.rosterRow === rowKey) {
        row.focus();

        return;
      }
    }

    list?.focus();
  }, []);

  const handleArchiveBot = async (bot: Bot) => {
    if (environmentId === null) {
      // Nothing was archived, so the dialog restores focus to the row menu itself.
      setArchivingBot(null);
      toast.error(t("Connect an environment first"));

      return;
    }

    const botKey = rosterItemKey({ kind: "bot", id: bot.id });
    archivedFocusTarget.current = focusTargetAfterRosterArchive(rosterRowKeys, botKey);
    setArchivingBot(null);

    const result = await archiveBotCommand({
      environmentId,
      input: { botId: BotId.make(bot.id) },
    });

    if (Predicate.isTagged(result, "Failure")) {
      // The row stayed, so focus goes back to it rather than to its replacement.
      archivedFocusTarget.current = undefined;
      focusRosterRow(botKey);
      // Archiving is refused with a reason (a group boss, a group left too small), so say it.
      toast.error(t("Bot couldn't be archived"));

      return;
    }

    setPendingArchivedBotId(bot.id);
  };

  // The exit waits for the roster projection. Navigating on the command's reply
  // sends `/` a selection it still resolves to the archived bot, which bounces
  // straight back into the chat being left; focus would land on a row that is
  // about to be removed. Once the bot is gone from the live roster the survivor
  // is real, and the selection is re-read because the user may have opened
  // another bot while the archive was in flight.
  useEffect(() => {
    if (pendingArchivedBotId === null) return;

    if (bots.some((bot) => bot.id === pendingArchivedBotId && bot.archivedAt === null)) return;
    const focusTarget = archivedFocusTarget.current ?? null;
    archivedFocusTarget.current = undefined;
    setPendingArchivedBotId(null);
    focusRosterRow(focusTarget);

    if (routedBotId === pendingArchivedBotId) void navigate({ to: "/chats", replace: true });
  }, [bots, focusRosterRow, navigate, pendingArchivedBotId, routedBotId]);

  const handleNewChat = () => useRosterStore.getState().openNewChat({});

  const handleSelectGroup = useCallback(
    (group: Group) => void openChat({ kind: "group", id: group.id }),
    [openChat],
  );

  return (
    <>
      {chrome === "panel" ? (
        <RosterPanelHeader onNewChat={handleNewChat} onSearch={() => openCommandPalette("chats")} />
      ) : (
        <RosterSidebarHeader onNewChat={handleNewChat} />
      )}
      <SidebarContent scrollAnchoring={false} className="gap-0">
        {Match.value(rosterListState).pipe(
          Match.when("loading", () => (
            // Same inset as the list it stands in for, so rows don't shift when it lands.
            <SidebarGroup className="px-(--sidebar-content-inset) pb-1 pt-1 group-data-[collapsible=icon]:hidden">
              <RosterLoadStatus state={rosterLoadState} variant="sidebar" />
            </SidebarGroup>
          )),
          Match.when("empty", () => (
            <div className="px-2 py-6 text-center text-sm text-sidebar-muted-foreground">
              {t("No bots yet")}
            </div>
          )),
          Match.orElse(() => (
            <>
              {/* Icon-collapsed rail: groups first, then every visible bot. */}
              <RosterRail
                groups={visibleGroups}
                bots={bots}
                visibleBots={visibleBots}
                openChat={routedChat}
                onSelectBot={handleSelect}
                onSelectGroup={handleSelectGroup}
              />
              <SidebarGroup className="px-(--sidebar-content-inset) pb-1 pt-1 group-data-[collapsible=icon]:hidden">
                <ul
                  ref={rosterListRef}
                  role="list"
                  // Focusable only on purpose: where focus lands when an
                  // archived row leaves and no sibling row survives it.
                  tabIndex={-1}
                  aria-label={t("Bots and groups")}
                  className="relative flex flex-wrap justify-center gap-x-1 gap-y-0.5"
                >
                  {rosterEntries.map((item) => {
                    const pinned = pinnedKeys.has(rosterItemKey(item.item));

                    const firstOfSection =
                      item.zone === "pinned"
                        ? rosterItemsEqual(item.item, visiblePinnedItems[0]!)
                        : (firstUnassignedGroup !== undefined &&
                            rosterItemsEqual(item.item, firstUnassignedGroup)) ||
                          (firstUnassignedBot !== undefined &&
                            rosterItemsEqual(item.item, firstUnassignedBot));

                    const sectionLabel = !firstOfSection
                      ? null
                      : item.zone === "pinned"
                        ? { label: t("Pins") }
                        : item.item.kind === "group"
                          ? { label: t("Groups") }
                          : { label: t("DMs") };

                    return [
                      sectionLabel ? (
                        <RosterSectionLabel
                          key={`label:${rosterItemKey(item.item)}`}
                          label={sectionLabel.label}
                          first={rosterItemsEqual(
                            item.item,
                            (visiblePinnedItems[0] ?? visibleUnassignedItems[0])!,
                          )}
                        />
                      ) : null,
                      Match.value(item.item).pipe(
                        Match.when({ kind: "chat" }, (ref) => {
                          const chatId = ref.id;
                          const shell = threadShells.find((candidate) => candidate.id === chatId);
                          const bot = bots.find((candidate) => candidate.id === shell?.botId);

                          if (!bot) return null;

                          return (
                            <ChatRosterRow
                              key={rosterItemKey(item.item)}
                              threadId={chatId}
                              bot={bot}
                              openThreadId={routedChat?.threadId ?? null}
                              onPin={setRosterItemPinned}
                            />
                          );
                        }),
                        Match.when({ kind: "bot" }, (ref) => {
                          const bot = bots.find((candidate) => candidate.id === ref.id);

                          if (!bot) return null;

                          return (
                            <BotRosterRow
                              key={rosterItemKey(item.item)}
                              bot={bot}
                              lastMessage={lastMessageByBotId[bot.id] ?? null}
                              openThreadId={
                                routedBotId === bot.id ? (routedChat?.threadId ?? null) : null
                              }
                              onOpenSettings={handleOpenBotSettings}
                              pinned={pinned}
                              onArchive={setArchivingBot}
                              shortcutLabel={shortcutLabelByBotId.get(bot.id) ?? null}
                            />
                          );
                        }),
                        Match.when({ kind: "group" }, (ref) => {
                          const group = groups.find((candidate) => candidate.id === ref.id);

                          if (!group) return null;

                          return (
                            <GroupRosterRow
                              key={rosterItemKey(item.item)}
                              group={group}
                              bots={bots}
                              isActive={routed?.groupId === group.id}
                              onSelect={handleSelectGroup}
                              pinned={pinned}
                              onPin={setRosterItemPinned}
                            />
                          );
                        }),
                        Match.exhaustive,
                      ),
                    ];
                  })}
                </ul>
                {visibleBots.length === 0 && visibleGroups.length === 0 ? (
                  <div className="px-2 py-6 text-center text-sm text-sidebar-muted-foreground">
                    {t("No bots match")}
                  </div>
                ) : null}
              </SidebarGroup>
            </>
          )),
        )}
        {/* Archiving is reversible, so the way back stays in the roster itself. */}
      </SidebarContent>
      {/* The rail's New chat sits above the footer, like the expanded header's plus. */}
      <RosterRailNewChat onNewChat={handleNewChat} />
      <AlertDialog
        open={archivingBot !== null}
        onOpenChange={(open) => {
          if (!open) setArchivingBot(null);
        }}
      >
        {archivingBot ? (
          <AlertDialogPopup
            // Cancelling belongs back on the row menu it came from. Archiving does
            // not: that row is on its way out of the projection, so the archive
            // effect places focus on the survivor and this must not move it after.
            finalFocus={() => archivedFocusTarget.current === undefined}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>{t("Archive bot?")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t(
                  "The bot leaves the roster and stops taking messages. You can restore it from Settings > Archived for {days} days, then it is deleted. Its chats stay in your history.",
                  { days: ARCHIVED_BOT_RETENTION_DAYS },
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogClose render={<Button variant="outline" />}>
                {t("Cancel")}
              </AlertDialogClose>
              <Button variant="destructive" onClick={() => void handleArchiveBot(archivingBot)}>
                {t("Archive")}
              </Button>
            </AlertDialogFooter>
          </AlertDialogPopup>
        ) : null}
      </AlertDialog>
      {chrome === "panel" ? (
        <SidebarStatusStack className="shrink-0 p-2" />
      ) : (
        <SidebarChromeFooter />
      )}
    </>
  );
}
