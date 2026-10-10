import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuth } from "../apps/server/src/auth";
import { createCursorCodec } from "../packages/db/src";
import {
  createProject,
  getProject,
  upsertProjectMember,
} from "../packages/projects/src";
import {
  assertNoOpenOwnedTasks,
  createTask,
  getTask,
  setTaskStatus,
} from "../packages/tasks/src";
import {
  acceptInvitation,
  claimInstallation,
  createInvitation,
  createInvitationToken,
  deleteMember,
  getInvitation,
  inWorkspace,
  updateInvitation,
  updateMemberRole,
} from "../packages/workspaces/src";
import { invitations, members, users } from "../packages/workspaces/src/schema";
import { startPostgres } from "./postgres";

describe("persisted collaboration authorization", () => {
  let database: Awaited<ReturnType<typeof startPostgres>>;
  let workspaceId: string;
  let projectId: string;
  let taskId: string;
  const tokens = createCursorCodec(crypto.randomUUID() + crypto.randomUUID());
  const issue = (id: string, userId = "owner") =>
    inWorkspace(
      database.db,
      workspaceId,
      { userId },
      (c) => createInvitationToken(c, id),
      false,
      tokens,
    );
  beforeAll(async () => {
    database = await startPostgres();
    await database.db.insert(users).values([
      {
        id: "owner",
        name: "Owner",
        email: "owner@example.test",
      },
      {
        id: "member",
        name: "Member",
        email: "member@example.test",
      },
      {
        id: "stranger",
        name: "Stranger",
        email: "stranger@example.test",
      },
    ]);
    workspaceId = (await claimInstallation(database.db, "owner", "Test")).id;
  });
  afterAll(async () => {
    await database?.stop();
  });
  it("reruns the production schema push command without changing existing domain data", async () => {
    const result = Bun.spawnSync([process.execPath, "scripts/push.ts"], {
      cwd: new URL("../", import.meta.url).pathname,
      env: {
        PATH: process.env.PATH,
        DATABASE_URL: `postgresql://otto_test@localhost/postgres?host=${encodeURIComponent(database.directory)}`,
      },
      stdout: "pipe",
      stderr: "pipe",
      timeout: 15000,
    });
    if (result.exitCode !== 0)
      throw new Error(
        `Schema push command failed: ${result.stderr.toString().slice(-2000)}`,
      );
    expect(
      (await database.db.select().from(users).where(eq(users.id, "owner")))[0]
        ?.name,
    ).toBe("Owner");
  });
  it("closes operator bootstrap after the first owner", async () => {
    await expect(
      claimInstallation(database.db, "stranger", "Other"),
    ).rejects.toMatchObject({ code: "conflict" });
  });
  it("requires a private token and exact recipient, accepts an unverified account once without verifying it", async () => {
    const invitation = await inWorkspace(
      database.db,
      workspaceId,
      { userId: "owner" },
      (c) =>
        createInvitation(c, {
          email: "member@example.test",
          role: "contributor",
        }),
    );
    const token = await issue(invitation.id);
    await expect(
      acceptInvitation(database.db, "stranger", invitation.id, token, tokens),
    ).rejects.toMatchObject({ code: "forbidden" });
    for (const invalid of ["", invitation.id, `${token.slice(0, -1)}!`])
      await expect(
        acceptInvitation(database.db, "member", invitation.id, invalid, tokens),
      ).rejects.toMatchObject({ code: "forbidden" });
    const metadata = await inWorkspace(
      database.db,
      workspaceId,
      { userId: "owner" },
      (c) => getInvitation(c, invitation.id),
      false,
    );
    expect(metadata).not.toHaveProperty("token");
    expect(JSON.stringify(metadata)).not.toContain(token);
    await acceptInvitation(database.db, "member", invitation.id, token, tokens);
    expect(
      (await database.db.select().from(users).where(eq(users.id, "member")))[0]
        ?.emailVerified,
    ).toBe(false);
    await expect(
      acceptInvitation(database.db, "member", invitation.id, token, tokens),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
  it("rejects expired, revoked and differently bound invitations without membership side effects", async () => {
    for (const status of ["expired", "revoked", "other-id"] as const) {
      const invitation = await inWorkspace(
        database.db,
        workspaceId,
        { userId: "owner" },
        (c) =>
          createInvitation(c, {
            email: "stranger@example.test",
            role: "viewer",
          }),
      );
      if (status === "expired")
        await database.db
          .update(invitations)
          .set({ expiresAt: new Date(0) })
          .where(eq(invitations.id, invitation.id));
      const token =
        status === "expired"
          ? tokens.seal(
              [
                invitation.id,
                workspaceId,
                invitation.email,
                invitation.role,
                new Date(0).toISOString(),
                "owner",
              ],
              "otto:invitation:v1",
            )
          : await issue(invitation.id);
      if (status === "revoked")
        await inWorkspace(database.db, workspaceId, { userId: "owner" }, (c) =>
          updateInvitation(c, invitation.id, { status: "revoked" }),
        );
      const target =
        status === "other-id"
          ? await inWorkspace(
              database.db,
              workspaceId,
              { userId: "owner" },
              (c) =>
                createInvitation(c, {
                  email: "stranger@example.test",
                  role: "viewer",
                }),
            )
          : invitation;
      await expect(
        acceptInvitation(database.db, "stranger", target.id, token, tokens),
      ).rejects.toMatchObject({ code: "forbidden" });
      expect(
        (
          await database.db
            .select()
            .from(invitations)
            .where(eq(invitations.id, target.id))
        )[0]?.acceptedAt,
      ).toBeNull();
    }
    expect(
      await database.db
        .select()
        .from(members)
        .where(eq(members.userId, "stranger")),
    ).toHaveLength(0);
  });
  it("reauthorizes the live issuer and permits only one concurrent acceptance", async () => {
    await database.db
      .insert(users)
      .values({ id: "issuer", name: "Issuer", email: "issuer@example.test" });
    await database.db
      .insert(members)
      .values({ workspaceId, userId: "issuer", role: "admin" });
    const invitation = await inWorkspace(
      database.db,
      workspaceId,
      { userId: "issuer" },
      (c) =>
        createInvitation(c, { email: "stranger@example.test", role: "viewer" }),
    );
    const token = await issue(invitation.id, "issuer");
    await inWorkspace(database.db, workspaceId, { userId: "owner" }, (c) =>
      updateMemberRole(c, "issuer", "viewer"),
    );
    await expect(
      acceptInvitation(database.db, "stranger", invitation.id, token, tokens),
    ).rejects.toMatchObject({ code: "forbidden" });
    await inWorkspace(database.db, workspaceId, { userId: "owner" }, (c) =>
      deleteMember(c, "issuer"),
    );
    await expect(
      acceptInvitation(database.db, "stranger", invitation.id, token, tokens),
    ).rejects.toMatchObject({ code: "forbidden" });
    const ownerToken = await issue(invitation.id);
    const results = await Promise.allSettled([
      acceptInvitation(
        database.db,
        "stranger",
        invitation.id,
        ownerToken,
        tokens,
      ),
      acceptInvitation(
        database.db,
        "stranger",
        invitation.id,
        ownerToken,
        tokens,
      ),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toMatchObject([{ reason: { code: "forbidden" } }]);
    expect(
      await database.db
        .select()
        .from(members)
        .where(eq(members.userId, "stranger")),
    ).toHaveLength(1);
  });
  it("persists projects and denies nonmembers even in the same workspace", async () => {
    projectId = (
      await inWorkspace(database.db, workspaceId, { userId: "owner" }, (c) =>
        createProject(c, { title: "Private project" }),
      )
    ).id;
    await expect(
      inWorkspace(database.db, workspaceId, { userId: "member" }, (c) =>
        getProject(c, projectId),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    await inWorkspace(database.db, workspaceId, { userId: "owner" }, (c) =>
      upsertProjectMember(c, projectId, "member", "contributor"),
    );
  });
  it("keeps task ownership separate from assignment and human-only Done", async () => {
    const task = await inWorkspace(
      database.db,
      workspaceId,
      { userId: "member" },
      (c) => createTask(c, { title: "Persist this", projectId }),
    );
    taskId = task.id;
    expect(task.ownerId).toBe("member");
    await expect(
      inWorkspace(
        database.db,
        workspaceId,
        { userId: "member", agentId: crypto.randomUUID() },
        (c) => setTaskStatus(c, taskId, { status: "done", editToken: 0 }),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      inWorkspace(database.db, workspaceId, { userId: "owner" }, (c) =>
        assertNoOpenOwnedTasks(c, "member"),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    await inWorkspace(database.db, workspaceId, { userId: "member" }, (c) =>
      setTaskStatus(c, taskId, { status: "done", editToken: 0 }),
    );
    await expect(
      inWorkspace(database.db, workspaceId, { userId: "member" }, (c) =>
        setTaskStatus(c, taskId, { status: "doing", editToken: 0 }),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
  });
  it("denies persisted data after workspace membership removal", async () => {
    const unused = await inWorkspace(
      database.db,
      workspaceId,
      { userId: "owner" },
      (c) =>
        createInvitation(c, {
          email: "member@example.test",
          role: "contributor",
        }),
    );
    const token = await issue(unused.id);
    await inWorkspace(
      database.db,
      workspaceId,
      { userId: "owner" },
      async (c) => {
        await assertNoOpenOwnedTasks(c, "member");
        await deleteMember(c, "member");
      },
    );
    await expect(
      inWorkspace(database.db, workspaceId, { userId: "member" }, (c) =>
        getTask(c, taskId),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      acceptInvitation(database.db, "member", unused.id, token, tokens),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
  it("authenticates with Better Auth without granting a workspace", async () => {
    // Ephemeral authentication fixture remains in memory and never reaches logs or configuration files.
    const auth = createAuth(
      database.db,
      crypto.randomUUID() + crypto.randomUUID(),
      "http://localhost:43001",
    );
    const password = crypto.randomUUID() + crypto.randomUUID();
    const response = await auth.handler(
      new Request("http://localhost:43001/api/auth/sign-up/email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:43001",
        },
        body: JSON.stringify({
          name: "New human",
          email: "new@example.test",
          password,
        }),
      }),
    );
    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie");
    expect(cookie).toBeTruthy();
    const session = await auth.api.getSession({
      headers: new Headers({ cookie: cookie ?? "" }),
    });
    expect(session?.user.email).toBe("new@example.test");
    await expect(
      inWorkspace(
        database.db,
        workspaceId,
        { userId: session?.user.id ?? "" },
        (c) => getProject(c, projectId),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});
