import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createAgent } from "../packages/agents/src";
import {
  createChat,
  createParticipant,
  deleteParticipant,
} from "../packages/chats/src";
import { participants } from "../packages/chats/src/schema";
import { createCursorCodec } from "../packages/db/src";
import { createDocument, updateDocument } from "../packages/documents/src";
import { createEnvironment } from "../packages/environments/src";
import { deleteProjectMember } from "../packages/projects/src";
import { admitRun, failQueuedRun } from "../packages/runs/src";
import {
  acceptInvitation,
  createInvitation,
  createInvitationToken,
  deleteMember,
} from "../packages/workspaces/src";
import {
  LIST_SECRET,
  type ListHarness,
  startListHarness,
} from "./fixtures/lists";

let h: ListHarness;
beforeAll(async () => {
  h = await startListHarness();
}, 120000);
afterAll(async () => {
  await h?.stop();
});

/**
 * Sorted lists fail closed on the premise that authority cannot change while a read transaction is open: reads
 * hold the workspace row FOR SHARE and every authority write needs it FOR UPDATE. Prove the premise per kind of
 * authority write, so the premise is checked rather than assumed.
 */
it("blocks every kind of authority write while a list read transaction is open, and lets reads proceed", async () => {
  const projectId = await h.project("Locked");
  const { chatId, docId, runId } = await h.scope(h.owner, async (c) => {
    const chat = await createChat(c, {
      title: "Locked",
      visibility: "participants",
    });
    await createParticipant(c, chat.id, { userId: h.bob.id, role: "viewer" });
    const agent = await createAgent(c, {
      title: "Locker",
      instructions: "i",
      model: "m",
      visibility: "workspace",
    });
    await createParticipant(c, chat.id, {
      agentId: agent.id,
      role: "contributor",
    });
    await createEnvironment(c, agent.id);
    const doc = await createDocument(c, {
      title: "Locked",
      body: "b",
      visibility: "workspace",
    });
    const run = await admitRun(c, h.boss, {
      requestId: crypto.randomUUID(),
      chatId: chat.id,
      agentId: agent.id,
      type: "script",
      body: "x",
    });
    return {
      chatId: chat.id,
      participantId: "",
      docId: doc.id,
      runId: run.id,
      agentId: agent.id,
    };
  });
  const bobParticipant = (
    await h.database.db
      .select()
      .from(participants)
      .where(eq(participants.chatId, chatId))
  ).find((row) => row.userId === h.bob.id);
  const late = await h.signup("late");
  const tokens = createCursorCodec(LIST_SECRET);
  const invitation = await h.scope(h.owner, (c) =>
    createInvitation(c, { email: "late@lists.test", role: "contributor" }),
  );
  const token = await h.scope(h.owner, (c) =>
    createInvitationToken({ ...c, cursors: tokens }, invitation.id),
  );
  const writes: [string, () => Promise<unknown>][] = [
    [
      "workspace member removal",
      () => h.scope(h.owner, (c) => deleteMember(c, h.bob.id)),
    ],
    [
      "Project member removal",
      () =>
        h.scope(h.owner, (c) => deleteProjectMember(c, projectId, h.bob.id)),
    ],
    [
      "Chat participant removal",
      () =>
        h.scope(h.owner, (c) =>
          deleteParticipant(c, chatId, bobParticipant?.id ?? ""),
        ),
    ],
    [
      "Document visibility change",
      () =>
        h.scope(h.owner, (c) =>
          updateDocument(c, docId, { visibility: "user", editToken: 0 }),
        ),
    ],
    [
      "invitation acceptance (member insert)",
      () =>
        acceptInvitation(
          h.database.db,
          late.id,
          (invitation as { id: string }).id,
          token,
          tokens,
        ),
    ],
    [
      "Run settlement (explicit lock)",
      () => failQueuedRun(h.database.db, runId, "lock_probe"),
    ],
  ];
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reading: () => void = () => undefined;
  const open = new Promise<void>((resolve) => {
    reading = resolve;
  });
  // The read transaction is the real list path (write=false), held open while the writes try to start.
  const reader = h.scope(
    h.alice,
    async (c) => {
      const { getDocuments } = await import("../packages/documents/src");
      await getDocuments(c, {});
      reading();
      await gate;
    },
    false,
  );
  await open;
  const pending = writes.map(([name, work]) => {
    let done = false;
    const promise = work().then(
      () => {
        done = true;
      },
      () => {
        done = true;
      },
    );
    return { name, promise, finished: () => done };
  });
  await new Promise((resolve) => setTimeout(resolve, 600));
  for (const write of pending)
    expect(write.finished(), `${write.name} must wait for the open read`).toBe(
      false,
    );
  // Reads are compatible with each other: another list read proceeds now.
  const concurrent = await h.api(`${h.base}/documents?sort=title`, {
    cookie: h.alice.cookie,
  });
  expect(concurrent.status).toBe(200);
  release();
  await reader;
  await Promise.all(pending.map((write) => write.promise));
  for (const write of pending) expect(write.finished()).toBe(true);
}, 120000);
