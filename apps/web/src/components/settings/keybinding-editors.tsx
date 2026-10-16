import { type ServerRemoveKeybindingInput } from "@otto/contracts";

import { type KeyboardEvent, useEffect, useId, useRef } from "react";
import { useI18n } from "../../i18n";
import { Button } from "../ui/button";
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
  onRecordingChange,
  onChange,
}: {
  commandTitle: string;
  value: string;
  resetKey: string;
  isRecording: boolean;
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
          placeholder={t("Press keys")}
          size="compact"
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
    <Button
      ref={buttonRef}
      type="button"
      variant="ghost"
      size={value ? "keys" : "sm"}
      onClick={() => onRecordingChange(true)}
      aria-label={
        value
          ? t("Change shortcut for {command}, currently {keys}", {
              command: commandTitle,
              keys: spokenKeybinding(value),
            })
          : t("Record shortcut for {command}", { command: commandTitle })
      }
    >
      {value ? <KeyCaps value={value} /> : t("Record shortcut")}
    </Button>
  );
}
