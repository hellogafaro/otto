import { recordLookup } from "../record-lookup";
import {
  isProviderSendTurnSupportedFileMimeType,
  isProviderSendTurnSupportedImageMimeType,
  PROVIDER_SEND_TURN_MAX_FILE_BYTES,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  type UploadChatFileAttachment,
  type UploadChatImageAttachment,
} from "@otto/contracts";

const FILE_MIME_BY_EXTENSION = {
  csv: "text/csv",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  gz: "application/gzip",
  json: "application/json",
  log: "text/plain",
  markdown: "text/markdown",
  md: "text/markdown",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  pdf: "application/pdf",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  tar: "application/x-tar",
  tgz: "application/gzip",
  toml: "application/toml",
  txt: "text/plain",
  wav: "audio/wav",
  webm: "video/webm",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xml: "application/xml",
  yaml: "application/x-yaml",
  yml: "application/x-yaml",
  zip: "application/zip",
} as const satisfies Readonly<Record<string, UploadChatFileAttachment["mimeType"]>>;

export type BotFileAttachmentKind =
  | Pick<UploadChatFileAttachment, "mimeType" | "type">
  | Pick<UploadChatImageAttachment, "mimeType" | "type">;

export function resolveBotFileAttachment(
  file: Pick<File, "name" | "size" | "type">,
): BotFileAttachmentKind | null {
  const declaredMimeType = file.type.trim().toLowerCase();

  if (isProviderSendTurnSupportedImageMimeType(declaredMimeType)) {
    return file.size > 0 && file.size <= PROVIDER_SEND_TURN_MAX_IMAGE_BYTES
      ? { type: "image", mimeType: declaredMimeType }
      : null;
  }

  const extension = file.name.split(".").at(-1)?.toLowerCase() ?? "";

  const mimeType =
    recordLookup(FILE_MIME_BY_EXTENSION, extension) ??
    (isProviderSendTurnSupportedFileMimeType(declaredMimeType)
      ? declaredMimeType
      : "application/octet-stream");

  // SAFETY: the MIME value comes from the literal supported extension table, the supported-file guard or octet-stream.
  return file.size > 0 && file.size <= PROVIDER_SEND_TURN_MAX_FILE_BYTES
    ? { type: "file", mimeType: mimeType as UploadChatFileAttachment["mimeType"] }
    : null;
}
