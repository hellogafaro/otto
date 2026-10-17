import type { ChatAttachment, EnvironmentId } from "@otto/contracts";

import { useMemo, useState } from "react";

import { useAssetUrls } from "../../assets/asset-urls";
import { useI18n } from "../../i18n";
import { cn } from "../../lib/utils";
import { FileLightbox, type FileLightboxFile, fileLightboxKind } from "../library/file-lightbox";
import {
  Attachment,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "../ui/attachment";

/** The size and type under an attachment's name, like `139 KB · PNG`. */
export function attachmentDetails(attachment: Pick<ChatAttachment, "name" | "sizeBytes">) {
  const type = attachment.name.includes(".") ? (attachment.name.split(".").at(-1) ?? "") : "";

  const size =
    attachment.sizeBytes < 1_024
      ? `${attachment.sizeBytes} B`
      : attachment.sizeBytes < 1_024 * 1_024
        ? `${Math.round(attachment.sizeBytes / 1_024)} KB`
        : `${(attachment.sizeBytes / (1_024 * 1_024)).toFixed(1)} MB`;

  return type ? `${size} · ${type.toUpperCase()}` : size;
}

export function BotMessageAttachments({
  attachments,
  environmentId,
  align = "start",
}: {
  readonly attachments: ReadonlyArray<ChatAttachment>;
  readonly environmentId: EnvironmentId;
  /** Your own message's cards sit at the right, under its bubble. */
  readonly align?: "start" | "end";
}) {
  const { t } = useI18n();

  const resources = useMemo(
    () =>
      attachments.map((attachment) => ({
        _tag: "attachment" as const,
        attachmentId: attachment.id,
      })),
    [attachments],
  );

  const urls = useAssetUrls(environmentId, resources);
  const [failedIds, setFailedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  if (attachments.length === 0) return null;
  const open = openIndex === null ? undefined : attachments[openIndex];
  const openUrl = openIndex === null ? null : (urls[openIndex] ?? null);

  return (
    <>
      <div className={cn("flex flex-wrap gap-1.5", align === "end" && "justify-end")}>
        {attachments.map((attachment, index) => {
          const url = urls[index] ?? null;
          const Icon = attachmentLightboxFile(attachment, url).icon;

          const thumbnail =
            attachment.type === "image" && url !== null && !failedIds.has(attachment.id)
              ? url
              : null;

          return (
            <Attachment key={attachment.id} size="xs" data-testid="bot-message-attachment">
              <AttachmentMedia variant={thumbnail ? "image" : "icon"}>
                {thumbnail ? (
                  <img
                    src={thumbnail}
                    alt=""
                    draggable={false}
                    onError={() => setFailedIds((current) => new Set(current).add(attachment.id))}
                  />
                ) : (
                  <Icon aria-hidden="true" />
                )}
              </AttachmentMedia>
              <AttachmentContent>
                <AttachmentTitle>{attachment.name}</AttachmentTitle>
                <AttachmentDescription>{attachmentDetails(attachment)}</AttachmentDescription>
              </AttachmentContent>
              <AttachmentTrigger
                aria-label={t("Preview {name}", { name: attachment.name })}
                onClick={() => setOpenIndex(index)}
              />
            </Attachment>
          );
        })}
      </div>
      <FileLightbox
        file={open ? attachmentLightboxFile(open, openUrl) : null}
        hasSiblings={attachments.length > 1}
        onPrevious={
          openIndex !== null && openIndex > 0 ? () => setOpenIndex(openIndex - 1) : undefined
        }
        onNext={
          openIndex !== null && openIndex < attachments.length - 1
            ? () => setOpenIndex(openIndex + 1)
            : undefined
        }
        onDownload={() => {
          if (open && openUrl) downloadAttachment(openUrl, open.name);
        }}
        onClose={() => setOpenIndex(null)}
      />
    </>
  );
}

/**
 * Otto: Every chat attachment, sent or staged, is an attachment card that opens the Library's
 * file lightbox, with its kind and icon from `fileLightboxKind`.
 */
export function attachmentLightboxFile(
  attachment: { readonly name: string; readonly mimeType: string },
  url: string | null,
): FileLightboxFile {
  return { title: attachment.name, url, ...fileLightboxKind(attachment.name, attachment.mimeType) };
}

export function downloadAttachment(url: string, name: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
}
