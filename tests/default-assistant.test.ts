import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { archiveAgent, getAgent, updateAgent } from "../packages/agents/src";
import { agents } from "../packages/agents/src/schema";
import { ensureDefaultAgent } from "../packages/agents/src/server";
import { type Context, inWorkspace } from "../packages/workspaces/src";
import { members, users, workspaces } from "../packages/workspaces/src/schema";
import { startPostgres } from "./postgres";

let database: Awaited<ReturnType<typeof startPostgres>>;
const workspaceId = crypto.randomUUID();
const userId = crypto.randomUUID();
const scope = <T>(work: (c: Context) => Promise<T>) =>
  inWorkspace(database.db, workspaceId, { userId }, work);

beforeAll(async () => {
  database = await startPostgres();
  await database.db.insert(users).values({
    id: userId,
    name: "Assistant owner",
    email: `${userId}@example.test`,
    emailVerified: true,
  });
  await database.db
    .insert(workspaces)
    .values({ id: workspaceId, title: "Assistant fixture" });
  await database.db
    .insert(members)
    .values({ workspaceId, userId, role: "owner" });
});
afterAll(async () => database?.stop());

it("keeps one protected Otto and repairs the legacy default without replacing identity or configuration", async () => {
  const first = await scope(ensureDefaultAgent);
  expect(first).toMatchObject({
    title: "Otto",
    isDefault: true,
    archived: false,
    visibility: "workspace",
    model: "unconfigured",
    subscriptionId: null,
  });
  expect(first.instructions).toContain("project-management assistant");
  expect(first.instructions).toContain("inline approval card");
  expect((await scope(ensureDefaultAgent)).id).toBe(first.id);
  await expect(scope((c) => archiveAgent(c, first.id, true))).rejects.toThrow(
    "Default agent cannot be archived",
  );
  await expect(
    scope((c) =>
      updateAgent(c, first.id, {
        title: "Someone else",
        editToken: first.editToken,
      }),
    ),
  ).rejects.toThrow("must be named Otto");
  await expect(
    scope((c) =>
      updateAgent(c, first.id, {
        visibility: "user",
        editToken: first.editToken,
      }),
    ),
  ).rejects.toThrow("must remain shared");
  await database.db
    .update(agents)
    .set({
      title: "Default agent",
      instructions: "",
      model: "saved-configured-model",
    })
    .where(eq(agents.id, first.id));
  const repaired = await scope(ensureDefaultAgent);
  expect(repaired).toMatchObject({
    id: first.id,
    title: "Otto",
    model: "saved-configured-model",
    subscriptionId: null,
    editToken: first.editToken + 1,
  });
  expect(repaired.instructions).toBe(first.instructions);
  const customized = await scope((c) =>
    updateAgent(c, first.id, {
      instructions: "Keep the owner's added guidance.",
      editToken: repaired.editToken,
    }),
  );
  expect(await scope(ensureDefaultAgent)).toEqual(customized);
  expect((await scope((c) => getAgent(c, first.id))).title).toBe("Otto");
  expect(await database.db.select().from(agents)).toHaveLength(1);
});

it("repairs the default for another writer without transferring creator authority", async () => {
  const writerId = crypto.randomUUID();
  await database.db.insert(users).values({
    id: writerId,
    name: "Another writer",
    email: `${writerId}@example.test`,
    emailVerified: true,
  });
  await database.db
    .insert(members)
    .values({ workspaceId, userId: writerId, role: "contributor" });
  const original = await scope(ensureDefaultAgent);
  await database.db
    .update(agents)
    .set({ title: "Default agent" })
    .where(eq(agents.id, original.id));
  const repaired = await inWorkspace(
    database.db,
    workspaceId,
    { userId: writerId },
    ensureDefaultAgent,
  );
  expect(repaired).toMatchObject({
    id: original.id,
    title: "Otto",
    createdBy: userId,
    instructions: original.instructions,
    model: original.model,
    editToken: original.editToken + 1,
  });
  await expect(
    inWorkspace(database.db, workspaceId, { userId: writerId }, (c) =>
      updateAgent(c, repaired.id, {
        instructions: "Cannot replace the creator's instructions",
        editToken: repaired.editToken,
      }),
    ),
  ).rejects.toMatchObject({ code: "forbidden" });
});
