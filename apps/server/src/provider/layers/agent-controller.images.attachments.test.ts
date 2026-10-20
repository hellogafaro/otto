import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { ProviderDriverKind } from "@otto/contracts";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { describe, expect } from "vite-plus/test";
import { inlineTextFile } from "../chat-history.ts";
import { oversizedImageNote } from "../chat-history.ts";
import { AgentController } from "../services/agent-controller.ts";
import {
  codexThreadId,
  codexInstanceId,
  codexSelection,
} from "./test-support/agent-controller-fixtures.ts";
import {
  makeBridge,
  provideController,
  resolveCodex,
} from "./test-support/agent-controller-layers.ts";
import { mastraHarnessFixture } from "./test-support/agent-controller-harness.ts";

describe("AgentControllerLive", () => {
  it.effect("reads persisted image attachments for Mastra turns", () => {
    const bridge = makeBridge();
    const mastra = mastraHarnessFixture();
    const baseDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "otto-mastra-image-"));
    const attachmentsDir = NodePath.join(baseDir, "userdata", "attachments");
    NodeFS.mkdirSync(attachmentsDir, { recursive: true });
    NodeFS.writeFileSync(NodePath.join(attachmentsDir, "image-1.png"), "image");

    return provideController(
      Effect.gen(function* () {
        const controller = yield* AgentController;
        yield* resolveCodex(controller);
        yield* controller.startSession(codexThreadId, {
          threadId: codexThreadId,
          provider: ProviderDriverKind.make("codex"),
          providerInstanceId: codexInstanceId,
          cwd: process.cwd(),
          modelSelection: codexSelection,
          runtimeMode: "full-access",
        });
        yield* controller.sendTurn({
          threadId: codexThreadId,
          input: "Inspect this image.",
          attachments: [
            {
              type: "image",
              id: "image-1",
              name: "screenshot.png",
              mimeType: "image/png",
              sizeBytes: 5,
            },
          ],
        });

        expect(mastra.sendMessage).toHaveBeenCalledWith({
          content: `Inspect this image.\n\n[Attached image "screenshot.png" is saved at: ${NodePath.join(attachmentsDir, "image-1.png")}]`,
          files: [
            {
              data: "aW1hZ2U=",
              mediaType: "image/png",
              filename: "screenshot.png",
            },
          ],
        });
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => NodeFS.rmSync(baseDir, { recursive: true, force: true })),
        ),
      ),
      bridge.service,
      mastra.factory,
      undefined,
      baseDir,
    );
  });

  it.effect("sends a note instead of a stored image larger than models take", () => {
    const bridge = makeBridge();
    const mastra = mastraHarnessFixture();
    const baseDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "otto-mastra-large-image-"));
    const attachmentsDir = NodePath.join(baseDir, "userdata", "attachments");
    const ihdr = Buffer.alloc(8);
    ihdr.writeUInt32BE(4112, 0);
    ihdr.writeUInt32BE(2658, 4);

    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]),
      Buffer.from("IHDR"),
      ihdr,
    ]);

    NodeFS.mkdirSync(attachmentsDir, { recursive: true });
    NodeFS.writeFileSync(NodePath.join(attachmentsDir, "image-1.png"), png);

    return provideController(
      Effect.gen(function* () {
        const controller = yield* AgentController;
        yield* resolveCodex(controller);
        yield* controller.startSession(codexThreadId, {
          threadId: codexThreadId,
          provider: ProviderDriverKind.make("codex"),
          providerInstanceId: codexInstanceId,
          cwd: process.cwd(),
          modelSelection: codexSelection,
          runtimeMode: "full-access",
        });
        yield* controller.sendTurn({
          threadId: codexThreadId,
          input: "Inspect this image.",
          attachments: [
            {
              type: "image",
              id: "image-1",
              name: "screenshot.png",
              mimeType: "image/png",
              sizeBytes: 28,
            },
          ],
        });

        const note = oversizedImageNote(png.toString("base64"));

        expect(note).toContain("[The image is 4112×2658 pixels, so it was left out");
        // No `files`: the image bytes stay out of the request.
        expect(mastra.sendMessage).toHaveBeenCalledWith({
          content: [
            "Inspect this image.",
            `[Attached image "screenshot.png" is saved at: ${NodePath.join(attachmentsDir, "image-1.png")}]`,
            note,
          ].join("\n\n"),
        });
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => NodeFS.rmSync(baseDir, { recursive: true, force: true })),
        ),
      ),
      bridge.service,
      mastra.factory,
      undefined,
      baseDir,
    );
  });

  it.effect("sends a text attachment as text, which every model reads", () => {
    const bridge = makeBridge();
    const mastra = mastraHarnessFixture();
    const baseDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "otto-mastra-text-"));
    const attachmentsDir = NodePath.join(baseDir, "userdata", "attachments");
    NodeFS.mkdirSync(attachmentsDir, { recursive: true });
    NodeFS.writeFileSync(NodePath.join(attachmentsDir, "file-1.json"), '{"codename":"HERON"}');

    return provideController(
      Effect.gen(function* () {
        const controller = yield* AgentController;
        yield* resolveCodex(controller);
        yield* controller.startSession(codexThreadId, {
          threadId: codexThreadId,
          provider: ProviderDriverKind.make("codex"),
          providerInstanceId: codexInstanceId,
          cwd: process.cwd(),
          modelSelection: codexSelection,
          runtimeMode: "full-access",
        });
        yield* controller.sendTurn({
          threadId: codexThreadId,
          input: "What is the codename?",
          attachments: [
            {
              type: "file",
              id: "file-1",
              name: "project.json",
              mimeType: "application/json",
              sizeBytes: 20,
            },
          ],
        });

        expect(mastra.sendMessage).toHaveBeenCalledWith({
          content: [
            "What is the codename?",
            `[Attached file "project.json" is saved at: ${NodePath.join(attachmentsDir, "file-1.json")}]`,
            '[File: project.json]\n```\n{"codename":"HERON"}\n```',
          ].join("\n\n"),
        });
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => NodeFS.rmSync(baseDir, { recursive: true, force: true })),
        ),
      ),
      bridge.service,
      mastra.factory,
      undefined,
      baseDir,
    );
  });

  it.effect("sends a long text file as its first lines, so it can't overflow the model", () => {
    const bridge = makeBridge();
    const mastra = mastraHarnessFixture();
    const baseDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "otto-mastra-csv-"));
    const attachmentsDir = NodePath.join(baseDir, "userdata", "attachments");
    NodeFS.mkdirSync(attachmentsDir, { recursive: true });

    const csv = Array.from(
      { length: 10_000 },
      (_, row) => `"10/19/2026","https://example.com/?gclid=${row}"`,
    ).join("\n");

    NodeFS.writeFileSync(NodePath.join(attachmentsDir, "file-1.csv"), csv);

    return provideController(
      Effect.gen(function* () {
        const controller = yield* AgentController;
        yield* resolveCodex(controller);
        yield* controller.startSession(codexThreadId, {
          threadId: codexThreadId,
          provider: ProviderDriverKind.make("codex"),
          providerInstanceId: codexInstanceId,
          cwd: process.cwd(),
          modelSelection: codexSelection,
          runtimeMode: "full-access",
        });
        yield* controller.sendTurn({
          threadId: codexThreadId,
          input: "Here you go.",
          attachments: [
            {
              type: "file",
              id: "file-1",
              name: "sessions.csv",
              mimeType: "text/csv",
              sizeBytes: csv.length,
            },
          ],
        });

        expect(mastra.sendMessage).toHaveBeenCalledWith({
          content: [
            "Here you go.",
            `[Attached file "sessions.csv" is saved at: ${NodePath.join(attachmentsDir, "file-1.csv")}]`,
            inlineTextFile("sessions.csv", csv),
          ].join("\n\n"),
        });
        expect(inlineTextFile("sessions.csv", csv)).toContain("(too long to send whole: its first");
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => NodeFS.rmSync(baseDir, { recursive: true, force: true })),
        ),
      ),
      bridge.service,
      mastra.factory,
      undefined,
      baseDir,
    );
  });

  it.effect("sends XML as text too, since models only read images and PDFs as files", () => {
    const bridge = makeBridge();
    const mastra = mastraHarnessFixture();
    const baseDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "otto-mastra-xml-"));
    const attachmentsDir = NodePath.join(baseDir, "userdata", "attachments");
    NodeFS.mkdirSync(attachmentsDir, { recursive: true });
    NodeFS.writeFileSync(NodePath.join(attachmentsDir, "file-1.xml"), "<codename>HERON</codename>");

    return provideController(
      Effect.gen(function* () {
        const controller = yield* AgentController;
        yield* resolveCodex(controller);
        yield* controller.startSession(codexThreadId, {
          threadId: codexThreadId,
          provider: ProviderDriverKind.make("codex"),
          providerInstanceId: codexInstanceId,
          cwd: process.cwd(),
          modelSelection: codexSelection,
          runtimeMode: "full-access",
        });
        yield* controller.sendTurn({
          threadId: codexThreadId,
          input: "What is the codename?",
          attachments: [
            {
              type: "file",
              id: "file-1",
              name: "brief.xml",
              mimeType: "application/xml",
              sizeBytes: 20,
            },
          ],
        });

        expect(mastra.sendMessage).toHaveBeenCalledWith({
          content: [
            "What is the codename?",
            `[Attached file "brief.xml" is saved at: ${NodePath.join(attachmentsDir, "file-1.xml")}]`,
            "[File: brief.xml]\n```\n<codename>HERON</codename>\n```",
          ].join("\n\n"),
        });
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => NodeFS.rmSync(baseDir, { recursive: true, force: true })),
        ),
      ),
      bridge.service,
      mastra.factory,
      undefined,
      baseDir,
    );
  });

  it.effect("sends only a video's path, never its bytes as text", () => {
    const bridge = makeBridge();
    const mastra = mastraHarnessFixture();
    const baseDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "otto-mastra-video-"));
    const attachmentsDir = NodePath.join(baseDir, "userdata", "attachments");
    NodeFS.mkdirSync(attachmentsDir, { recursive: true });
    NodeFS.writeFileSync(NodePath.join(attachmentsDir, "file-1.mp4"), "ftypisom");

    return provideController(
      Effect.gen(function* () {
        const controller = yield* AgentController;
        yield* resolveCodex(controller);
        yield* controller.startSession(codexThreadId, {
          threadId: codexThreadId,
          provider: ProviderDriverKind.make("codex"),
          providerInstanceId: codexInstanceId,
          cwd: process.cwd(),
          modelSelection: codexSelection,
          runtimeMode: "full-access",
        });
        yield* controller.sendTurn({
          threadId: codexThreadId,
          input: "Watch this.",
          attachments: [
            {
              type: "file",
              id: "file-1",
              name: "clip.mp4",
              mimeType: "video/mp4",
              sizeBytes: 8,
            },
          ],
        });

        expect(mastra.sendMessage).toHaveBeenCalledWith({
          content: `Watch this.\n\n[Attached file "clip.mp4" is saved at: ${NodePath.join(attachmentsDir, "file-1.mp4")}]`,
        });
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => NodeFS.rmSync(baseDir, { recursive: true, force: true })),
        ),
      ),
      bridge.service,
      mastra.factory,
      undefined,
      baseDir,
    );
  });
});
