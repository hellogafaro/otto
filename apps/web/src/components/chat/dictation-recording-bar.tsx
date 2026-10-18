import { RiCloseLine } from "@remixicon/react";

import { useI18n } from "~/i18n";

import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { DictationMeter } from "./dictation-meter";

/** True while a dictation owns the composer row: asking for the mic, recording or transcribing. */
export function isDictating(status: string): boolean {
  return status === "requesting" || status === "recording" || status === "transcribing";
}

/**
 * Otto: The row every dictating composer shows in place of its own controls: cancel, the voice and
 * the elapsed time, 8px apart and centered on the row. The composer keeps the stop button in its
 * send slot just after it, so the chat composer, New chat, routines and tasks look and behave alike.
 */
export function DictationRecordingBar({
  stream,
  onCancel,
}: {
  readonly stream: MediaStream | null;
  readonly onCancel: () => void;
}) {
  const { t } = useI18n();

  return (
    <div
      data-testid="dictation-recording-bar"
      className="pointer-events-auto flex h-7 min-w-0 flex-1 items-center gap-2 pe-2"
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="icon-sm"
              variant="secondary"
              aria-label={t("Cancel dictation")}
              onClick={onCancel}
            />
          }
        >
          <RiCloseLine />
        </TooltipTrigger>
        <TooltipPopup side="top">{t("Cancel dictation")}</TooltipPopup>
      </Tooltip>
      <DictationMeter stream={stream} />
    </div>
  );
}
