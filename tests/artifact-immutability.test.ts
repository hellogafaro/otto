import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type ArtifactStorage,
  createArtifact,
  readArtifact,
  updateArtifact,
} from "../packages/artifacts/src";
import { artifacts } from "../packages/artifacts/src/schema";
import { claimInstallation, inWorkspace } from "../packages/workspaces/src";
import { users } from "../packages/workspaces/src/schema";
import { startPostgres } from "./postgres";

describe("Artifact durable intent against an overwriting object-store fixture", () => {
  let database: Awaited<ReturnType<typeof startPostgres>>;
  let workspaceId: string;
  const objects = new Map<string, Uint8Array>();
  let puts = 0;
  let loseAck = true;
  const storage: ArtifactStorage = {
    async put(key, bytes) {
      puts++;
      objects.set(key, bytes.slice());
      if (loseAck) throw new Error("Fixture lost acknowledgement");
    },
    async get(key) {
      const value = objects.get(key);
      if (!value) throw new Error("Absent fixture object");
      return value.slice();
    },
  };
  const actor = { userId: "artifact-owner" };
  beforeAll(async () => {
    database = await startPostgres();
    await database.db.insert(users).values({
      id: actor.userId,
      name: "Owner",
      email: "owner@example.test",
      emailVerified: true,
    });
    workspaceId = (
      await claimInstallation(database.db, actor.userId, "Immutable bytes")
    ).id;
  });
  afterAll(async () => database?.stop());
  it("pins intent and digest before I/O, refuses changed retries and survives metadata edits and legacy reads", async () => {
    const input = {
      requestId: crypto.randomUUID(),
      title: "Original",
      type: "text",
      access: "inherited" as const,
      mediaType: "text/plain",
    };
    const bytes = new TextEncoder().encode("first immutable bytes");
    await expect(
      createArtifact(database.db, storage, workspaceId, actor, input, bytes),
    ).rejects.toThrow("Fixture lost acknowledgement");
    const pending = (
      await database.db
        .select()
        .from(artifacts)
        .where(eq(artifacts.requestId, input.requestId))
    )[0];
    if (!pending) throw new Error("Missing durable intent");
    expect(pending.state).toBe("pending");
    expect(pending.objectKey.split("/").at(-1)).toBe(pending.sha256);
    expect(objects.get(pending.objectKey)).toEqual(bytes);
    await expect(
      createArtifact(
        database.db,
        storage,
        workspaceId,
        actor,
        input,
        new TextEncoder().encode("replacement"),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(puts).toBe(1);
    expect(objects.get(pending.objectKey)).toEqual(bytes);
    loseAck = false;
    const saved = await createArtifact(
      database.db,
      storage,
      workspaceId,
      actor,
      input,
      bytes,
    );
    expect(saved.id).toBe(pending.id);
    await inWorkspace(database.db, workspaceId, actor, (c) =>
      updateArtifact(c, saved.id, {
        title: "Renamed",
        labels: ["reviewed"],
        editToken: 0,
      }),
    );
    expect(
      (
        await createArtifact(
          database.db,
          storage,
          workspaceId,
          actor,
          input,
          bytes,
        )
      ).title,
    ).toBe("Renamed");
    expect(puts).toBe(2);
    const next = await createArtifact(
      database.db,
      storage,
      workspaceId,
      actor,
      { ...input, requestId: crypto.randomUUID() },
      new TextEncoder().encode("another output"),
    );
    expect(next.id).not.toBe(saved.id);
    expect(objects.size).toBe(2);
    const legacyKey = `${workspaceId}/${crypto.randomUUID()}`;
    objects.set(legacyKey, bytes);
    await database.db
      .update(artifacts)
      .set({ objectKey: legacyKey })
      .where(eq(artifacts.id, saved.id));
    expect(
      await readArtifact(database.db, storage, workspaceId, actor, saved.id),
    ).toEqual(bytes);
    objects.set(legacyKey, new TextEncoder().encode("corrupt"));
    await expect(
      readArtifact(database.db, storage, workspaceId, actor, saved.id),
    ).rejects.toMatchObject({ code: "conflict" });
  });
});
