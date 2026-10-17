import type { MastraDBMessage } from "@mastra/core/agent-controller";
import { describe, expect, it } from "vite-plus/test";

import { GROUP_NO_REPLY, groupTurnNote } from "../orchestration/group-responder.ts";
import { OTTO_CHECKPOINT, projectHistory } from "./chat-history.ts";

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
