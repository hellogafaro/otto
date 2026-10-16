import { RiAlertLine } from "@remixicon/react";

import { useI18n } from "../../i18n";
import { cn } from "../../lib/utils";
import { Kbd, KbdGroup } from "../ui/kbd";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { keybindingDisplayParts } from "./keybindings-settings.logic";

export type Translate = ReturnType<typeof useI18n>["t"];

/** Renders a keybinding string as one key cap per modifier and key. */
export function KeyCaps({ value, className }: { value: string; className?: string }) {
  const parts = keybindingDisplayParts(value, navigator.platform);

  return (
    <KbdGroup className={cn("gap-0.5", className)}>
      {parts.map((part) => (
        <Kbd key={part} variant="shortcut">
          {part}
        </Kbd>
      ))}
    </KbdGroup>
  );
}

export function spokenKeybinding(value: string): string {
  return keybindingDisplayParts(value, navigator.platform).join(" ");
}

export function conflictDescription(labels: ReadonlyArray<string>, t: Translate): string {
  const listed = labels.slice(0, 3).join(", ");

  return labels.length > 3
    ? t("Same keys as {labels}, and more.", { labels: listed })
    : t("Same keys as {labels}.", { labels: listed });
}

export function KeybindingConflictWarning({ labels }: { labels: ReadonlyArray<string> }) {
  const { t } = useI18n();

  if (labels.length === 0) return null;
  const description = conflictDescription(labels, t);

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            tabIndex={0}
            role="img"
            aria-label={t("Conflict. {description}", { description })}
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-warning outline-none hover:bg-warning/10 focus-visible:ring-3 focus-visible:ring-warning/25"
          >
            <RiAlertLine className="size-3.5" />
          </span>
        }
      />
      <TooltipPopup side="top" variant="keybinding-warning" className="max-w-72 whitespace-normal">
        {t("{description} Only the one defined last will run.", { description })}
      </TooltipPopup>
    </Tooltip>
  );
}
