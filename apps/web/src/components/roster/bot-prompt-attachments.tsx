import { RiCloseLine } from "@remixicon/react";

import { useI18n } from "../../i18n";
import { cn } from "../../lib/utils";
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
import { attachmentDetails, attachmentLightboxFile } from "./bot-message-attachments";

/** A staged composer file plus the object URL that backs its thumbnail and lightbox preview. */
export interface BotPromptAttachment {
  readonly id: string;
  readonly file: File;
  readonly previewUrl: string;
}

let attachmentSequence = 0;

/**
 * Wraps picked files for the composer strip. Each gets an object URL so its thumbnail and
 * lightbox preview work before any upload starts; the caller owns releasing them.
 */
export function createBotPromptAttachments(files: readonly File[]): BotPromptAttachment[] {
  return files.map((file) => {
    attachmentSequence += 1;

    return {
      id: `bot-prompt-attachment-${attachmentSequence}`,
      file,
      previewUrl: URL.createObjectURL(file),
    };
  });
}

/** Revokes every object URL held by the given attachments. */
export function releaseBotPromptAttachments(attachments: readonly BotPromptAttachment[]): void {
  for (const attachment of attachments) {
    URL.revokeObjectURL(attachment.previewUrl);
  }
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
  /** Files whose preview failed to load show their icon and cannot be opened. */
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
        const failed = failedIds.has(attachment.id);
        const { name, type } = attachment.file;
        const Icon = attachmentLightboxFile({ name, mimeType: type }, null).icon;
        const thumbnail = type.startsWith("image/") && !failed ? attachment.previewUrl : null;

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
                <Icon aria-hidden="true" />
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
            {failed ? null : (
              <AttachmentTrigger
                aria-label={t("Preview {name}", { name: attachment.file.name })}
                className="cursor-zoom-in"
                onClick={() => onExpand(attachment.id)}
              />
            )}
          </Attachment>
        );
      })}
    </div>
  );
}

const NO_FAILED_IDS: ReadonlySet<string> = new Set();
