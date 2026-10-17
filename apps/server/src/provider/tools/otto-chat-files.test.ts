import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { resolveAttachmentPath } from "../../attachment-store.ts";
import { storeChatFile } from "./otto-chat-files.ts";

describe("storeChatFile", () => {
  it.effect(
    "saves any file as a chat attachment, typed by extension, and refuses one over 100 MB",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;

        const attachmentsDir = NodeFS.mkdtempSync(
          NodePath.join(NodeOS.tmpdir(), "otto-chat-files-"),
        );

        const bytes = new TextEncoder().encode("hello");

        const image = yield* storeChatFile(fs, path, attachmentsDir, "thread-1", {
          name: "shot.PNG",
          bytes,
        });

        const report = yield* storeChatFile(fs, path, attachmentsDir, "thread-1", {
          name: "report.md",
          bytes,
        });

        const clip = yield* storeChatFile(fs, path, attachmentsDir, "thread-1", {
          name: "clip.mp4",
          bytes,
        });

        const office = yield* Effect.forEach(
          ["sheet.xlsx", "letter.docx", "bundle.zip", "tool.exe"],
          (name) => storeChatFile(fs, path, attachmentsDir, "thread-1", { name, bytes }),
        );

        const refused = yield* storeChatFile(fs, path, attachmentsDir, "thread-1", {
          name: "huge.zip",
          bytes: new Uint8Array(100_000_001),
        }).pipe(Effect.flip);

        assert.deepStrictEqual(
          [image, report, clip, ...office].map((attachment) => [
            attachment.type,
            attachment.mimeType,
          ]),
          [
            ["image", "image/png"],
            ["file", "text/markdown"],
            ["file", "video/mp4"],
            ["file", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
            ["file", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
            ["file", "application/zip"],
            ["file", "application/octet-stream"],
          ],
        );

        for (const attachment of [image, report, clip, ...office]) {
          const saved = resolveAttachmentPath({ attachmentsDir, attachment });
          assert.strictEqual(saved && NodeFS.readFileSync(saved, "utf8"), "hello");
        }

        assert.include(refused.message, "larger than 100 MB");
        NodeFS.rmSync(attachmentsDir, { force: true, recursive: true });
      }).pipe(Effect.provide(NodeServices.layer)),
  );
});
