import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAgent } from "../packages/agents/src";
import {
  type ArtifactStorage,
  archiveArtifact,
  createArtifact,
  getArtifact,
  getArtifacts,
  readArtifact,
} from "../packages/artifacts/src";
import { artifacts } from "../packages/artifacts/src/schema";
import {
  createConnection,
  disconnectConnection,
  grantConnectionAccess,
  snapshotGrants,
} from "../packages/connections/src";
import { connections } from "../packages/connections/src/schema";
import {
  createConversation,
  createParticipant,
  deleteParticipant,
  getMessages,
} from "../packages/conversations/src";
import { participants } from "../packages/conversations/src/schema";
import {
  createCollection,
  createDocument,
  getDocument,
  updateDocument,
  updateDocumentCollection,
} from "../packages/documents/src";
import { createSkill, snapshotSkills } from "../packages/skills/src";
import { claimInstallation, inWorkspace } from "../packages/workspaces/src";
import { members, users } from "../packages/workspaces/src/schema";
import { startPostgres } from "./postgres";

describe("persisted content and capability scope", () => {
  let database: Awaited<ReturnType<typeof startPostgres>>;
  let workspaceId: string;
  const scope = <T>(
    fn: Parameters<typeof inWorkspace<T>>[3],
    userId = "owner",
  ) => inWorkspace(database.db, workspaceId, { userId }, fn);
  beforeAll(async () => {
    database = await startPostgres();
    await database.db.insert(users).values([
      {
        id: "owner",
        name: "Owner",
        email: "owner@example.test",
        emailVerified: true,
      },
      {
        id: "other",
        name: "Other",
        email: "other@example.test",
        emailVerified: true,
      },
    ]);
    workspaceId = (await claimInstallation(database.db, "owner", "Content")).id;
    await database.db
      .insert(members)
      .values({ workspaceId, userId: "other", role: "contributor" });
  });
  afterAll(async () => {
    await database?.stop();
  });
  it("rejects stale Document edits and keeps one current body", async () => {
    const doc = await scope((c) =>
      createDocument(c, {
        title: "Note",
        body: "old",
        visibility: "workspace",
      }),
    );
    await scope((c) =>
      updateDocument(c, doc.id, { title: "Note", body: "new", editToken: 0 }),
    );
    await expect(
      scope((c) =>
        updateDocument(c, doc.id, {
          title: "Note",
          body: "lost update",
          editToken: 0,
        }),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    expect((await scope((c) => getDocument(c, doc.id))).body).toBe("new");
  });
  it("validates Collection properties by stable field ID", async () => {
    const fieldId = crypto.randomUUID();
    const collection = await scope((c) =>
      createCollection(c, {
        title: "Library",
        fields: [{ id: fieldId, title: "Size", type: "number" }],
      }),
    );
    const doc = await scope((c) =>
      createDocument(c, {
        title: "Spec",
        body: "body",
        visibility: "workspace",
      }),
    );
    await expect(
      scope((c) =>
        updateDocumentCollection(c, doc.id, {
          collectionId: collection.id,
          properties: { [fieldId]: "wrong type" },
          editToken: 0,
        }),
      ),
    ).rejects.toMatchObject({ code: "invalid" });
    const saved = await scope((c) =>
      updateDocumentCollection(c, doc.id, {
        collectionId: collection.id,
        properties: { [fieldId]: 42 },
        editToken: 0,
      }),
    );
    expect(saved.properties[fieldId]).toBe(42);
  });
  it("rejects skill material whose audience is narrower than the output Conversation", async () => {
    const skill = await scope((c) =>
      createSkill(c, {
        title: "private-skill",
        instructions: "private instructions",
        visibility: "user",
      }),
    );
    await expect(
      scope((c) =>
        snapshotSkills(c, [skill.id], {
          humans: ["owner", "other"],
          agents: [],
        }),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
  it("retains failed upload intent and publishes only after storage confirms immutable bytes", async () => {
    // This fixture tests PostgreSQL publication/retry behavior only, not Garage/S3 durability.
    const objects = new Map<string, Uint8Array>();
    let fail = true;
    const storage: ArtifactStorage = {
      async put(key, bytes) {
        if (fail) throw new Error("fixture storage unavailable");
        if (!objects.has(key)) objects.set(key, bytes.slice());
      },
      async get(key) {
        const bytes = objects.get(key);
        if (!bytes) throw new Error("missing fixture");
        return bytes;
      },
    };
    const input = {
      requestId: crypto.randomUUID(),
      title: "Result",
      type: "text",
      visibility: "user" as const,
      mediaType: "text/plain",
    };
    const bytes = new TextEncoder().encode("durable output");
    await expect(
      createArtifact(
        database.db,
        storage,
        workspaceId,
        { userId: "owner" },
        input,
        bytes,
      ),
    ).rejects.toThrow("fixture storage unavailable");
    const pending = (
      await database.db
        .select()
        .from(artifacts)
        .where(eq(artifacts.requestId, input.requestId))
    )[0];
    expect(pending?.state).toBe("pending");
    await expect(
      scope((c) => getArtifact(c, pending?.id ?? "")),
    ).rejects.toMatchObject({ code: "not_found" });
    fail = false;
    const saved = await createArtifact(
      database.db,
      storage,
      workspaceId,
      { userId: "owner" },
      input,
      bytes,
    );
    expect(
      (
        await createArtifact(
          database.db,
          storage,
          workspaceId,
          { userId: "owner" },
          input,
          bytes,
        )
      ).id,
    ).toBe(saved.id);
    expect(objects.size).toBe(1);
    await expect(
      scope((c) => getArtifact(c, saved.id), "other"),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(
      await readArtifact(
        database.db,
        storage,
        workspaceId,
        { userId: "owner" },
        saved.id,
      ),
    ).toEqual(bytes);
    await scope((c) => archiveArtifact(c, saved.id, true));
    expect((await scope((c) => getArtifacts(c, {}))).items).toHaveLength(0);
    expect(
      (await scope((c) => getArtifacts(c, { archived: true }))).items,
    ).toHaveLength(1);
    expect(
      await readArtifact(
        database.db,
        storage,
        workspaceId,
        { userId: "owner" },
        saved.id,
      ),
    ).toEqual(bytes);
    await expect(
      createArtifact(
        database.db,
        storage,
        workspaceId,
        { userId: "owner" },
        input,
        new TextEncoder().encode("changed"),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
  });
  it("rechecks participants-only Conversation membership on saved-history replay", async () => {
    const conversation = await scope((c) =>
      createConversation(c, { title: "Private", visibility: "participants" }),
    );
    await scope((c) =>
      createParticipant(c, conversation.id, {
        userId: "other",
        role: "viewer",
      }),
    );
    expect(
      await scope((c) => getMessages(c, conversation.id), "other"),
    ).toEqual([]);
    const participant = (
      await database.db
        .select()
        .from(participants)
        .where(eq(participants.userId, "other"))
    )[0];
    await scope((c) =>
      deleteParticipant(c, conversation.id, participant?.id ?? ""),
    );
    await expect(
      scope((c) => getMessages(c, conversation.id), "other"),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
  it("scopes Connection grants and revokes them on disconnect", async () => {
    const agent = await scope((c) =>
      createAgent(c, {
        title: "Worker",
        instructions: "Work",
        model: "selected",
      }),
    );
    const connection = await scope((c) =>
      createConnection(c, {
        title: "GitHub",
        type: "github",
        accountRef: "installation-reference",
      }),
    );
    // Connected-state fixture only; provider connectivity is not qualified.
    await database.db
      .update(connections)
      .set({
        connected: true,
        discovery: { actions: ["read", "write"], resources: ["repo:one"] },
      })
      .where(eq(connections.id, connection.id));
    await scope((c) =>
      grantConnectionAccess(c, connection.id, {
        agentId: agent.id,
        audience: { humans: ["owner"], agents: [agent.id] },
        resources: ["repo:one"],
        operations: { read: "allowed", write: "confirmation" },
      }),
    );
    expect(
      (await scope((c) => snapshotGrants(c, agent.id)))[0]?.resources,
    ).toEqual(["repo:one"]);
    await expect(
      scope(
        (c) =>
          grantConnectionAccess(c, connection.id, {
            agentId: agent.id,
            audience: { humans: ["owner"], agents: [agent.id] },
            resources: ["repo:two"],
            operations: { read: "allowed" },
          }),
        "other",
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    await scope((c) => disconnectConnection(c, connection.id));
    expect(await scope((c) => snapshotGrants(c, agent.id))).toEqual([]);
  });
});
