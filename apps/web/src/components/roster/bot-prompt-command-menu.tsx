import type { MessageKey } from "@otto/client-runtime/i18n";
import type { KeybindingCommand } from "@otto/contracts";
import { RiAddLine, RiRobot2Line, RiUserAddLine } from "@remixicon/react";
import { type KeyboardEvent, type Ref, useImperativeHandle, useMemo, useState } from "react";

import { activeComposerModelPicker } from "../../composer-model-picker-registry";
import { usePrimarySettings } from "../../hooks/use-settings";
import { useTheme } from "../../hooks/use-theme";
import { useI18n } from "../../i18n";
import { useActivePageActions } from "../../page-actions-registry";
import { ComposerCommandMenu, type ComposerCommandItem } from "../chat/composer-command-menu";
import { resolveComposerMenuActiveItemId } from "../chat/composer-menu-highlight";
import {
  buildComposerProviderMenuItems,
  composerProviderMenuItemText,
  type ComposerProviderCatalog,
} from "../chat/composer-provider-menu-items";
import { searchSlashCommandItems } from "../chat/composer-slash-command-search";
import type { BotPromptCommandTrigger } from "./bot-prompt-commands.logic";
import type { GroupCandidate } from "./group-member-checklist";
import { useRosterStore } from "./roster-store";

export interface BotPromptCommandMenuHandle {
  /** Handles picker keys. Returns true when the key was consumed. */
  readonly handleKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
}

/** Who `/invite` offers, the people and bots not yet in the chat, and the call that adds one. */
export interface BotPromptInvite {
  readonly addable: ReadonlyArray<GroupCandidate>;
  readonly add: (candidate: GroupCandidate) => Promise<boolean>;
}

type OttoCommandItem = Extract<ComposerCommandItem, { type: "slash-command" }>;

/**
 * The `$` skill and `/` command picker, the same menu the classic composer shows.
 * Mounted only while a trigger is being typed, so settings stay off the typing path.
 * At the start of the message Otto's own commands come first and run the open chat's actions;
 * the provider's commands follow under Sent to the bot. `onSelect` receives the text that
 * replaces the typed token; `onRun` clears it and runs an Otto command. A null catalog means no
 * provider is connected, so the menu stays open and says so instead of vanishing.
 */
