import * as Schema from "effect/Schema";
import { NonNegativeInt, TrimmedNonEmptyString } from "../base-schemas.ts";

export const PROVIDER_SEND_TURN_MAX_INPUT_CHARS = 120_000;

export const PROVIDER_SEND_TURN_MAX_ATTACHMENTS = 8;

export const PROVIDER_SEND_TURN_MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** Otto: A chat file may be as large as a Library file; files over 10 MB upload by signed URL. */
export const PROVIDER_SEND_TURN_MAX_FILE_BYTES = 100_000_000;

export const PROVIDER_SEND_TURN_SUPPORTED_IMAGE_MIME_TYPES = [
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

const PROVIDER_SEND_TURN_SUPPORTED_IMAGE_MIME_TYPE_SET = new Set<string>(
  PROVIDER_SEND_TURN_SUPPORTED_IMAGE_MIME_TYPES,
);

/** Whether a pasted or picked image mime type can be sent on a provider turn. */
export function isProviderSendTurnSupportedImageMimeType(mimeType: string): boolean {
  return PROVIDER_SEND_TURN_SUPPORTED_IMAGE_MIME_TYPE_SET.has(mimeType.toLowerCase());
}

/**
 * Otto: Every file a person or bot can attach: the model reads images, PDFs and text, and gets
 * the rest (office files, archives, audio, anything else as octet-stream) as its saved path.
 */
export const PROVIDER_SEND_TURN_SUPPORTED_FILE_MIME_TYPES = [
  "application/gzip",
  "application/json",
  "application/msword",
  "application/octet-stream",
  "application/pdf",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/x-tar",
  "application/zip",
  "audio/mpeg",
  "audio/wav",
  "application/toml",
  "application/xml",
  "application/x-yaml",
  "text/csv",
  "text/markdown",
  "text/plain",
  "text/toml",
  "text/xml",
  "text/yaml",
  "video/mp4",
  "video/webm",
] as const;

const PROVIDER_SEND_TURN_SUPPORTED_FILE_MIME_TYPE_SET = new Set<string>(
  PROVIDER_SEND_TURN_SUPPORTED_FILE_MIME_TYPES,
);

export function isProviderSendTurnSupportedFileMimeType(mimeType: string): boolean {
  return PROVIDER_SEND_TURN_SUPPORTED_FILE_MIME_TYPE_SET.has(mimeType.toLowerCase());
}

const PROVIDER_SEND_TURN_MAX_IMAGE_DATA_URL_CHARS = 14_000_000;

const PROVIDER_SEND_TURN_MAX_FILE_DATA_URL_CHARS = 14_000_000;

const CHAT_ATTACHMENT_ID_MAX_CHARS = 128;

const ChatAttachmentId = TrimmedNonEmptyString.check(
  Schema.isMaxLength(CHAT_ATTACHMENT_ID_MAX_CHARS),
  Schema.isPattern(/^[a-z0-9_-]+$/i),
);

export type ChatAttachmentId = typeof ChatAttachmentId.Type;

export const ChatImageAttachment = Schema.Struct({
  type: Schema.Literal("image"),
  id: ChatAttachmentId,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
  mimeType: TrimmedNonEmptyString.check(Schema.isMaxLength(100), Schema.isPattern(/^image\//i)),
  sizeBytes: NonNegativeInt.check(Schema.isLessThanOrEqualTo(PROVIDER_SEND_TURN_MAX_IMAGE_BYTES)),
});

export type ChatImageAttachment = typeof ChatImageAttachment.Type;

const UploadChatImageAttachment = Schema.Struct({
  type: Schema.Literal("image"),
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
  mimeType: TrimmedNonEmptyString.check(Schema.isMaxLength(100), Schema.isPattern(/^image\//i)),
  sizeBytes: NonNegativeInt.check(Schema.isLessThanOrEqualTo(PROVIDER_SEND_TURN_MAX_IMAGE_BYTES)),
  dataUrl: TrimmedNonEmptyString.check(
    Schema.isMaxLength(PROVIDER_SEND_TURN_MAX_IMAGE_DATA_URL_CHARS),
  ),
});

export type UploadChatImageAttachment = typeof UploadChatImageAttachment.Type;

export const ChatFileAttachment = Schema.Struct({
  type: Schema.Literal("file"),
  id: ChatAttachmentId,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
  mimeType: Schema.Literals(PROVIDER_SEND_TURN_SUPPORTED_FILE_MIME_TYPES),
  sizeBytes: NonNegativeInt.check(Schema.isLessThanOrEqualTo(PROVIDER_SEND_TURN_MAX_FILE_BYTES)),
});

export type ChatFileAttachment = typeof ChatFileAttachment.Type;

const UploadChatFileAttachment = Schema.Struct({
  type: Schema.Literal("file"),
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(255)),
  mimeType: Schema.Literals(PROVIDER_SEND_TURN_SUPPORTED_FILE_MIME_TYPES),
  sizeBytes: NonNegativeInt.check(Schema.isLessThanOrEqualTo(PROVIDER_SEND_TURN_MAX_FILE_BYTES)),
  dataUrl: TrimmedNonEmptyString.check(
    Schema.isMaxLength(PROVIDER_SEND_TURN_MAX_FILE_DATA_URL_CHARS),
  ),
});

export type UploadChatFileAttachment = typeof UploadChatFileAttachment.Type;

export const ChatAttachment = Schema.Union([ChatImageAttachment, ChatFileAttachment]);

export type ChatAttachment = typeof ChatAttachment.Type;

export const UploadChatAttachment = Schema.Union([
  UploadChatImageAttachment,
  UploadChatFileAttachment,
]);

export type UploadChatAttachment = typeof UploadChatAttachment.Type;
