import { useAtomValue } from "@effect/atom-react";
import type { KeybindingWhenNode } from "@otto/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { isElectron } from "../env";
import { useI18n } from "../i18n";
import { resolveShortcutCommand, isInputFocus } from "../keybindings";
import { openSettings } from "../settings-dialog-store";
import { primaryServerKeybindingsAtom } from "../state/server";
import { recordLookup } from "./record-lookup";
import { KeyCaps } from "./settings/keybinding-presentation";
import {
  buildKeybindingGroups,
  buildKeybindingRows,
  commandLabel,
} from "./settings/keybindings-settings.logic";
import { Dialog, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "./ui/dialog";

const NAVIGATION_PATHS = {
  "navigation.home": "/",
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

/** Whether a binding's condition can hold in this app, desktop or browser. */
function appliesHere(node: KeybindingWhenNode | undefined): boolean {
  if (!node) return true;

  if (node.type === "identifier") return node.name !== "desktop" || isElectron;

  if (node.type === "not" && node.node.type === "identifier" && node.node.name === "desktop") {
    return !isElectron;
  }

  if (node.type === "and") return appliesHere(node.left) && appliesHere(node.right);

  return true;
}

/**
 * Otto: App-wide keys that belong to no one page: Settings, the places in the rail and
 * the keyboard shortcuts sheet. Keys inside a dialog or an open menu stay theirs.
 */
export function GlobalShortcuts() {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const navigate = useNavigate();
  const [sheetOpen, setSheetOpen] = useState(false);

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

      const command = resolveShortcutCommand(event, keybindings, {
        context: { inputFocus: isInputFocus(event.target) },
      });

      const path = recordLookup(NAVIGATION_PATHS, command ?? "");
      const pathname = window.location.pathname;

      if (path) {
        if (!isPathUnder(pathname, path)) void navigate({ to: path });
      } else if (command === "settings.open") {
        if (!isPathUnder(pathname, "/settings")) openSettings();
      } else if (command === "shortcuts.show") {
        setSheetOpen(true);
      } else {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
    };

    window.addEventListener("keydown", onKeyDown, true);

    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [keybindings, navigate]);

  return <KeyboardShortcutsSheet open={sheetOpen} onOpenChange={setSheetOpen} />;
}

function KeyboardShortcutsSheet({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);

  const groups = useMemo(
    () =>
      buildKeybindingGroups(
        buildKeybindingRows(keybindings).filter((row) => appliesHere(row.binding.whenAst)),
      ),
    [keybindings],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Keyboard shortcuts")}</DialogTitle>
        </DialogHeader>
        <DialogPanel className="flex flex-col gap-5">
          {groups.map((group) => (
            <section key={group.id} className="flex flex-col gap-1">
              <h3 className="text-xs font-medium text-muted-foreground">{group.title}</h3>
              {group.items.map((item) =>
                item.type === "row" ? (
                  <ShortcutSheetRow
                    key={item.row.id}
                    title={commandLabel(item.row.command)}
                    value={item.row.key}
                  />
                ) : item.series.rangeKey ? (
                  <ShortcutSheetRow
                    key={item.series.id}
                    title={item.series.title}
                    value={item.series.rangeKey}
                  />
                ) : null,
              )}
              {group.id === "composer" ? (
                <>
                  <ShortcutSheetRow title={t("Leave the composer")} value="esc" />
                  <ShortcutSheetRow title={t("Back to the composer")} value="enter" />
                </>
              ) : null}
            </section>
          ))}
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}

function ShortcutSheetRow({ title, value }: { readonly title: string; readonly value: string }) {
  return (
    <div className="flex min-h-7 items-center justify-between gap-4 text-sm">
      <span className="min-w-0 truncate text-foreground">{title}</span>
      <KeyCaps value={value} />
    </div>
  );
}
