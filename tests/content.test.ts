import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAgent } from "../packages/agents/src";
import {
  type ArtifactStorage,
  archiveArtifact,
  getArtifact,
  getArtifacts,
  readArtifact,
  saveArtifact,
} from "../packages/artifacts/src";
import { artifacts } from "../packages/artifacts/src/schema";
import {
  createConnection,
  disconnectConnection,
  grantConnection,
  snapshotGrants,
} from "../packages/connections/src";
import { connections } from "../packages/connections/src/schema";
import {
  addParticipant,
  createConversation,
  getMessages,
  removeParticipant,
} from "../packages/conversations/src";
import { participants } from "../packages/conversations/src/schema";
import {
  createCollection,
  createDocument,
  getDocument,
  putDocumentInCollection,
  saveDocument,
  snapshotSkills,
} from "../packages/documents/src";
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
      createDocument(c, { title: "Note", body: "old", access: "inherited" }),
    );
    await scope((c) =>
      saveDocument(c, doc.id, { title: "Note", body: "new", editToken: 0 }),
    );
    await expect(
      scope((c) =>
        saveDocument(c, doc.id, {
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
        fields: [{ id: fieldId, name: "Size", type: "number" }],
      }),
    );
    const doc = await scope((c) =>
      createDocument(c, { title: "Spec", body: "body", access: "inherited" }),
    );
    await expect(
      scope((c) =>
        putDocumentInCollection(
          c,
          doc.id,
          collection.id,
          { [fieldId]: "wrong type" },
          0,
        ),
      ),
    ).rejects.toMatchObject({ code: "invalid" });
    const saved = await scope((c) =>
      putDocumentInCollection(c, doc.id, collection.id, { [fieldId]: 42 }, 0),
    );
    expect(saved.properties[fieldId]).toBe(42);
  });
  it("rejects skill material whose audience is narrower than the output Conversation", async () => {
    const skill = await scope((c) =>
      createDocument(c, {
        title: "private-skill",
        body: "private instructions",
        access: "restricted",
        skill: true,
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
      kind: "text",
      access: "restricted" as const,
      mediaType: "text/plain",
    };
    const bytes = new TextEncoder().encode("durable output");
    await expect(
      saveArtifact(
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
    const saved = await saveArtifact(
      database.db,
      storage,
      workspaceId,
      { userId: "owner" },
      input,
      bytes,
    );
    expect(
      (
        await saveArtifact(
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
      saveArtifact(
        database.db,
        storage,
        workspaceId,
        { userId: "owner" },
        input,
        new TextEncoder().encode("changed"),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
  });
  it("rechecks restricted Conversation participation on saved-history replay", async () => {
    const conversation = await scope((c) =>
      createConversation(c, { title: "Private", access: "restricted" }),
    );
    await scope((c) =>
      addParticipant(c, conversation.id, { userId: "other", role: "viewer" }),
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
      removeParticipant(c, conversation.id, participant?.id ?? ""),
    );
    await expect(
      scope((c) => getMessages(c, conversation.id), "other"),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
  it("scopes Connection grants and revokes them on disconnect", async () => {
    const agent = await scope((c) =>
      createAgent(c, {
        name: "Worker",
        instructions: "Work",
        harness: "codex-acp",
        harnessRelease: "unqualified",
        model: "selected",
      }),
    );
    const connection = await scope((c) =>
      createConnection(c, {
        name: "GitHub",
        kind: "github",
        accountRef: "installation-reference",
        mode: "service",
      }),
    );
    // Connected-state fixture only; provider connectivity is not qualified.
    await database.db
      .update(connections)
      .set({ connected: true })
      .where(eq(connections.id, connection.id));
    await scope((c) =>
      grantConnection(c, connection.id, {
        agentId: agent.id,
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
          grantConnection(c, connection.id, {
            agentId: agent.id,
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
