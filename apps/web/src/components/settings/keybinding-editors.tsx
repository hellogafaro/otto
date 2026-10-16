import { type ServerRemoveKeybindingInput } from "@otto/contracts";

import { type KeyboardEvent, useEffect, useId, useRef } from "react";
import { useI18n } from "../../i18n";
import { cn } from "../../lib/utils";
import { Input } from "../ui/input";
import { KeyCaps, spokenKeybinding } from "./keybinding-presentation";
import { type KeybindingRow, keybindingFromKeyboardEvent } from "./keybindings-settings.logic";

export function rowKeybindingTarget(row: KeybindingRow): ServerRemoveKeybindingInput {
  return {
    command: row.command,
    key: row.key,
    ...(row.when.trim().length > 0 ? { when: row.when } : {}),
  };
}

/**
 * Shows the current shortcut as key caps and swaps to a capture field while
 * recording. Escape restores `resetKey`; Tab leaves without changing it.
 */
export function ShortcutRecorder({
  commandTitle,
  value,
  resetKey,
  isRecording,
  hasConflict,
  onRecordingChange,
  onChange,
}: {
  commandTitle: string;
  value: string;
  resetKey: string;
  isRecording: boolean;
  hasConflict: boolean;
  onRecordingChange: (recording: boolean) => void;
  onChange: (key: string) => void;
}) {
  const { t } = useI18n();
  const hintId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef(false);

  useEffect(() => {
    if (isRecording || !restoreFocusRef.current) return;
    restoreFocusRef.current = false;
    buttonRef.current?.focus();
  }, [isRecording]);

  const captureKeybinding = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Tab") return;
    event.preventDefault();

    if (event.key === "Escape") {
      restoreFocusRef.current = true;
      onChange(resetKey);
      onRecordingChange(false);

      return;
    }

    const next = keybindingFromKeyboardEvent(event.nativeEvent, navigator.platform);

    if (!next) return;
    restoreFocusRef.current = true;
    onChange(next);
    onRecordingChange(false);
  };

  if (isRecording) {
    return (
      <>
        <Input
          data-keybinding-capture=""
          autoFocus
          readOnly
          aria-label={t("Record shortcut for {command}", { command: commandTitle })}
          aria-describedby={hintId}
          value=""
          placeholder={t("Press keys…")}
          size="compact"
          variant="keybinding-capture"
          className="w-36"
          onBlur={() => onRecordingChange(false)}
          onKeyDown={captureKeybinding}
        />
        <span id={hintId} className="sr-only">
          {t("Press the new key combination with at least one modifier. Escape cancels.")}
        </span>
      </>
    );
  }

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={() => onRecordingChange(true)}
      aria-label={
        value
          ? t("Change shortcut for {command}, currently {keys}", {
              command: commandTitle,
              keys: spokenKeybinding(value),
            })
          : t("Record shortcut for {command}", { command: commandTitle })
      }
      className={cn(
        "inline-flex h-7 min-w-16 items-center justify-end rounded-md border border-transparent px-1 outline-none transition-colors hover:border-border/70 hover:bg-accent/50 focus-visible:border-foreground/30 focus-visible:ring-3 focus-visible:ring-ring/24",
        hasConflict && "border-warning/40 bg-warning/5",
      )}
    >
      {value ? (
        <KeyCaps value={value} />
      ) : (
        <span className="px-1 text-12px text-muted-foreground">{t("Record shortcut")}</span>
      )}
    </button>
  );
}
