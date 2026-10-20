import type { MastraDBMessage } from "@mastra/core/agent-controller";
import { MODEL_IMAGE_MAX_SIDE } from "@otto/shared/imageDimensions";
import { describe, expect, it } from "vite-plus/test";

import { GROUP_NO_REPLY, groupTurnNote } from "../orchestration/group-responder.ts";
import {
  inlineTextFile,
  MODEL_FILE_MAX_BYTES,
  MODEL_TEXT_MAX_CHARS,
  MODEL_TEXT_PREVIEW_CHARS,
  modelReadsAttachment,
  OTTO_CHECKPOINT,
  oversizedImageNote,
  projectHistory,
} from "./chat-history.ts";

let clock = Date.parse("2026-09-13T12:00:00.000Z");

const message = (id: string, role: MastraDBMessage["role"], text = id): MastraDBMessage =>
  ({
    id,
    role,
    content: { format: 2, parts: [{ type: "text", text }] },
    createdAt: new Date((clock += 1_000)),
    threadId: "thread-1",
    resourceId: "thread-1",
  }) as MastraDBMessage;

const signal = (id: string, text = id, type = "user"): MastraDBMessage =>
  ({
    ...message(id, "signal", text),
    content: {
      format: 2,
      parts: [{ type: "text", text }],
      metadata: { signal: { id, type, tagName: type } },
    },
  }) as MastraDBMessage;

const checkpoint = (id: string, firstKeptMessageId: string): MastraDBMessage =>
  ({
    ...message(id, "assistant", `<checkpoint>${id}</checkpoint>`),
    content: {
      format: 2,
      parts: [{ type: "text", text: `<checkpoint>${id}</checkpoint>` }],
      metadata: {
        [OTTO_CHECKPOINT]: {
          firstKeptMessageId,
          tokensBefore: 370_000,
          model: "openai/gpt-6.1-sol",
          createdAt: "2026-10-17T10:00:00.000Z",
        },
      },
    },
  }) as MastraDBMessage;

const turns = (count: number, prefix = "") =>
  Array.from({ length: count }, (_, index) => [
    message(`${prefix}user-${index}`, "user"),
    message(`${prefix}assistant-${index}`, "assistant"),
  ]).flat();

/** The header of a PNG this size, which is all a size check reads. */
const png = (width: number, height: number) => {
  const bytes = Buffer.alloc(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "latin1");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);

  return bytes.toString("base64");
};

const screenshot = (id: string, data: string): MastraDBMessage =>
  ({
    ...message(id, "assistant"),
    content: {
      format: 2,
      parts: [
        {
          type: "tool-invocation",
          toolInvocation: {
            state: "result",
            toolCallId: `${id}-call`,
            toolName: "read",
            args: { path: "/tmp/shot.png" },
            result: { __workspaceMedia: true, text: "/tmp/shot.png", mediaType: "image/png", data },
          },
          providerMetadata: {
            mastra: {
              modelOutput: {
                type: "content",
                value: [
                  { type: "text", text: "/tmp/shot.png" },
                  { type: "media", data, mediaType: "image/png" },
                ],
              },
            },
          },
        },
      ],
    },
  }) as MastraDBMessage;

const ids = (messages: ReadonlyArray<MastraDBMessage>) => messages.map(({ id }) => id);

