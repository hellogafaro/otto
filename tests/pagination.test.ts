import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getAttention } from "../apps/server/src/attention";
import { startQueue } from "../apps/server/src/queue";
import { createAgent } from "../packages/agents/src";
import {
  createConversation,
  createParticipant,
} from "../packages/conversations/src";
import { getDocuments } from "../packages/documents/src";
import { documents } from "../packages/documents/src/schema";
import { createEnvironment } from "../packages/environments/src";
import { admitRun, createRunQuestion } from "../packages/runs/src";
import { runs } from "../packages/runs/src/schema";
import {
  claimInstallation,
  getMembers,
  getWorkspaceAudience,
  inWorkspace,
} from "../packages/workspaces/src";
import { members, users } from "../packages/workspaces/src/schema";
import { startPostgres } from "./postgres";

/** Real candidate queries and current authorization, including invisible pages. */
describe("discovery pagination on private PostgreSQL", () => {
  let database: Awaited<ReturnType<typeof startPostgres>>;
  let workspaceId: string;
  const owner = "page-owner";
  const reader = "page-reader";
  const id = (n: number) =>
    `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  beforeAll(async () => {
    database = await startPostgres();
    await database.db.insert(users).values(
      [owner, reader].map((userId) => ({
        id: userId,
        name: userId,
        email: `${userId}@pagination.test`,
        emailVerified: true,
      })),
    );
    workspaceId = (await claimInstallation(database.db, owner, "Pages")).id;
    await database.db
      .insert(members)
      .values({ workspaceId, userId: reader, role: "viewer" });
  });
  afterAll(async () => {
    await database?.stop();
  });
  const read = (after?: string) =>
    inWorkspace(
      database.db,
      workspaceId,
      { userId: reader },
      (c) => getDocuments(c, { after }),
      false,
    );
  it("returns null for empty and exact boundaries, but advances an entirely filtered candidate page", async () => {
    expect(await read()).toEqual({ items: [], next: null });
    await database.db.insert(documents).values(
      Array.from({ length: 100 }, (_, i) => ({
        id: id(i + 1),
        workspaceId,
        title: `Private ${i}`,
        body: "private",
        createdBy: owner,
        visibility: "user" as const,
      })),
    );
    expect(await read()).toEqual({ items: [], next: null });
    const ownerPage = await inWorkspace(
      database.db,
      workspaceId,
      { userId: owner },
      (c) => getDocuments(c, {}),
      false,
    );
    expect(ownerPage.items).toHaveLength(100);
    expect(ownerPage.next).toBeNull();
    await database.db.insert(documents).values({
      id: id(101),
      workspaceId,
      title: "Visible",
      body: "shared",
      createdBy: owner,
      visibility: "workspace",
    });
    const filtered = await read();
    expect(filtered).toEqual({ items: [], next: id(100) });
    const next = await read(filtered.next ?? undefined);
    expect(next.items.map((item) => item.id)).toEqual([id(101)]);
    expect(next.next).toBeNull();
    expect(await read(id(101))).toEqual({ items: [], next: null });
  });
  it("paginates human IDs and validates bounds without truncating complete authorization audiences", async () => {
    const page = await inWorkspace(
      database.db,
      workspaceId,
      { userId: owner },
      (c) => getMembers(c, { limit: 1 }),
      false,
    );
    expect(page.items.map((item) => item.userId)).toEqual([owner]);
    expect(page.next).toBe(owner);
    const last = await inWorkspace(
      database.db,
      workspaceId,
      { userId: owner },
      (c) => getMembers(c, { limit: 1, after: page.next ?? undefined }),
      false,
    );
    expect(last.items.map((item) => item.userId)).toEqual([reader]);
    expect(last.next).toBeNull();
    expect(
      await inWorkspace(
        database.db,
        workspaceId,
        { userId: owner },
        getWorkspaceAudience,
        false,
      ),
    ).toEqual(expect.arrayContaining([owner, reader]));
    for (const limit of [0, 101, 1.5, Number.NaN])
      await expect(
        inWorkspace(
          database.db,
          workspaceId,
          { userId: owner },
          (c) => getMembers(c, { limit }),
          false,
        ),
      ).rejects.toMatchObject({ code: "invalid" });
    await expect(read("")).rejects.toMatchObject({ code: "invalid" });
    await expect(read("x".repeat(129))).rejects.toMatchObject({
      code: "invalid",
    });
  });
  it("honors one common attention limit and advances denied Run/question candidates", async () => {
    const boss = await startQueue(database.db, database.pool, {
      workers: false,
      install: true,
    });
    try {
      await inWorkspace(
        database.db,
        workspaceId,
        { userId: owner },
        async (c) => {
          const conversation = await createConversation(c, {
            title: "Private questions",
            visibility: "participants",
          });
          const agent = await createAgent(c, {
            title: "Attention",
            instructions: "Work",
            model: "fixture",
            visibility: "workspace",
          });
          await createParticipant(c, conversation.id, {
            agentId: agent.id,
            role: "contributor",
          });
          await createEnvironment(c, agent.id);
          for (let i = 0; i < 2; i++) {
            const run = await admitRun(c, boss, {
              requestId: crypto.randomUUID(),
              conversationId: conversation.id,
              agentId: agent.id,
              type: "script",
              body: "fixture",
            });
            // Explicit running-state fixture; discovery must still authorize every saved question.
            await c.tx
              .update(runs)
              .set({ state: "running" })
              .where(eq(runs.id, run.id));
            await createRunQuestion(
              { ...c, actor: { userId: owner, agentId: agent.id } },
              run.id,
              { requestId: crypto.randomUUID(), body: `Question ${i}` },
            );
          }
        },
      );
      const filter = { limit: 1 };
      const first = await inWorkspace(
        database.db,
        workspaceId,
        { userId: owner },
        (c) => getAttention(c, filter),
        false,
      );
      expect(first.runs.items).toHaveLength(1);
      expect(first.questions.items).toHaveLength(1);
      expect(first.runs.next).not.toBeNull();
      expect(first.questions.next).not.toBeNull();
      const last = await inWorkspace(
        database.db,
        workspaceId,
        { userId: owner },
        (c) =>
          getAttention(c, {
            ...filter,
            runAfter: String(first.runs.next),
            questionAfter: String(first.questions.next),
          }),
        false,
      );
      expect(last.runs.items).toHaveLength(1);
      expect(last.questions.items).toHaveLength(1);
      expect(last.runs.next).toBeNull();
      expect(last.questions.next).toBeNull();
      const denied = await inWorkspace(
        database.db,
        workspaceId,
        { userId: reader },
        (c) => getAttention(c, filter),
        false,
      );
      expect(denied.runs).toEqual({ items: [], next: first.runs.next });
      expect(denied.questions).toEqual({
        items: [],
        next: first.questions.next,
      });
      const deniedLast = await inWorkspace(
        database.db,
        workspaceId,
        { userId: reader },
        (c) =>
          getAttention(c, {
            ...filter,
            runAfter: String(denied.runs.next),
            questionAfter: String(denied.questions.next),
          }),
        false,
      );
      expect(deniedLast.runs).toEqual({ items: [], next: null });
      expect(deniedLast.questions).toEqual({ items: [], next: null });
    } finally {
      await boss.stop();
    }
  });
});
