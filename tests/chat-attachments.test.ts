import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  createChat,
  createParticipant,
  deleteParticipant,
} from "../packages/chats/src";
import { participants } from "../packages/chats/src/schema";
import { type ListHarness, startListHarness } from "./fixtures/lists";

let h: ListHarness;
beforeAll(async () => {
  h = await startListHarness();
}, 120000);
afterAll(async () => {
  await h?.stop();
});

/** Participants read what is attached to their Chat; nobody else does, and access ends with membership. */
it("lets only a Chat's participants read its attachments, for as long as they are participants", async () => {
  const upload = async (cookie: string, title: string) =>
    (
      await h.api(`${h.base}/files`, {
        cookie,
        method: "POST",
        json: {
          requestId: crypto.randomUUID(),
          title,
          type: "note",
          mediaType: "text/plain",
          bytes: Buffer.from(title).toString("base64"),
        },
      })
    ).body as { id: string; visibility: string };
  const file = await upload(h.owner.cookie, "private notes");
  expect(file.visibility).toBe("user");
  const chat = await h.scope(h.owner, async (c) => {
    const created = await createChat(c, {
      title: "Plan",
      visibility: "participants",
    });
    await createParticipant(c, created.id, {
      userId: h.bob.id,
      role: "contributor",
    });
    return created.id;
  });
  const read = (cookie: string) =>
    h.api(`${h.base}/files/${file.id}`, { cookie });
  // Before it is attached, a private file is the custodian's alone.
  expect((await read(h.bob.cookie)).status).toBe(403);
  const send = (cookie: string, chatId: string, fileId: string) =>
    h.api(`${h.base}/chats/${chatId}/messages`, {
      cookie,
      method: "POST",
      json: {
        body: "see attached",
        requestId: crypto.randomUUID(),
        fileIds: [fileId],
      },
    });
  expect((await send(h.owner.cookie, chat, file.id)).status).toBe(200);
  expect((await read(h.owner.cookie)).status).toBe(200);
  expect((await read(h.bob.cookie)).status).toBe(200);
  // A workspace member who is not a participant still cannot read it; the File itself stays private.
  expect((await read(h.alice.cookie)).status).toBe(403);
  expect(
    ((await read(h.owner.cookie)).body as { visibility: string }).visibility,
  ).toBe("user");
  // Only the custodian attaches a private file: Bob can read it, but cannot carry it into another Chat.
  const other = await h.scope(h.bob, async (c) => {
    const created = await createChat(c, {
      title: "Elsewhere",
      visibility: "participants",
    });
    await createParticipant(c, created.id, {
      userId: h.alice.id,
      role: "contributor",
    });
    return created.id;
  });
  expect((await send(h.bob.cookie, other, file.id)).status).toBe(403);
  expect((await read(h.alice.cookie)).status).toBe(403);
  // Access ends with membership.
  const bobRow = (
    await h.database.db
      .select()
      .from(participants)
      .where(eq(participants.chatId, chat))
  ).find((row) => row.userId === h.bob.id);
  await h.scope(h.owner, (c) => deleteParticipant(c, chat, bobRow?.id ?? ""));
  expect((await read(h.bob.cookie)).status).toBe(403);
});
