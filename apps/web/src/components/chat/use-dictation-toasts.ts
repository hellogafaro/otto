import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { useI18n } from "~/i18n";
import type { ComposerDictation } from "~/lib/use-composer-dictation";

import { formatDictationElapsed } from "./dictation-meter";

/**
 * Otto: The toasts every dictating composer shows: why a dictation failed, with Retry when the
 * recording was kept, and a short note when it reached the time limit and stopped itself.
 */
export function useDictationToasts(dictation: ComposerDictation, limitMs: number) {
  const { t } = useI18n();
  const retry = useRef(dictation.onRetry);
  retry.current = dictation.onRetry;

  useEffect(() => {
    if (dictation.status !== "failed" || !dictation.errorMessage) return;
    const onRetry = retry.current;

    toast.error(t("Dictation didn't finish"), {
      id: "dictation-failed",
      description: dictation.errorMessage,
      ...(onRetry ? { action: { label: t("Retry"), onClick: onRetry } } : {}),
    });
  }, [dictation.errorMessage, dictation.status, t]);

  useEffect(() => {
    if (!dictation.stoppedAtLimit || dictation.status !== "transcribing") return;

    toast.info(t("Dictation stopped at {time}", { time: formatDictationElapsed(limitMs / 1000) }), {
      id: "dictation-limit",
      description: t("What you said is being added to the message."),
    });
  }, [dictation.status, dictation.stoppedAtLimit, limitMs, t]);
}
