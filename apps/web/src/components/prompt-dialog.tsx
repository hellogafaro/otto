import { composerActionIsDictation } from "@otto/client-runtime/dictation";
import { RiArrowUpLine } from "@remixicon/react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { useI18n } from "../i18n";
import { useEnvironmentComposerDictation } from "../lib/use-environment-composer-dictation";
import { DictationControls } from "./chat/dictation-controls";
import { Button } from "./ui/button";
import { Dialog, DialogHeader, DialogPopup, DialogTitle } from "./ui/dialog";
import { Kbd } from "./ui/kbd";
import { toastManager } from "./ui/toast";

interface PromptDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  /**
   * Makes the title editable: an input styled as the title, `title` its placeholder. Left
   * empty, the caller names the result itself.
   */
  readonly titleInput?: {
    readonly value: string;
    readonly onChange: (value: string) => void;
    readonly label: string;
    /** Otto: Opens on the title instead of the prompt, when the title is what must be written. */
    readonly autoFocus?: boolean;
  };
  readonly placeholder: string;
  /** Controls beside the prompt that pick what it goes to, such as a bot. */
  readonly pickers?: ReactNode;
  readonly submitLabel: string;
  /** Whether the pickers are complete enough to send. */
  readonly canSubmit?: boolean;
  /** Otto: Sends with an empty prompt too, when the prompt is an optional description. */
  readonly promptOptional?: boolean;
  readonly onSubmit: (prompt: string) => void;
}

/**
 * Otto: A composer in a dialog: the dialog's title, or an input in its place, and close, a borderless
 * prompt, the caller's pickers at the bottom left and, at the right, the
 * microphone while the prompt is empty or the send button once it has text,
 * as in chat. Enter sends, Shift+Enter adds a line, and a footer shows the
 * Enter and Esc hints. Each opening starts with an empty prompt.
 */
export function PromptDialog({ open, onOpenChange, ...body }: PromptDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-2xl" bottomStickOnMobile={false}>
        <PromptDialogBody {...body} />
      </DialogPopup>
    </Dialog>
  );
}

function PromptDialogBody({
  title,
  titleInput,
  placeholder,
  pickers,
  submitLabel,
  canSubmit = true,
  promptOptional = false,
  onSubmit,
}: Omit<PromptDialogProps, "open" | "onOpenChange">) {
  const { t } = useI18n();
  const draftId = useId();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [prompt, setPrompt] = useState("");
  const ready = canSubmit && (promptOptional || prompt.trim().length > 0);

  const dictation = useEnvironmentComposerDictation({
    threadId: draftId,
    draftId,
    generation: 0,
    getDraft: () => {
      const input = inputRef.current;
      const text = input?.value ?? prompt;
      const start = input?.selectionStart ?? text.length;

      return { text, selection: { start, end: input?.selectionEnd ?? start } };
    },
    applyDraft: (next) => {
      setPrompt(next.text);
      // Restore the caret after React commits the merged value.
      window.requestAnimationFrame(() => {
        const input = inputRef.current;

        if (!input || input.value !== next.text) return;
        input.focus();
        input.setSelectionRange(next.selection.start, next.selection.end);
      });
    },
  });

  useEffect(() => {
    if (dictation.status !== "failed" || !dictation.errorMessage) return;
    toastManager.add({
      type: "error",
      title: t("Could not dictate"),
      description: dictation.errorMessage,
    });
  }, [dictation.errorMessage, dictation.status, t]);

  const showDictation = composerActionIsDictation({
    hasDraft: prompt.trim().length > 0 || ready,
    status: dictation.status,
  });

  return (
    <form
      className="flex flex-col"
      onSubmit={(event) => {
        event.preventDefault();

        if (ready) onSubmit(prompt.trim());
      }}
    >
      <DialogHeader>
        {titleInput ? (
          <>
            <DialogTitle className="sr-only">{title}</DialogTitle>
            <input
              autoFocus={titleInput.autoFocus}
              value={titleInput.value}
              maxLength={80}
              placeholder={title}
              aria-label={titleInput.label}
              className="w-full bg-transparent text-base leading-6 font-medium tracking-title-sm text-foreground outline-none placeholder:text-muted-foreground"
              onChange={(event) => titleInput.onChange(event.currentTarget.value)}
              onKeyDown={(event) => {
                // Enter moves on to the prompt instead of sending a message that is not written yet.
                if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                event.preventDefault();
                inputRef.current?.focus();
              }}
            />
          </>
        ) : (
          <DialogTitle>{title}</DialogTitle>
        )}
      </DialogHeader>
      <textarea
        ref={inputRef}
        autoFocus={!titleInput?.autoFocus}
        value={prompt}
        placeholder={placeholder}
        aria-label={placeholder}
        rows={5}
        className="min-h-32 w-full resize-none bg-transparent px-5 text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground"
        onChange={(event) => setPrompt(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
      />
      <div className="flex items-center justify-between gap-2 px-3 pb-3">
        <div className="flex min-w-0 items-center gap-1">{pickers}</div>
        {showDictation ? (
          <div className="size-7 shrink-0">
            <DictationControls
              appearance="send-slot"
              {...dictation}
              onBlockedPress={(reason) =>
                toastManager.add({
                  type: "info",
                  title: t("Dictation unavailable"),
                  description: reason,
                })
              }
            />
          </div>
        ) : (
          <Button
            type="submit"
            size="icon-sm"
            variant="primary"
            aria-label={submitLabel}
            disabled={!ready}
          >
            <RiArrowUpLine />
          </Button>
        )}
      </div>
      <div className="flex h-10 items-center justify-end gap-3 border-t px-5 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Kbd>↵</Kbd>
          {submitLabel}
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>Esc</Kbd>
          {t("Close")}
        </span>
      </div>
    </form>
  );
}
