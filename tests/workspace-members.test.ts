import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  claimInstallation,
  createInvitation,
  getInvitation,
  getMembers,
  inWorkspace,
  updateMemberRole,
} from "../packages/workspaces/src";
import { members, users } from "../packages/workspaces/src/schema";
import { startPostgres } from "./postgres";

describe("human workspace membership against private PostgreSQL", () => {
  let database: Awaited<ReturnType<typeof startPostgres>>;
  let workspaceId: string;
  beforeAll(async () => {
    database = await startPostgres();
    await database.db.insert(users).values([
      {
        id: "member-owner",
        name: "Owner",
        email: "owner@members.test",
        emailVerified: true,
      },
      {
        id: "member-admin",
        name: "Admin",
        email: "admin@members.test",
        emailVerified: true,
      },
      {
        id: "member-human",
        name: "Human",
        email: "human@members.test",
        emailVerified: true,
      },
      {
        id: "member-outside",
        name: "Outside",
        email: "outside@members.test",
        emailVerified: true,
      },
    ]);
    workspaceId = (
      await claimInstallation(database.db, "member-owner", "Members")
    ).id;
    await database.db.insert(members).values([
      { workspaceId, userId: "member-admin", role: "admin" },
      { workspaceId, userId: "member-human", role: "contributor" },
    ]);
  });
  afterAll(async () => {
    await database?.stop();
  });
  it("lists only the current workspace directory with bounded pagination and no auth data", async () => {
    const page = await inWorkspace(
      database.db,
      workspaceId,
      { userId: "member-human" },
      getMembers,
      false,
    );
    expect(page.items.map((member) => member.userId)).toEqual([
      "member-admin",
      "member-human",
      "member-owner",
    ]);
    expect(Object.keys(page.items[0] ?? {}).sort()).toEqual([
      "name",
      "role",
      "userId",
    ]);
    const next = await inWorkspace(
      database.db,
      workspaceId,
      { userId: "member-human" },
      (context) => getMembers(context, { after: "member-human" }),
      false,
    );
    expect(next.items.map((member) => member.userId)).toEqual(["member-owner"]);
    await expect(
      inWorkspace(
        database.db,
        workspaceId,
        { userId: "member-outside" },
        getMembers,
        false,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      inWorkspace(
        database.db,
        workspaceId,
        { userId: "member-owner", agentId: crypto.randomUUID() },
        getMembers,
        false,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
  it("protects the human owner and admin authority during role updates", async () => {
    for (const [actor, target, role] of [
      ["member-admin", "member-owner", "viewer"],
      ["member-owner", "member-owner", "viewer"],
      ["member-admin", "member-human", "admin"],
      ["member-admin", "member-admin", "contributor"],
      ["member-human", "member-human", "admin"],
    ] as const) {
      await expect(
        inWorkspace(database.db, workspaceId, { userId: actor }, (context) =>
          updateMemberRole(context, target, role),
        ),
      ).rejects.toMatchObject({ code: "forbidden" });
    }
    const updated = await inWorkspace(
      database.db,
      workspaceId,
      { userId: "member-owner" },
      (context) => updateMemberRole(context, "member-human", "admin"),
    );
    expect(updated).toEqual({ userId: "member-human", role: "admin" });
  });
  it("rechecks invitation authority for explicit mail delivery retries", async () => {
    const invitation = await inWorkspace(
      database.db,
      workspaceId,
      { userId: "member-owner" },
      (context) =>
        createInvitation(context, {
          email: "invited@members.test",
          role: "admin",
        }),
    );
    await expect(
      inWorkspace(
        database.db,
        workspaceId,
        { userId: "member-admin" },
        (context) => getInvitation(context, invitation.id),
        false,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    const current = await inWorkspace(
      database.db,
      workspaceId,
      { userId: "member-owner" },
      (context) => getInvitation(context, invitation.id),
      false,
    );
    expect(current.id).toBe(invitation.id);
  });
});
