import { RiMicLine, RiStopFill } from "@remixicon/react";

import { useEffect, useId, useRef } from "react";

import { useI18n } from "~/i18n";

import { Spinner } from "../ui/spinner";

export interface DictationControlsProps {
  status: "idle" | "requesting" | "recording" | "transcribing" | "canceled" | "failed";
  unavailableReason?: string | null;
  errorMessage?: string | null;
  appearance?: "labeled" | "send-slot";
  onStart: () => void;
  onRelease: () => void;
  onCancel: () => void;
  /** Send-slot only: the blocked mic stays pressable so it can explain the unavailable reason. */
  onBlockedPress?: (reason: string) => void;
}

export function DictationControls({
  status,
  unavailableReason,
  appearance = "labeled",
  onStart,
  onRelease,
  onCancel,
  onBlockedPress,
}: DictationControlsProps) {
  const { t } = useI18n();

  const announcements = {
    idle: t("Dictation ready."),
    requesting: t("Requesting microphone access…"),
    recording: t("Recording dictation."),
    transcribing: t("Transcribing dictation…"),
    canceled: t("Dictation canceled."),
    failed: t("Dictation failed. Try again."),
  };

  const descriptionId = useId();
  const pointer = useRef<number | null>(null);
  const suppressClick = useRef(false);
  const holdStartedAt = useRef(0);
  const startedThisGesture = useRef(false);
  const active = status === "requesting" || status === "recording";
  const busy = active || status === "transcribing";
  const blocked = Boolean(unavailableReason);
  const explainsBlock = appearance === "send-slot" && blocked && onBlockedPress !== undefined;

  const disabled = status === "transcribing" || (blocked && !explainsBlock);

  const operation = useRef(busy);
  const cancelCallback = useRef(onCancel);
  useEffect(() => {
    cancelCallback.current = onCancel;
  }, [onCancel]);
  useEffect(() => {
    operation.current = busy;
  }, [status]);

  const cancel = () => {
    pointer.current = null;

    if (!operation.current) return;
    operation.current = false;
    cancelCallback.current();
  };

  useEffect(() => {
    if (!blocked) return;

    // A blocked slot cannot retry, so settle a failed dictation and give the send slot back.
    if (status === "failed") cancelCallback.current();
    else cancel();
  }, [blocked, status]);
  useEffect(() => () => cancel(), []);

  const start = () => {
    operation.current = true;
    onStart();
  };

  const toggle = () => {
    if (explainsBlock) {
      onBlockedPress(unavailableReason!);

      return;
    }

    if (disabled) return;

    if (active) onRelease();
    else start();
  };

  const label =
    status === "transcribing"
      ? t("Transcribing dictation…")
      : active
        ? t("Stop dictation")
        : t("Start dictation");

  const statusText = unavailableReason
    ? t("Dictation unavailable: {reason}", { reason: unavailableReason })
    : announcements[status];

  const button = (
    <button
      type="button"
      className={
        appearance === "send-slot"
          ? `flex size-full touch-none select-none items-center justify-center rounded-(--control-radius) transition-colors disabled:opacity-50 aria-disabled:opacity-50 ${
              active
                ? "bg-destructive text-on-solid"
                : "bg-(--primary-button-background) text-(--primary-button-foreground) hover:opacity-92"
            }`
          : "min-h-11 touch-none select-none rounded-md border px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
      }
      disabled={disabled}
      aria-disabled={explainsBlock || undefined}
      aria-label={label}
      aria-pressed={active}
      aria-describedby={`${descriptionId} ${descriptionId}-status`}
      onPointerDown={(event) => {
        if (event.button !== 0 || !event.isPrimary || disabled || pointer.current !== null) return;

        if (explainsBlock) return;
        event.preventDefault();
        suppressClick.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        pointer.current = event.pointerId;
        holdStartedAt.current = Date.now();
        startedThisGesture.current = !active;

        if (!active) start();
      }}
      onPointerUp={(event) => {
        if (pointer.current !== event.pointerId) return;
        pointer.current = null;
        const heldMs = Date.now() - holdStartedAt.current;

        // A tap starts recording; only a real hold finishes on release.
        if (appearance === "send-slot" && startedThisGesture.current && heldMs < 220) return;
        onRelease();
      }}
      onPointerCancel={(event) => {
        if (pointer.current === event.pointerId) cancel();
      }}
      onLostPointerCapture={(event) => {
        if (pointer.current === event.pointerId) cancel();
      }}
      onClick={(event) => {
        // Pointer release already finished the hold; keyboard and AT clicks have detail zero.
        if (event.detail !== 0 && suppressClick.current) {
          suppressClick.current = false;

          return;
        }

        suppressClick.current = false;
        toggle();
      }}
    >
      {appearance === "send-slot" ? (
        status === "transcribing" ? (
          <Spinner
            className="size-3.5"
            aria-hidden="true"
            aria-label={undefined}
            role={undefined}
          />
        ) : active ? (
          <RiStopFill className="size-3" aria-hidden="true" />
        ) : (
          <RiMicLine className="size-3.5" aria-hidden="true" />
        )
      ) : active ? (
        t("Stop dictation")
      ) : (
        t("Dictate")
      )}
    </button>
  );

  if (appearance === "send-slot") {
    return (
      <div className="relative size-full">
        {button}
        <span id={descriptionId} className="sr-only">
          {t(
            "Hold to dictate and release to finish, or activate to start and activate again to stop.",
          )}
        </span>
        <span
          id={`${descriptionId}-status`}
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="sr-only"
        >
          {statusText}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {button}
      {busy && (
        <button
          type="button"
          className="min-h-11 rounded-md border px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring"
          onClick={cancel}
        >
          {t("Cancel dictation")}
        </button>
      )}
      <span id={descriptionId} className="text-xs text-muted-foreground">
        {t(
          "Hold to dictate and release to finish, or activate to start and activate again to stop.",
        )}
      </span>
      <span
        id={`${descriptionId}-status`}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="text-xs text-muted-foreground"
      >
        {statusText}
      </span>
    </div>
  );
}