describe("projectHistory", () => {
  it("sends every complete turn, however long the chat", () => {
    const history = turns(500);

    expect(ids(projectHistory(history))).toEqual(ids(history));
  });

  it("leaves out saved files no model reads, so they can't fail later turns", () => {
    const withFile = (id: string, mimeType: string): MastraDBMessage =>
      ({
        ...message(id, "user"),
        content: {
          format: 2,
          parts: [
            { type: "text", text: id },
            { type: "file", mimeType, data: "AAAA" },
          ],
        },
      }) as MastraDBMessage;

    const parts = projectHistory([
      withFile("text", "text/plain"),
      message("first-answer", "assistant"),
      withFile("image", "image/png"),
      message("second-answer", "assistant"),
    ]).map((entry) => entry.content.parts.map((part) => part.type));

    expect(parts).toEqual([["text"], ["text"], ["text", "file"], ["text"]]);
  });

  it("sends a long text file stored whole by an older Otto as its preview, so the chat continues", () => {
    const csv = Array.from(
      { length: 20_000 },
      (_, row) => `${row},https://example.com/?gclid=${row}`,
    ).join("\n");

    const stored = `Here you go.\n\n[Attached file "sessions.csv" is saved at: /data/a.csv]\n\n[File: sessions.csv]\n\`\`\`\n${csv}\n\`\`\``;
    const small = "[File: small.csv]\n```\n0,a\n```";

    const [sent, , kept] = projectHistory([
      signal("user-csv", stored),
      message("answer-csv", "assistant"),
      signal("user-small", `${small}\n\n${"x".repeat(MODEL_TEXT_MAX_CHARS)}`),
      message("answer-small", "assistant"),
    ]).map((entry) => (entry.content.parts[0] as { text: string }).text);

    expect(sent).toBe(
      `Here you go.\n\n[Attached file "sessions.csv" is saved at: /data/a.csv]\n\n${inlineTextFile("sessions.csv", csv)}`,
    );
    expect(sent!.length).toBeLessThan(MODEL_TEXT_PREVIEW_CHARS + 500);
    expect(kept).toBe(`${small}\n\n${"x".repeat(MODEL_TEXT_MAX_CHARS)}`);
  });

  it("sends a screenshot read before images were capped as a note, so the chat continues", () => {
    // Stored the way Mastra keeps a read tool's image: `media`, not the `image-data` it returned.
    const outputs = projectHistory([
      message("user-shots", "user"),
      screenshot("big", png(1280, 6000)),
      screenshot("small", png(1280, 800)),
      message("answer-shots", "assistant"),
    ]).map((entry) => {
      const part = entry.content.parts[0] as {
        providerMetadata?: { mastra?: { modelOutput?: { value: unknown[] } } };
      };

      return part.providerMetadata?.mastra?.modelOutput?.value;
    });

    expect(outputs[1]).toEqual([
      { type: "text", text: "/tmp/shot.png" },
      { type: "text", text: oversizedImageNote(png(1280, 6000)) },
    ]);
    expect(outputs[2]).toEqual([
      { type: "text", text: "/tmp/shot.png" },
      { type: "media", data: png(1280, 800), mediaType: "image/png" },
    ]);
  });

  it("drops a turn that never got an answer", () => {
    expect(
      ids(
        projectHistory([
          message("user-complete", "user", "complete question"),
          message("assistant-complete", "assistant", "complete answer"),
          message("user-interrupted", "user", "interrupted question"),
          message("user-next", "user"),
          message("assistant-next", "assistant"),
        ]),
      ),
    ).toEqual(["user-complete", "assistant-complete", "user-next", "assistant-next"]);
  });

  it("starts a turn at each user signal and keeps a reminder inside its turn", () => {
    const history = [
      signal("user"),
      signal("reminder", "keep going", "system-reminder"),
      message("assistant", "assistant"),
      signal("unanswered"),
    ];

    expect(ids(projectHistory(history))).toEqual(["user", "reminder", "assistant"]);
  });

  it("starts a turn at each task event and keeps the task state inside its turn", () => {
    const history = [
      signal("user"),
      message("answer", "assistant"),
      signal("comment", "is this ready?", "notification"),
      signal("task", "Title: Launch", "state"),
      message("reply", "assistant"),
      signal("assignment", "", "notification"),
    ];

    expect(ids(projectHistory(history))).toEqual(["user", "answer", "comment", "task", "reply"]);
  });

  it("drops group passes but keeps the message nobody answered", () => {
    const history = [
      signal("person", "Ana: @Ivy what is 7 times 8?"),
      message("first-pass", "assistant", GROUP_NO_REPLY),
      signal("note", groupTurnNote("plain")),
      message("second-pass", "assistant", ` ${GROUP_NO_REPLY}\n`),
      signal("handoff", `Ana: hi\n\n${groupTurnNote("handoff", "Axo")}`),
      message("answer", "assistant", "Hi Ana."),
    ];

    expect(ids(projectHistory(history))).toEqual(["person", "handoff", "answer"]);
  });

  it("starts from the newest checkpoint, sent as a user message before the first kept turn", () => {
    const early = turns(3, "early-");
    const middle = turns(3, "middle-");
    const late = turns(2, "late-");

    const projected = projectHistory([
      ...early,
      checkpoint("checkpoint-1", "early-user-1"),
      ...middle,
      checkpoint("checkpoint-2", "middle-user-2"),
      ...late,
    ]);

    expect(ids(projected)).toEqual([
      "checkpoint-2",
      "middle-user-2",
      "middle-assistant-2",
      ...ids(late),
    ]);
    expect(projected[0]?.role).toBe("user");
    expect(projected[0]!.createdAt.getTime()).toBeLessThan(projected[1]!.createdAt.getTime());
  });

  it("ignores a checkpoint whose first kept message is gone", () => {
    const history = turns(3);

    expect(ids(projectHistory([...history, checkpoint("lost", "rolled-back")]))).toEqual(
      ids(history),
    );
  });

  it("renders each request's history as an exact prefix of the next one", () => {
    const stored = [...turns(4), checkpoint("checkpoint", "user-2")];
    const before = JSON.stringify(projectHistory(stored));
    const after = JSON.stringify(projectHistory([...stored, ...turns(2, "next-")]));

    expect(after.startsWith(before.slice(0, -1))).toBe(true);
  });
});