export function BotPromptCommandMenu({
  ref,
  trigger,
  catalog,
  invite = null,
  onSelect,
  onRun,
  onClose,
}: {
  ref: Ref<BotPromptCommandMenuHandle>;
  trigger: BotPromptCommandTrigger;
  catalog: ComposerProviderCatalog | null;
  invite?: BotPromptInvite | null;
  onSelect: (inserted: string) => void;
  onRun: (run: () => void) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const showSkillsInSlashMenu = usePrimarySettings((settings) => settings.showSkillsInSlashMenu);
  const { resolvedTheme } = useTheme();
  const pageActions = useActivePageActions().actions;
  const { kind, query } = trigger;

  const providerItems = useMemo(
    () =>
      buildComposerProviderMenuItems({
        trigger: { kind, query },
        catalog,
        showSkillsInSlashMenu,
        t,
      }),
    [catalog, kind, query, showSkillsInSlashMenu, t],
  );

  const runs = new Map<string, () => void>();

  const ottoItems: OttoCommandItem[] = [];

  const addOttoItem = (item: Omit<OttoCommandItem, "id" | "type" | "label">, run?: () => void) => {
    const id = `otto:${item.command}`;
    ottoItems.push({ ...item, id, type: "slash-command", label: `/${item.command}` });

    if (run) runs.set(id, run);
  };

  const addPageAction = (command: OttoCommandItem["command"], shortcut: KeybindingCommand) => {
    const action = pageActions.find(
      (entry) => entry.shortcutCommand === shortcut && !entry.disabled,
    );

    if (!action) return false;
    addOttoItem(
      {
        command,
        description: action.title,
        ...(action.icon ? { icon: action.icon } : {}),
      },
      () => void action.run(),
    );

    return true;
  };

  if (kind === "slash-command" && trigger.rangeStart === 0) {
    if (invite) {
      addOttoItem({
        command: "invite",
        description: t("Add people or bots to this chat"),
        icon: RiUserAddLine,
      });
    }

    addPageAction("snooze", "item.snooze");
    addPageAction("rename", "item.rename");
    addPageAction("archive", "item.archive");
    const modelPicker = activeComposerModelPicker();

    if (modelPicker) {
      addOttoItem(
        {
          command: "model",
          description: t("Change model"),
          icon: RiRobot2Line,
        },
        modelPicker.openModelPicker,
      );
    }

    // Like the C key, a page without a New of its own starts a new chat.
    if (!addPageAction("new", "item.new")) {
      addOttoItem(
        {
          command: "new",
          description: t("New chat"),
          icon: RiAddLine,
        },
        () => useRosterStore.getState().openNewChat({}),
      );
    }
  }

  const inviteQuery = query.toLowerCase();

  const items: ComposerCommandItem[] =
    kind === "invite"
      ? (invite?.addable ?? [])
          .filter((candidate) => candidate.name.toLowerCase().includes(inviteQuery))
          .map((candidate) => ({
            id: `invitee:${candidate.key}`,
            type: "invitee",
            candidate,
            label: candidate.name,
            description: "",
          }))
      : [...searchSlashCommandItems(ottoItems, query), ...providerItems];

  const searchKey = `${trigger.kind}:${trigger.query.trim().toLowerCase()}`;

  const [highlight, setHighlight] = useState<{ itemId: string | null; searchKey: string | null }>({
    itemId: null,
    searchKey: null,
  });

  const activeItemId = resolveComposerMenuActiveItemId({
    items,
    highlightedItemId: highlight.itemId,
    currentSearchKey: searchKey,
    highlightedSearchKey: highlight.searchKey,
  });

  const select = (item: ComposerCommandItem) => {
    if (item.type === "skill" || item.type === "provider-slash-command") {
      onSelect(composerProviderMenuItemText(item));
    } else if (item.type === "invitee") {
      onRun(() => void invite?.add(item.candidate));
    } else if (item.type === "slash-command" && item.command === "invite") {
      onSelect("/invite @");
    } else {
      const run = runs.get(item.id);

      if (run) onRun(run);
    }
  };

  useImperativeHandle(ref, () => ({
    handleKeyDown: (event) => {
      if (event.nativeEvent.isComposing) return false;

      if (event.key === "Escape") {
        onClose();

        return true;
      }

      if (items.length === 0) return false;

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const index = items.findIndex((item) => item.id === activeItemId);
        const step = event.key === "ArrowDown" ? 1 : -1;
        const next = items[(index + step + items.length) % items.length];
        setHighlight({ itemId: next?.id ?? null, searchKey });

        return true;
      }

      if ((event.key === "Enter" && !event.shiftKey) || (event.key === "Tab" && !event.shiftKey)) {
        const item = items.find((candidate) => candidate.id === activeItemId) ?? items[0];

        if (item) select(item);

        return true;
      }

      return false;
    },
  }));

  return (
    <div data-testid="bot-prompt-command-menu" className="absolute inset-x-0 bottom-full z-20 mb-2">
      <ComposerCommandMenu
        items={items}
        resolvedTheme={resolvedTheme}
        isLoading={false}
        triggerKind={trigger.kind === "invite" ? null : trigger.kind}
        emptyStateText={
          trigger.kind === "invite"
            ? invite?.addable.length
              ? t("No results")
              : t("Everyone is already in this group.")
            : botPromptCommandMenuEmptyText(trigger.kind, catalog !== null, t)
        }
        providerGroupLabel={t("Sent to the bot")}
        activeItemId={activeItemId}
        onHighlightedItemChange={(itemId) => setHighlight({ itemId, searchKey })}
        onSelect={select}
      />
    </div>
  );
}

/** The line an empty picker shows. Without a provider, it says what to connect. */
export function botPromptCommandMenuEmptyText(
  kind: "skill" | "slash-command",
  hasProvider: boolean,
  t: (message: MessageKey) => string,
): string {
  if (!hasProvider) {
    return kind === "skill"
      ? t("Connect a provider to use skills.")
      : t("Connect a provider to use its commands.");
  }

  return kind === "skill"
    ? t("No skills found. Try / to browse provider commands.")
    : t("No matching command.");
}
