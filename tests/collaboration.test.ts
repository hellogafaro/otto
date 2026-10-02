import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuth } from "../apps/server/src/auth";
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
  deleteMember,
  inWorkspace,
} from "../packages/workspaces/src";
import { users } from "../packages/workspaces/src/schema";
import { startPostgres } from "./postgres";

describe("persisted collaboration authorization", () => {
  let database: Awaited<ReturnType<typeof startPostgres>>;
  let workspaceId: string;
  let projectId: string;
  let taskId: string;
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
        id: "member",
        name: "Member",
        email: "member@example.test",
        emailVerified: true,
      },
      {
        id: "stranger",
        name: "Stranger",
        email: "stranger@example.test",
        emailVerified: true,
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
  it("requires verified recipient and consumes an invitation once", async () => {
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
    await expect(
      acceptInvitation(database.db, "stranger", invitation.id),
    ).rejects.toMatchObject({ code: "forbidden" });
    await database.db
      .update(users)
      .set({ emailVerified: false })
      .where(eq(users.id, "member"));
    await expect(
      acceptInvitation(database.db, "member", invitation.id),
    ).rejects.toMatchObject({ code: "forbidden" });
    await database.db
      .update(users)
      .set({ emailVerified: true })
      .where(eq(users.id, "member"));
    await acceptInvitation(database.db, "member", invitation.id);
    await expect(
      acceptInvitation(database.db, "member", invitation.id),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
  it("persists projects and denies nonmembers even in the same workspace", async () => {
    projectId = (
      await inWorkspace(database.db, workspaceId, { userId: "owner" }, (c) =>
        createProject(c, { name: "Private project" }),
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
      acceptInvitation(database.db, "member", unused.id),
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