describe("modelReadsAttachment", () => {
  it("hands the model images and PDFs of at most 8 MiB", () => {
    expect(MODEL_FILE_MAX_BYTES).toBe(8 * 1024 * 1024);
    expect(modelReadsAttachment({ mimeType: "application/pdf", sizeBytes: 8 * 1024 * 1024 })).toBe(
      true,
    );
    expect(modelReadsAttachment({ mimeType: "image/png", sizeBytes: 8 * 1024 * 1024 + 1 })).toBe(
      false,
    );
  });
});

describe("inlineTextFile", () => {
  it("fences a text file whole, beyond any backtick run inside it", () => {
    expect(inlineTextFile("notes.md", "a ```b``` c")).toBe(
      "[File: notes.md]\n````\na ```b``` c\n````",
    );
  });

  it("sends a longer file as its first whole lines and says where the rest is", () => {
    const text = Array.from({ length: 5_000 }, (_, line) => `row ${line} ${"x".repeat(40)}`).join(
      "\n",
    );

    const sent = inlineTextFile("big.csv", text);
    const [header, , ...body] = sent.split("\n");
    const lines = body.slice(0, -1);

    expect(text.length).toBeGreaterThan(MODEL_TEXT_MAX_CHARS);
    expect(header).toBe(
      `[File: big.csv (too long to send whole: its first ${lines.length} of 5000 lines follow; read the saved file for the rest)]`,
    );
    expect(lines.join("\n").length).toBeLessThanOrEqual(MODEL_TEXT_PREVIEW_CHARS);
    expect(lines.at(-1)).toBe(`row ${lines.length - 1} ${"x".repeat(40)}`);
  });
});

describe("oversizedImageNote", () => {
  it("lets through an image of at most 2000 pixels a side and explains a larger one", () => {
    expect(MODEL_IMAGE_MAX_SIDE).toBe(2000);
    expect(oversizedImageNote(png(2000, 2000))).toBeUndefined();
    expect(oversizedImageNote(`data:image/png;base64,${png(2000, 1200)}`)).toBeUndefined();
    expect(oversizedImageNote("not an image")).toBeUndefined();
    expect(oversizedImageNote(png(3840, 2160))).toContain("The image is 3840×2160 pixels");
  });
});
