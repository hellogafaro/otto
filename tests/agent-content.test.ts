import { DomainError } from "@otto/shared";
import { and, eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { startQueue } from "../apps/server/src/queue";
import { createAgent } from "../packages/agents/src";
import {
  createChat,
  createParticipant,
  deleteParticipant,
  updateParticipant,
} from "../packages/chats/src";
import { participants } from "../packages/chats/src/schema";
import { createEnvironment } from "../packages/environments/src";
import { createFile, getFile, updateFile } from "../packages/files/src";
import { files } from "../packages/files/src/schema";
import { admitRun } from "../packages/runs/src";
import { runs } from "../packages/runs/src/schema";
import { openNativeStorage } from "../packages/sessions/src/native";
import {
  archiveSkill,
  createSkill,
  snapshotSkills,
  updateSkill,
  validateSkillAccess,
} from "../packages/skills/src";
import {
  type Context,
  claimInstallation,
  inWorkspace,
} from "../packages/workspaces/src";
import { members, users } from "../packages/workspaces/src/schema";
import { nativeModelAuthorization } from "./fixtures/native-model";
import { fixtureStorage } from "./fixtures/storage";
import { startPostgres } from "./postgres";

describe("agent File publication with real PostgreSQL/queue and explicit execution/storage fixtures", () => {
  let database: Awaited<ReturnType<typeof startPostgres>>;
  let nativeStorage: Awaited<ReturnType<typeof openNativeStorage>>;
  let boss: PgBoss;
  let workspaceId: string;
  let chatId: string;
  let agentId: string;
  let otherAgentId: string;
  const human = { userId: "publication-sponsor" };
  const scope = <T>(fn: (c: Context) => Promise<T>) =>
    inWorkspace(database.db, workspaceId, human, fn);
  const objects = new Map<string, Uint8Array>();
  let puts = 0;
  let afterPut: (() => Promise<void>) | undefined;
  const storage = fixtureStorage({
    async put(key, bytes) {
      puts++;
      objects.set(key, bytes.slice());
      await afterPut?.();
    },
    async get(key) {
      const bytes = objects.get(key);
      if (!bytes) throw new Error("Missing fixture bytes");
      return bytes.slice();
    },
  });
  beforeAll(async () => {
    database = await startPostgres();
    nativeStorage = await openNativeStorage({
      connectionString: `postgresql://otto_test@localhost/postgres?host=${encodeURIComponent(database.directory)}`,
    });
    boss = await startQueue(database.db, database.pool, {
      workers: false,
      install: true,
    });
    await database.db.insert(users).values({
      id: human.userId,
      name: "Sponsor",
      email: "publication@example.test",
      emailVerified: true,
    });
    workspaceId = (
      await claimInstallation(database.db, human.userId, "Agent publication")
    ).id;
    await database.db.insert(users).values({
      id: "skill-reader",
      name: "Reader",
      email: "skill-reader@example.test",
      emailVerified: true,
    });
    await database.db
      .insert(members)
      .values({ workspaceId, userId: "skill-reader", role: "contributor" });
    await scope(async (c) => {
      for (const name of ["publisher", "other"]) {
        const agent = await createAgent(c, {
          visibility: "workspace",
          title: name,
          instructions: "Produce a file",
          model: "unqualified",
        });
        await createEnvironment(c, agent.id);
        if (name === "publisher") agentId = agent.id;
        else otherAgentId = agent.id;
      }
      chatId = (
        await createChat(c, {
          title: "Output",
          visibility: "participants",
        })
      ).id;
      await createParticipant(c, chatId, {
        agentId,
        role: "contributor",
      });
      await createParticipant(c, chatId, {
        agentId: otherAgentId,
        role: "contributor",
      });
    });
  });
  afterAll(async () => {
    await nativeStorage?.close();
    await boss?.stop();
    await database?.stop();
  });
  afterEach(async () => {
    await database.db
      .update(runs)
      .set({ state: "finished" })
      .where(and(eq(runs.agentId, agentId), eq(runs.state, "running")));
  });
  async function runningRun() {
    const run = await scope((c) =>
      admitRun(
        c,
        boss,
        {
          chatId,
          agentId,
          requestId: crypto.randomUUID(),
          type: "script",
          body: "Execution is a controlled state fixture; no native process",
        },
        nativeModelAuthorization,
        nativeStorage,
      ),
    );
    await database.db
      .update(runs)
      .set({ state: "running" })
      .where(eq(runs.id, run.id));
    return run.id;
  }
  const input = (sourceRunId?: string) => ({
    requestId: crypto.randomUUID(),
    title: "Agent result",
    type: "text",
    visibility: "user" as const,
    mediaType: "text/plain",
    sourceRunId,
  });
  const bytes = new TextEncoder().encode("immutable agent output");
  let checks = 0;
  // This callback fixture exercises the trusted seam; main owns real launch/env fences.
  const authorizeRun = async (c: Context, id: string) => {
    checks++;
    const run = (await c.tx.select().from(runs).where(eq(runs.id, id)))[0];
    if (
      !run ||
      run.sponsorId !== c.actor.userId ||
      run.agentId !== c.actor.agentId ||
      run.state !== "running" ||
      run.attempt !== 0
    )
      throw new DomainError("forbidden");
  };
  it("publishes for the exact agent without granting user-scoped reads or human retry impersonation", async () => {
    const request = input(await runningRun());
    const actor = { ...human, agentId };
    const beforePuts = puts;
    checks = 0;
    const saved = await createFile(
      database.db,
      storage,
      workspaceId,
      actor,
      request,
      bytes,
      authorizeRun,
    );
    expect(saved).toMatchObject({
      ownerId: human.userId,
      creatorAgentId: agentId,
      sourceRunId: request.sourceRunId,
    });
    expect(checks).toBe(2);
    expect(puts).toBe(beforePuts + 1);
    await scope((c) =>
      updateFile(c, saved.id, {
        title: "Private human metadata",
        labels: ["private human label"],
      }),
    );
    expect(
      (
        await createFile(
          database.db,
          storage,
          workspaceId,
          actor,
          request,
          bytes,
          authorizeRun,
        )
      ).id,
    ).toBe(saved.id);
    expect(checks).toBe(4);
    expect(puts).toBe(beforePuts + 1);
    const receipt = await createFile(
      database.db,
      storage,
      workspaceId,
      actor,
      request,
      bytes,
      authorizeRun,
    );
    expect(receipt.title).toBe(request.title);
    expect(receipt.labels).toEqual([]);
    expect(receipt).not.toHaveProperty("readerIds");
    expect(receipt).not.toHaveProperty("writerIds");
    await expect(
      inWorkspace(database.db, workspaceId, actor, (c) => getFile(c, saved.id)),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect((await scope((c) => getFile(c, saved.id))).id).toBe(saved.id);
    await expect(
      createFile(database.db, storage, workspaceId, human, request, bytes),
    ).rejects.toMatchObject({ code: "conflict" });
  });
  it("rejects missing trusted authorization, absent source, a different agent and a non-running source before storage", async () => {
    const runId = await runningRun();
    const actor = { ...human, agentId };
    const beforePuts = puts;
    await expect(
      createFile(database.db, storage, workspaceId, actor, input(runId), bytes),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      createFile(
        database.db,
        storage,
        workspaceId,
        actor,
        input(),
        bytes,
        authorizeRun,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      createFile(
        database.db,
        storage,
        workspaceId,
        { ...human, agentId: otherAgentId },
        input(runId),
        bytes,
        authorizeRun,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      createFile(
        database.db,
        storage,
        workspaceId,
        actor,
        { ...input(runId), visibility: "workspace" },
        bytes,
        authorizeRun,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    const participant = (
      await database.db
        .select()
        .from(participants)
        .where(
          and(
            eq(participants.chatId, chatId),
            eq(participants.agentId, agentId),
          ),
        )
    )[0];
    if (!participant) throw new Error("Missing agent participant");
    await scope((c) => updateParticipant(c, chatId, participant.id, "viewer"));
    await expect(
      createFile(
        database.db,
        storage,
        workspaceId,
        actor,
        input(runId),
        bytes,
        authorizeRun,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    await scope((c) =>
      updateParticipant(c, chatId, participant.id, "contributor"),
    );
    await database.db
      .update(runs)
      .set({ state: "finished" })
      .where(eq(runs.id, runId));
    await expect(
      createFile(
        database.db,
        storage,
        workspaceId,
        actor,
        input(runId),
        bytes,
        authorizeRun,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(puts).toBe(beforePuts);
  });
  it("keeps a pending intent when the trusted attempt fence changes during storage I/O", async () => {
    const runId = await runningRun();
    const request = input(runId);
    checks = 0;
    afterPut = async () => {
      await database.db
        .update(runs)
        .set({ attempt: 1 })
        .where(eq(runs.id, runId));
    };
    try {
      await expect(
        createFile(
          database.db,
          storage,
          workspaceId,
          { ...human, agentId },
          request,
          bytes,
          authorizeRun,
        ),
      ).rejects.toMatchObject({ code: "forbidden" });
    } finally {
      afterPut = undefined;
    }
    expect(checks).toBe(2);
    const pending = (
      await database.db
        .select()
        .from(files)
        .where(eq(files.requestId, request.requestId))
    )[0];
    expect(pending?.state).toBe("pending");
    expect(pending?.creatorAgentId).toBe(agentId);
    await expect(
      scope((c) => getFile(c, pending?.id ?? "")),
    ).rejects.toMatchObject({ code: "not_found" });
  });
  it("keeps archived skill permission separate from new selection and still rejects revoked sources", async () => {
    const skill = await scope((c) =>
      createSkill(c, {
        title: "Accepted skill",
        instructions: "Saved instructions",

        visibility: "workspace",
      }),
    );
    const audience = { humans: [human.userId, "skill-reader"], agents: [] };
    const accepted = await scope((c) =>
      snapshotSkills(c, [skill.id], audience),
    );
    await scope((c) => archiveSkill(c, skill.id, true, 0));
    const reader = <T>(fn: (c: Context) => Promise<T>) =>
      inWorkspace(database.db, workspaceId, { userId: "skill-reader" }, fn);
    expect(
      (await reader((c) => validateSkillAccess(c, skill.id, audience))).id,
    ).toBe(skill.id);
    expect(accepted[0]?.instructions).toBe("Saved instructions");
    await expect(
      scope((c) => snapshotSkills(c, [skill.id], audience)),
    ).rejects.toMatchObject({ code: "invalid" });
    await scope((c) =>
      updateSkill(c, skill.id, { visibility: "user", editToken: 1 }),
    );
    await expect(
      reader((c) => validateSkillAccess(c, skill.id, audience)),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      scope((c) => validateSkillAccess(c, skill.id, audience)),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
  it("rechecks current participant access after storage and leaves revoked output unpublished", async () => {
    const request = input(await runningRun());
    const participant = (
      await database.db
        .select()
        .from(participants)
        .where(
          and(
            eq(participants.chatId, chatId),
            eq(participants.agentId, agentId),
          ),
        )
    )[0];
    if (!participant) throw new Error("Missing agent participant");
    afterPut = () => scope((c) => deleteParticipant(c, chatId, participant.id));
    try {
      await expect(
        createFile(
          database.db,
          storage,
          workspaceId,
          { ...human, agentId },
          request,
          bytes,
          authorizeRun,
        ),
      ).rejects.toMatchObject({ code: "forbidden" });
    } finally {
      afterPut = undefined;
    }
    expect(
      (
        await database.db
          .select()
          .from(files)
          .where(eq(files.requestId, request.requestId))
      )[0]?.state,
    ).toBe("pending");
  });
});
