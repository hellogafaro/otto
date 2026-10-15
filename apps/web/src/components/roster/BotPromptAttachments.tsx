import { RiCloseLine, RiFileLine } from "@remixicon/react";

import { useI18n } from "../../i18n";
import { cn } from "../../lib/utils";
import { buildExpandedImagePreview, type ExpandedImagePreview } from "../chat/ExpandedImagePreview";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "../ui/attachment";
import { attachmentDetails } from "./BotMessageAttachments";

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

/** Otto: Staged files are the shadcn Attachment at xs, like sent ones, with a remove action. */
export function BotPromptAttachments({
  attachments,
  failedIds = NO_FAILED_IDS,
  onExpand,
  onPreviewError,
  onRemove,
  className,
}: {
  attachments: ReadonlyArray<BotPromptAttachment>;
  /** Images whose thumbnail failed to load show the file icon and cannot be expanded. */
  failedIds?: ReadonlySet<string>;
  onExpand: (attachmentId: string) => void;
  onPreviewError: (attachmentId: string) => void;
  onRemove: (attachmentId: string) => void;
  className?: string;
}) {
  const { t } = useI18n();

  if (attachments.length === 0) return null;

  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {attachments.map((attachment) => {
        const thumbnail = failedIds.has(attachment.id) ? null : attachment.previewUrl;

        return (
          <Attachment key={attachment.id} size="xs" data-testid="bot-prompt-attachment">
            <AttachmentMedia variant={thumbnail ? "image" : "icon"}>
              {thumbnail ? (
                <img
                  src={thumbnail}
                  alt={attachment.file.name}
                  draggable={false}
                  onError={() => onPreviewError(attachment.id)}
                />
              ) : (
                <RiFileLine aria-hidden="true" />
              )}
            </AttachmentMedia>
            <AttachmentContent>
              <AttachmentTitle>{attachment.file.name}</AttachmentTitle>
              <AttachmentDescription>
                {attachmentDetails({ name: attachment.file.name, sizeBytes: attachment.file.size })}
              </AttachmentDescription>
            </AttachmentContent>
            <AttachmentActions>
              <AttachmentAction
                aria-label={t("Remove {name}", { name: attachment.file.name })}
                onClick={() => onRemove(attachment.id)}
              >
                <RiCloseLine />
              </AttachmentAction>
            </AttachmentActions>
            {thumbnail ? (
              <AttachmentTrigger
                aria-label={t("Preview {name}", { name: attachment.file.name })}
                className="cursor-zoom-in"
                onClick={() => onExpand(attachment.id)}
              />
            ) : null}
          </Attachment>
        );
      })}
    </div>
  );
}

const NO_FAILED_IDS: ReadonlySet<string> = new Set();
