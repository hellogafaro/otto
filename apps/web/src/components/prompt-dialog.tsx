import { composerActionIsDictation } from "@otto/client-runtime/dictation";
import { PROVIDER_SEND_TURN_MAX_ATTACHMENTS } from "@otto/contracts";
import { RiArrowUpLine, RiAttachmentLine } from "@remixicon/react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { useI18n } from "../i18n";
import { useEnvironmentComposerDictation } from "../lib/use-environment-composer-dictation";
import { cn } from "../lib/utils";
import { ComposerControl, ComposerControlIcon } from "./chat/composer-control";
import { DictationControls } from "./chat/dictation-controls";
import { DictationRecordingBar, isDictating } from "./chat/dictation-recording-bar";
import { useDictationToasts } from "./chat/use-dictation-toasts";
import { DICTATION_LIMIT_MS } from "../lib/use-composer-dictation";
import { fileDropHandlers } from "./chat/workspace-file-drop";
import { FileLightbox } from "./library/file-lightbox";
import { attachmentLightboxFile, downloadAttachment } from "./roster/bot-message-attachments";
import { resolveBotFileAttachment } from "./roster/bot-file-attachment";
import {
  BotPromptAttachments,
  createBotPromptAttachments,
  releaseBotPromptAttachments,
  type BotPromptAttachment,
} from "./roster/bot-prompt-attachments";
import { Button } from "./ui/button";
import { Dialog, DialogHeader, DialogPopup, DialogTitle } from "./ui/dialog";
import { Kbd } from "./ui/kbd";
import { toast } from "sonner";

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
  /** Otto: Takes files too, picked, pasted or dropped, sent with the prompt. */
  readonly attachable?: boolean;
  readonly onSubmit: (prompt: string, files: readonly File[]) => void;
}

/**
 * Otto: A composer in a dialog: the dialog's title, or an input in its place, and close, a borderless
 * prompt, the caller's pickers at the bottom left and, at the right, the
 * microphone while the prompt is empty or the send button once it has text,
 * as in chat. Enter sends, Shift+Enter adds a line, and a footer shows the
 * Enter and Esc hints. Each opening starts with an empty prompt. An attachable
 * dialog also takes as many files as a chat message, shown above the prompt.
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
  attachable = false,
  onSubmit,
}: Omit<PromptDialogProps, "open" | "onOpenChange">) {
  const { t } = useI18n();
  const draftId = useId();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [prompt, setPrompt] = useState("");
  const files = usePromptFiles();
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

  useDictationToasts(dictation, DICTATION_LIMIT_MS);
  const dictating = isDictating(dictation.status);

  const showDictation = composerActionIsDictation({
    hasDraft: prompt.trim().length > 0 || ready,
    // A failed dictation is retried from its toast, so it gives the slot back, as in chat.
    status: dictation.status === "failed" ? "idle" : dictation.status,
  });

  const addFiles = (picked: Iterable<File>) => {
    const all = Array.from(picked);
    const supported = all.filter((file) => resolveBotFileAttachment(file) !== null);

    if (supported.length < all.length) toast.error(t("Some files can't be attached"));

    if (!files.add(supported)) {
      toast.error(
        t("You can attach up to {count} files", {
          count: PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
        }),
      );
    }
  };

  const dropHandlers = attachable
    ? fileDropHandlers({ setDragActive: files.setDragging, addFiles })
    : {};

  return (
    <form
      className={cn("flex flex-col", files.dragging && "outline-2 -outline-offset-2 outline-ring")}
      {...dropHandlers}
      onSubmit={(event) => {
        event.preventDefault();

        if (ready) {
          onSubmit(
            prompt.trim(),
            files.items.map((item) => item.file),
          );
        }
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
      <BotPromptAttachments
        attachments={files.items}
        failedIds={files.failedIds}
        className="px-5 pb-2"
        onExpand={files.setExpandedId}
        onPreviewError={files.markFailed}
        onRemove={files.remove}
      />
      <textarea
        ref={inputRef}
        autoFocus={!titleInput?.autoFocus}
        value={prompt}
        placeholder={placeholder}
        aria-label={placeholder}
        rows={5}
        className="min-h-32 w-full resize-none bg-transparent px-5 text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground"
        onChange={(event) => setPrompt(event.currentTarget.value)}
        onPaste={(event) => {
          if (attachable && event.clipboardData.files.length > 0) {
            addFiles(event.clipboardData.files);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
      />
      {/* Otto: Controls keep their full labels and wrap onto another line instead of cropping. */}
      <div
        className={cn(
          "flex justify-between gap-2 px-3 pb-3",
          dictating ? "items-center" : "items-end",
        )}
      >
        {dictating ? (
          <DictationRecordingBar stream={dictation.stream} onCancel={dictation.onCancel} />
        ) : (
          <div className="flex min-w-0 flex-wrap items-center gap-1 *:shrink-0">
            {attachable ? (
              <ComposerControl
                size="icon-sm"
                aria-label={t("Attach file")}
                onClick={() => fileInputRef.current?.click()}
              >
                <ComposerControlIcon icon={RiAttachmentLine} />
              </ComposerControl>
            ) : null}
            {pickers}
          </div>
        )}
        {showDictation ? (
          <div className="size-7 shrink-0">
            <DictationControls
              appearance="send-slot"
              {...dictation}
              onBlockedPress={() => toast.info(t("Dictation isn't available"))}
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
      {attachable ? (
        <>
          <input
            ref={fileInputRef}
            type="file"
            aria-label={t("Attach files")}
            multiple
            className="sr-only"
            onChange={(event) => {
              if (event.currentTarget.files) addFiles(event.currentTarget.files);
              event.currentTarget.value = "";
            }}
          />
          <FileLightbox
            file={
              files.expanded
                ? attachmentLightboxFile(
                    {
                      name: files.expanded.file.name,
                      mimeType: files.expanded.file.type,
                    },
                    files.expanded.previewUrl,
                  )
                : null
            }
            hasSiblings={false}
            onDownload={() => {
              if (files.expanded) {
                downloadAttachment(files.expanded.previewUrl, files.expanded.file.name);
              }
            }}
            onClose={() => files.setExpandedId(null)}
          />
        </>
      ) : null}
    </form>
  );
}

/**
 * Otto: The dialog's staged files, each with an object URL for its chip and preview, all
 * released when the dialog closes. Going past a message's file limit adds none of them.
 */
function usePromptFiles() {
  const [items, setItems] = useState<BotPromptAttachment[]>([]);
  const [failedIds, setFailedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const itemsRef = useRef<BotPromptAttachment[]>([]);

  useEffect(() => () => releaseBotPromptAttachments(itemsRef.current), []);

  const replace = (next: BotPromptAttachment[]) => {
    itemsRef.current = next;
    setItems(next);
  };

  return {
    items,
    failedIds,
    dragging,
    setDragging,
    expanded: items.find((item) => item.id === expandedId),
    setExpandedId,
    markFailed: (id: string) => setFailedIds((current) => new Set(current).add(id)),
    add: (files: readonly File[]): boolean => {
      if (itemsRef.current.length + files.length > PROVIDER_SEND_TURN_MAX_ATTACHMENTS) return false;
      replace([...itemsRef.current, ...createBotPromptAttachments(files)]);

      return true;
    },
    remove: (id: string) => {
      releaseBotPromptAttachments(itemsRef.current.filter((item) => item.id === id));
      replace(itemsRef.current.filter((item) => item.id !== id));

      if (expandedId === id) setExpandedId(null);
    },
  };
}
