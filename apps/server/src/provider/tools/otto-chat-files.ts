import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import type * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import {
  type ChatAttachment,
  PROVIDER_SEND_TURN_MAX_FILE_BYTES,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  type PROVIDER_SEND_TURN_SUPPORTED_FILE_MIME_TYPES,
} from "@otto/contracts";

import { createAttachmentId, resolveAttachmentPath } from "../../attachment-store.ts";

const IMAGE_TYPES = new Map([
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["gif", "image/gif"],
  ["webp", "image/webp"],
]);

const FILE_TYPES = new Map<string, (typeof PROVIDER_SEND_TURN_SUPPORTED_FILE_MIME_TYPES)[number]>([
  ["pdf", "application/pdf"],
  ["json", "application/json"],
  ["csv", "text/csv"],
  ["md", "text/markdown"],
  ["txt", "text/plain"],
  ["log", "text/plain"],
  ["xml", "text/xml"],
  ["yaml", "text/yaml"],
  ["yml", "text/yaml"],
  ["toml", "text/toml"],
]);

export class ChatFileError extends Schema.TaggedErrorClass<ChatFileError>()("ChatFileError", {
  message: Schema.String,
}) {}

/**
 * Saves a file a bot made on its computer as an attachment of this chat, the same way an
 * uploaded file is kept: images, PDFs and text files up to 10 MB.
 */
export const storeChatFile = Effect.fn("storeChatFile")(function* (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  attachmentsDir: string,
  threadId: string,
  file: { readonly name: string; readonly bytes: Uint8Array },
): Effect.fn.Return<ChatAttachment, ChatFileError> {
  const extension = path.extname(file.name).slice(1).toLowerCase();
  const image = IMAGE_TYPES.get(extension);
  const document = FILE_TYPES.get(extension);
  const id = createAttachmentId(threadId);
  const name = file.name.slice(0, 255);
  const sizeBytes = file.bytes.byteLength;

  if (!image && !document) {
    return yield* new ChatFileError({
      message: `${file.name} can't be attached: use an image, a PDF or a text file.`,
    });
  }

  const limit = image ? PROVIDER_SEND_TURN_MAX_IMAGE_BYTES : PROVIDER_SEND_TURN_MAX_FILE_BYTES;

  if (sizeBytes > limit) {
    return yield* new ChatFileError({ message: `${file.name} is larger than 10 MB.` });
  }

  const attachment: ChatAttachment | null =
    id === null
      ? null
      : image
        ? { type: "image", id, name, mimeType: image, sizeBytes }
        : { type: "file", id, name, mimeType: document!, sizeBytes };

  const target = attachment && resolveAttachmentPath({ attachmentsDir, attachment });

  if (!attachment || !target) {
    return yield* new ChatFileError({ message: "This chat can't take attachments." });
  }

  yield* fs.makeDirectory(path.dirname(target), { recursive: true }).pipe(Effect.orDie);
  yield* fs.writeFile(target, file.bytes, { flag: "wx" }).pipe(Effect.orDie);

  return attachment;
});
