import {
  RiAddLine,
  RiAlarmLine,
  RiArchiveLine,
  RiDeleteBinLine,
  RiLoopRightLine,
  RiPencilLine,
  RiPushpinLine,
  RiRadioButtonLine,
  RiSunLine,
  RiUnpinLine,
  RiUserAddLine,
} from "@remixicon/react";
import type { SnoozePresetId } from "@otto/client-runtime/state/thread-snoozed";
import type { ScopedThreadRef } from "@otto/contracts";
import { type ChatActions } from "../../hooks/use-chat-actions";
import { useI18n } from "../../i18n";
import type { PageAction } from "../../page-actions-registry";
import type { useCopyPageActions } from "../copy-menu-items";
import { type ChatMenuState } from "./chat-actions.logic";

/** Opens the New chat dialog, set up from the chat on screen. */
export interface NewChatControl {
  readonly canStart: boolean;
  readonly start: () => void;
}

export function snoozePresetLabel(id: SnoozePresetId, t: ReturnType<typeof useI18n>["t"]) {
  switch (id) {
    case "hour":
      return t("In 1 hour");
    case "three-hours":
      return t("In 3 hours");
    case "evening":
      return t("This evening");
    case "tomorrow":
      return t("Tomorrow");
    case "next-week":
      return t("Next week");
  }
}

/**
 * The open chat's actions, in the order its header menu lists them. The menu, the command
 * palette and the item shortcuts all run these entries.
 */
export function buildChatPaletteActions({
  threadRef,
  state,
  newChat,
  actions,
  t,
  openRename,
  openSnooze,
  copy,
  addMembers,
  mayArchive,
}: {
  readonly threadRef: ScopedThreadRef | null;
  readonly state: ChatMenuState | null;
  readonly newChat: NewChatControl | null;
  readonly actions: ChatActions;
  readonly t: ReturnType<typeof useI18n>["t"];
  readonly openRename: () => void;
  /** Opens the snooze presets beside the chat's More actions button. */
  readonly openSnooze: () => void;
  readonly copy: ReturnType<typeof useCopyPageActions> | null;
  /** Opens a group chat's Add members, in the details panel. */
  readonly addMembers: (() => void) | null;
  /** False in a group chat someone else started: archiving it is theirs or an admin's. */
  readonly mayArchive: boolean;
}): PageAction[] {
  const list: PageAction[] = [];

  if (newChat?.canStart) {
    list.push({
      id: "new",
      title: t("New chat"),
      icon: RiAddLine,
      searchTerms: ["new chat", "fresh", "start over"],
      shortcutCommand: "item.new",
      run: () => newChat.start(),
    });
  }

  if (!threadRef || !state) return list;
  list.push({
    id: "rename",
    title: t("Rename chat"),
    icon: RiPencilLine,
    searchTerms: ["rename", "title"],
    shortcutCommand: "item.rename",
    run: openRename,
  });

  if (state.supports.titleRegeneration) {
    list.push({
      id: "regenerate-title",
      title: state.isRegeneratingTitle ? t("Regenerating…") : t("Regenerate title"),
      icon: RiLoopRightLine,
      searchTerms: ["regenerate", "title"],
      disabled: state.isRegeneratingTitle,
      run: async () => {
        await actions.regenerateTitle(threadRef);
      },
    });
  }

  if (state.supports.pinning) {
    list.push(
      state.isPinned
        ? {
            id: "unpin",
            title: t("Unpin chat"),
            icon: RiUnpinLine,
            searchTerms: ["unpin"],
            shortcutCommand: "item.pin",
            run: async () => {
              await actions.unpin(threadRef);
            },
          }
        : {
            id: "pin",
            title: t("Pin chat"),
            icon: RiPushpinLine,
            searchTerms: ["pin"],
            shortcutCommand: "item.pin",
            run: async () => {
              await actions.pin(threadRef);
            },
          },
    );
  }

  list.push({
    id: "mark-unread",
    title: t("Mark unread"),
    icon: RiRadioButtonLine,
    searchTerms: ["unread"],
    shortcutCommand: "item.markUnread",
    disabled: !state.canMarkUnread,
    run: () => actions.markUnread(threadRef),
  });

  if (state.supports.snooze) {
    list.push(
      state.isSnoozed
        ? {
            id: "unsnooze",
            title: t("Wake chat"),
            icon: RiSunLine,
            searchTerms: ["wake", "unsnooze"],
            shortcutCommand: "item.snooze",
            run: async () => {
              await actions.unsnooze(threadRef);
            },
          }
        : {
            id: "snooze",
            title: t("Snooze…"),
            icon: RiAlarmLine,
            searchTerms: ["snooze", "later", "remind"],
            shortcutCommand: "item.snooze",
            disabled: !state.canSnooze,
            run: openSnooze,
          },
    );
  }

  if (addMembers) {
    list.push({
      id: "add-members",
      title: t("Add members"),
      icon: RiUserAddLine,
      searchTerms: ["add members", "invite", "members"],
      shortcutCommand: "property.members",
      run: addMembers,
    });
  }

  if (copy) list.push(copy.link, copy.id);

  if (mayArchive) {
    list.push({
      id: "archive",
      title: t("Archive chat"),
      icon: RiArchiveLine,
      searchTerms: ["archive"],
      shortcutCommand: "item.archive",
      disabled: !state.canArchive,
      run: async () => {
        await actions.archive(threadRef);
      },
    });
  }

  list.push({
    id: "delete",
    title: t("Delete chat"),
    icon: RiDeleteBinLine,
    searchTerms: ["delete", "remove"],
    shortcutCommand: "item.delete",
    run: async () => {
      await actions.delete(threadRef);
    },
  });

  return list;
}
