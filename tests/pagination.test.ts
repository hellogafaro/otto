import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDocuments } from "../packages/documents/src";
import { documents } from "../packages/documents/src/schema";
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
        ownerId: owner,
        access: "restricted" as const,
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
      ownerId: owner,
      access: "inherited",
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
});
