import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { isInputFocus, resolveShortcutCommand } from "../keybindings";
import { pageActionForCommand } from "../page-actions-registry";
import { openSettings } from "../settings-dialog-store";
import { primaryServerKeybindingsAtom } from "../state/server";
import { recordLookup } from "./record-lookup";
import { useRosterStore } from "./roster/roster-store";

export const NAVIGATION_PATHS = {
  "navigation.home": "/",
  "navigation.notifications": "/notifications",
  "navigation.chats": "/chats",
  "navigation.routines": "/routines",
  "navigation.tasks": "/tasks",
  "navigation.projects": "/projects",
  "navigation.library": "/library",
} as const;

function isPathUnder(pathname: string, base: string): boolean {
  if (base === "/") return pathname === "/";

  return pathname === base || pathname.startsWith(`${base}/`);
}

/**
 * Otto: App-wide keys: the places in the rail, Settings and its Shortcuts page, and the item
 * verbs (C, R, P, U, H, E, ⌘⌫, copy link and ID), which run the open page's own action for that
 * command. C starts a new chat where the page has nothing of its own to create. Keys inside a
 * dialog or an open menu stay theirs.
 */
export function GlobalShortcuts() {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const navigate = useNavigate();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.isComposing) return;

      if (
        event.target instanceof Element &&
        event.target.closest(
          '[role="dialog"], [role="alertdialog"], [role="menu"], [data-keybinding-capture]',
        )
      ) {
        return;
      }

      const resolved = resolveShortcutCommand(event, keybindings, {
        context: { inputFocus: isInputFocus(event.target) },
      });

      // New chat predates the page-wide New; a key someone bound to it still creates here.
      const command = resolved === "chat.new" ? "item.new" : resolved;
      const pageAction = command ? pageActionForCommand(command) : null;

      const path = recordLookup(NAVIGATION_PATHS, command ?? "");
      const pathname = window.location.pathname;

      if (pageAction) {
        void pageAction.run();
      } else if (command === "item.new") {
        useRosterStore.getState().openNewChat({});
      } else if (path) {
        if (!isPathUnder(pathname, path)) void navigate({ to: path });
      } else if (command === "settings.open") {
        if (!isPathUnder(pathname, "/settings")) openSettings();
      } else if (command === "shortcuts.show") {
        if (!isPathUnder(pathname, "/settings/keybindings")) openSettings("keybindings");
      } else {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
    };

    window.addEventListener("keydown", onKeyDown, true);

    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [keybindings, navigate]);

  return null;
}
