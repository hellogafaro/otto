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
  it.effect("saves an image and a text file as chat attachments and refuses other files", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const attachmentsDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "otto-chat-files-"));
      const bytes = new TextEncoder().encode("hello");

      const image = yield* storeChatFile(fs, path, attachmentsDir, "thread-1", {
        name: "shot.PNG",
        bytes,
      });

      const report = yield* storeChatFile(fs, path, attachmentsDir, "thread-1", {
        name: "report.md",
        bytes,
      });

      const refused = yield* storeChatFile(fs, path, attachmentsDir, "thread-1", {
        name: "tool.exe",
        bytes,
      }).pipe(Effect.flip);

      assert.deepStrictEqual(
        [image.type, image.mimeType, report.type, report.mimeType],
        ["image", "image/png", "file", "text/markdown"],
      );

      for (const attachment of [image, report]) {
        const saved = resolveAttachmentPath({ attachmentsDir, attachment });
        assert.strictEqual(saved && NodeFS.readFileSync(saved, "utf8"), "hello");
      }

      assert.include(refused.message, "can't be attached");
      NodeFS.rmSync(attachmentsDir, { force: true, recursive: true });
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
