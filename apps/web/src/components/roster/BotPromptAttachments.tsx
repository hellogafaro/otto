import { RiCloseLine, RiFileLine } from "@remixicon/react";

import { useI18n } from "../../i18n";
import { cn } from "../../lib/utils";
import { buildExpandedImagePreview, type ExpandedImagePreview } from "../chat/ExpandedImagePreview";

/** A staged composer file plus the object URL that backs its live thumbnail. */
export interface BotPromptAttachment {
  readonly id: string;
  readonly file: File;
  readonly previewUrl: string | null;
}

let attachmentSequence = 0;

/**
 * Wraps picked files for the composer strip. Images get an object URL so the
 * thumbnail renders before any upload starts; the caller owns releasing them.
 */
export function createBotPromptAttachments(files: readonly File[]): BotPromptAttachment[] {
  return files.map((file) => {
    attachmentSequence += 1;

    return {
      id: `bot-prompt-attachment-${attachmentSequence}`,
      file,
      previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
    };
  });
}

/** Revokes every object URL held by the given attachments. */
export function releaseBotPromptAttachments(attachments: readonly BotPromptAttachment[]): void {
  for (const attachment of attachments) {
    if (attachment.previewUrl !== null) {
      URL.revokeObjectURL(attachment.previewUrl);
    }
  }
}

/** Builds the lightbox payload so expanding one thumbnail can page the rest. */
export function buildBotPromptAttachmentPreview(
  attachments: readonly BotPromptAttachment[],
  attachmentId: string,
  failedAttachmentIds: ReadonlySet<string> = new Set(),
): ExpandedImagePreview | null {
  return buildExpandedImagePreview(
    attachments.map((attachment) => ({
      id: attachment.id,
      name: attachment.file.name,
      ...(attachment.previewUrl !== null && !failedAttachmentIds.has(attachment.id)
        ? { previewUrl: attachment.previewUrl }
        : {}),
    })),
    attachmentId,
  );
}

export function BotPromptAttachments({
  attachments,
  onExpand,
  onPreviewError,
  onRemove,
  className,
}: {
  attachments: ReadonlyArray<BotPromptAttachment>;
  onExpand: (attachmentId: string) => void;
  onPreviewError: (attachmentId: string) => void;
  onRemove: (attachmentId: string) => void;
  className?: string;
}) {
  const { t } = useI18n();

  if (attachments.length === 0) return null;

  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {attachments.map((attachment) => (
        <div
          key={attachment.id}
          data-testid="bot-prompt-attachment"
          className="relative size-16 shrink-0 overflow-hidden rounded-md border border-on-solid/10 bg-background/65"
        >
          {attachment.previewUrl !== null ? (
            <button
              type="button"
              aria-label={t("Preview {name}", { name: attachment.file.name })}
              className="size-full cursor-zoom-in"
              onClick={() => onExpand(attachment.id)}
            >
              <img
                src={attachment.previewUrl}
                alt={attachment.file.name}
                className="size-full object-cover"
                draggable={false}
                onError={(event) => {
                  onPreviewError(attachment.id);
                  event.currentTarget.hidden = true;
                  event.currentTarget.nextElementSibling?.removeAttribute("hidden");
                  event.currentTarget.closest("button")?.setAttribute("disabled", "");
                }}
              />
              <span hidden className="block size-full">
                <AttachmentFileFace name={attachment.file.name} />
              </span>
            </button>
          ) : (
            <AttachmentFileFace name={attachment.file.name} />
          )}
          <button
            type="button"
            aria-label={t("Remove {name}", { name: attachment.file.name })}
            onClick={() => onRemove(attachment.id)}
            className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-background/80 text-muted-foreground hover:bg-background hover:text-foreground"
          >
            <RiCloseLine className="size-3" />
          </button>
        </div>
      ))}
    </div>
  );
}

/** A file tile's face: an icon over the name, kept clear of the corner remove button. */
function AttachmentFileFace({ name }: { name: string }) {
  return (
    <span className="flex size-full flex-col items-center justify-end gap-1 px-1 pb-1.5 text-muted-foreground">
      <RiFileLine aria-hidden="true" className="size-4 shrink-0" />
      <span className="line-clamp-2 w-full break-words text-center text-10px leading-tight">
        {name}
      </span>
    </span>
  );
}
