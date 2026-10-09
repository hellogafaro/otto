import { createCursorCodec } from "@otto/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { createAgent } from "../packages/agents/src";
import { createProject, upsertProjectMember } from "../packages/projects/src";
import { projectMembers } from "../packages/projects/src/schema";
import { createTask } from "../packages/tasks/src";
import {
  createTaskComment,
  deleteTaskComment,
  getTaskComment,
  getTaskComments,
  updateTaskComment,
  validateTaskCommentBody,
  validateTaskCommentInput,
  validateTaskCommentQuery,
  validateTaskCommentUpdate,
} from "../packages/tasks/src/comments";
import { taskComments } from "../packages/tasks/src/comments-schema";
import { getCursor, inWorkspace } from "../packages/workspaces/src";
import { members, workspaces } from "../packages/workspaces/src/schema";
import { startNativeTestApp } from "./fixtures/native-app";

const entry = z
  .object({
    id: z.uuid(),
    workspaceId: z.uuid(),
    taskId: z.uuid(),
    createdBy: z.string(),
    agentId: z.uuid().nullable(),
    body: z.string(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
const page = z.object({ items: z.array(entry), next: z.string().nullable() });

describe("Task comments through normal authentication and private PostgreSQL", () => {
  let app: Awaited<ReturnType<typeof startNativeTestApp>>;
  let workspaceId: string;
  let projectId: string;
  let taskId: string;
  let privateTaskId: string;
  let foreignTaskId: string;
  let foreignWorkspaceId: string;
  let agentId: string;
  let otherAgentId: string;
  let privateAgentId: string;
  let owner: { id: string; cookie: string };
  let author: { id: string; cookie: string };
  let viewer: { id: string; cookie: string };
  let humanComment: z.infer<typeof entry>;
  let agentComment: Awaited<ReturnType<typeof createTaskComment>>;
  const cursors = createCursorCodec(crypto.randomUUID() + crypto.randomUUID());
  const scope = <T>(
    userId: string,
    work: Parameters<typeof inWorkspace<T>>[3],
    actingAgentId?: string,
    selectedWorkspaceId = workspaceId,
  ) =>
    inWorkspace(
      app.database.db,
      selectedWorkspaceId,
      { userId, agentId: actingAgentId },
      work,
      true,
      cursors,
    );
  const request = (
    path: string,
    method = "GET",
    json?: unknown,
    cookie = owner.cookie,
    origin = app.origin,
  ) =>
    fetch(`${app.apiOrigin}/api${path}`, {
      method,
      headers: { cookie, origin, "content-type": "application/json" },
      ...(json === undefined ? {} : { body: JSON.stringify(json) }),
    });
  const url = () => `/workspaces/${workspaceId}/task-comments`;
  const snapshot = async () => ({
    cursor: await scope(owner.id, getCursor),
    rows: (await app.database.db.select().from(taskComments)).sort((a, b) =>
      a.id.localeCompare(b.id),
    ),
  });
  beforeAll(async () => {
    app = await startNativeTestApp();
    const signup = async (
      name: string,
      role: "owner" | "contributor" | "viewer",
    ) => {
      const person = await app.provisionUser({ name, role });
      const response = await fetch(`${app.apiOrigin}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { origin: app.origin, "content-type": "application/json" },
        body: JSON.stringify({
          email: person.email,
          password: person.password,
        }),
      });
      expect(response.status).toBe(200);
      return {
        id: person.id,
        cookie: response.headers.get("set-cookie") ?? "",
        workspaceId: person.workspaceId,
      };
    };
    const registeredOwner = await signup("Comment owner", "owner");
    owner = registeredOwner;
    author = await signup("Comment author", "contributor");
    viewer = await signup("Comment reader", "viewer");
    workspaceId = registeredOwner.workspaceId;
    await scope(owner.id, async (c) => {
      projectId = (await createProject(c, { title: "Comment project" })).id;
      await upsertProjectMember(c, projectId, author.id, "contributor");
      taskId = (await createTask(c, { projectId, title: "Comment task" })).id;
      const privateProject = await createProject(c, { title: "Restricted" });
      privateTaskId = (
        await createTask(c, { projectId: privateProject.id, title: "Private" })
      ).id;
      agentId = (
        await createAgent(c, {
          visibility: "workspace",
          title: "Comment agent",
          instructions: "Test comments only",
          model: "fixture-only",
          projectId,
        })
      ).id;
      otherAgentId = (
        await createAgent(c, {
          visibility: "workspace",
          title: "Another agent",
          instructions: "Test comments only",
          model: "fixture-only",
          projectId,
        })
      ).id;
      privateAgentId = (
        await createAgent(c, {
          visibility: "user",
          title: "Owner private agent",
          instructions: "Test comments only",
          model: "fixture-only",
        })
      ).id;
    });
    foreignWorkspaceId = crypto.randomUUID();
    await app.database.db.insert(workspaces).values({
      id: foreignWorkspaceId,
      title: "Other workspace",
    });
    await app.database.db.insert(members).values({
      workspaceId: foreignWorkspaceId,
      userId: owner.id,
      role: "owner",
    });
    foreignTaskId = await scope(
      owner.id,
      async (c) => {
        const project = await createProject(c, { title: "Other project" });
        return (await createTask(c, { projectId: project.id, title: "Other" }))
          .id;
      },
      undefined,
      foreignWorkspaceId,
    );
  });
  afterAll(async () => app?.stop());

  it("persists server-derived human provenance and reads it after a server restart", async () => {
    const before = await snapshot();
    const started = Date.now();
    const response = await request(
      url(),
      "POST",
      { taskId, body: "A persisted comment" },
      author.cookie,
    );
    expect(response.status).toBe(200);
    humanComment = entry.parse(await response.json());
    expect(humanComment).toMatchObject({
      workspaceId,
      taskId,
      createdBy: author.id,
      agentId: null,
      body: "A persisted comment",
    });
    expect(Date.parse(humanComment.createdAt)).toBeGreaterThanOrEqual(started);
    expect(humanComment.updatedAt).toBe(humanComment.createdAt);
    expect((await snapshot()).cursor).toBe(before.cursor + 1);
    await app.restart();
    expect(
      entry.parse(await (await request(`${url()}/${humanComment.id}`)).json()),
    ).toEqual(humanComment);
    expect(
      page.parse(await (await request(`${url()}?taskId=${taskId}`)).json())
        .items,
    ).toEqual([humanComment]);
  });

  it("allows only an author with current Task writer access to edit or delete", async () => {
    const before = await snapshot();
    for (const method of ["PATCH", "DELETE"]) {
      expect(
        (
          await request(
            `${url()}/${humanComment.id}`,
            method,
            method === "PATCH"
              ? { body: "Owner cannot impersonate author" }
              : undefined,
          )
        ).status,
      ).toBe(403);
    }
    expect(await snapshot()).toEqual(before);
    const response = await request(
      `${url()}/${humanComment.id}`,
      "PATCH",
      { body: "Edited by its author" },
      author.cookie,
    );
    expect(response.status).toBe(200);
    const updated = entry.parse(await response.json());
    expect(updated).toMatchObject({
      ...humanComment,
      body: "Edited by its author",
      updatedAt: updated.updatedAt,
    });
    expect(Date.parse(updated.updatedAt)).toBeGreaterThan(
      Date.parse(updated.createdAt),
    );
    humanComment = updated;
    const disposable = entry.parse(
      await (
        await request(
          url(),
          "POST",
          { taskId, body: "Delete this" },
          author.cookie,
        )
      ).json(),
    );
    expect(
      (
        await request(
          `${url()}/${disposable.id}`,
          "DELETE",
          undefined,
          author.cookie,
        )
      ).status,
    ).toBe(200);
    expect((await request(`${url()}/${disposable.id}`)).status).toBe(404);
  });

  it("denies spoofed provenance, reassociation, invalid bodies and unknown list filters without writes", async () => {
    const before = await snapshot();
    for (const extra of [
      { createdBy: owner.id },
      { agentId },
      { workspaceId: foreignWorkspaceId },
      { createdAt: "2000-01-01T00:00:00Z" },
      { id: crypto.randomUUID() },
    ])
      expect(
        (
          await request(
            url(),
            "POST",
            { taskId, body: "Spoof", ...extra },
            author.cookie,
          )
        ).status,
      ).toBe(400);
    for (const extra of [
      { createdBy: owner.id },
      { agentId },
      { taskId: privateTaskId },
      { updatedAt: "2000-01-01T00:00:00Z" },
    ])
      expect(
        (
          await request(
            `${url()}/${humanComment.id}`,
            "PATCH",
            { body: "Spoof", ...extra },
            author.cookie,
          )
        ).status,
      ).toBe(400);
    for (const body of ["", "  \n\t", "😀".repeat(2501), null, 42])
      expect(
        (await request(url(), "POST", { taskId, body }, author.cookie)).status,
      ).toBe(400);
    for (const query of [
      "",
      `taskId=${taskId}&limit=0`,
      `taskId=${taskId}&limit=101`,
      `taskId=${taskId}&sort=body`,
      `taskId=${taskId}&after=bad`,
      `taskId=${taskId}&createdBy=${owner.id}`,
      `taskId=${taskId}&order=desc`,
    ])
      expect((await request(`${url()}?${query}`)).status).toBe(400);
    await expect(
      scope(author.id, (c) =>
        createTaskComment(c, { taskId, body: "Spoof", createdBy: owner.id } as {
          taskId: string;
          body: string;
        }),
      ),
    ).rejects.toMatchObject({ code: "invalid" });
    await expect(
      scope(author.id, (c) =>
        updateTaskComment(c, humanComment.id, { body: "Spoof", agentId } as {
          body: string;
        }),
      ),
    ).rejects.toMatchObject({ code: "invalid" });
    expect(await snapshot()).toEqual(before);
  });

  it("never widens Task Project/workspace access through comments or mentions", async () => {
    const secret = entry.parse(
      await (
        await request(url(), "POST", {
          taskId: privateTaskId,
          body: `@[Comment author](user:${author.id})`,
        })
      ).json(),
    );
    const before = await snapshot();
    expect(
      (await request(`${url()}/${secret.id}`, "GET", undefined, author.cookie))
        .status,
    ).toBe(403);
    expect(
      (
        await request(
          `${url()}?taskId=${privateTaskId}`,
          "GET",
          undefined,
          author.cookie,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(
          url(),
          "POST",
          { taskId: privateTaskId, body: "Not a project member" },
          author.cookie,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(url(), "POST", {
          taskId: foreignTaskId,
          body: "Wrong workspace",
        })
      ).status,
    ).toBe(404);
    expect((await request(`${url()}?taskId=${foreignTaskId}`)).status).toBe(
      404,
    );
    expect(
      (
        await request(
          `/workspaces/${foreignWorkspaceId}/task-comments/${humanComment.id}`,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await request(
          `/workspaces/${foreignWorkspaceId}/task-comments?taskId=${foreignTaskId}`,
          "GET",
          undefined,
          author.cookie,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(
          `${url()}?taskId=${taskId}`,
          "GET",
          undefined,
          viewer.cookie,
        )
      ).status,
    ).toBe(403);
    expect(await snapshot()).toEqual(before);
    await scope(owner.id, (c) =>
      upsertProjectMember(c, projectId, viewer.id, "contributor"),
    );
    expect(
      (
        await request(
          `${url()}?taskId=${taskId}`,
          "GET",
          undefined,
          viewer.cookie,
        )
      ).status,
    ).toBe(200);
    const readerState = await snapshot();
    expect(
      (
        await request(
          url(),
          "POST",
          { taskId, body: "Viewer write" },
          viewer.cookie,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(
          `${url()}/${humanComment.id}`,
          "PATCH",
          { body: "Viewer edit" },
          viewer.cookie,
        )
      ).status,
    ).toBe(403);
    expect(await snapshot()).toEqual(readerState);
  });

  it("keeps actual agent and human sponsor provenance distinct and matches both on mutations", async () => {
    agentComment = await scope(
      author.id,
      (c) =>
        createTaskComment(c, { taskId, body: "Actually authored by an agent" }),
      agentId,
    );
    expect(agentComment).toMatchObject({
      createdBy: author.id,
      agentId,
      workspaceId,
      taskId,
    });
    expect(
      entry.parse(await (await request(`${url()}/${agentComment.id}`)).json()),
    ).toMatchObject({ createdBy: author.id, agentId });
    const before = await snapshot();
    for (const [userId, actingAgent] of [
      [author.id, undefined],
      [author.id, otherAgentId],
      [owner.id, agentId],
    ] as const) {
      await expect(
        scope(
          userId,
          (c) =>
            updateTaskComment(c, agentComment.id, { body: "Impersonation" }),
          actingAgent,
        ),
      ).rejects.toMatchObject({ code: "forbidden" });
      await expect(
        scope(
          userId,
          (c) => deleteTaskComment(c, agentComment.id),
          actingAgent,
        ),
      ).rejects.toMatchObject({ code: "forbidden" });
    }
    await expect(
      scope(
        author.id,
        (c) =>
          updateTaskComment(c, humanComment.id, {
            body: "Agent cannot edit human",
          }),
        agentId,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      scope(
        author.id,
        (c) =>
          createTaskComment(c, { taskId, body: "Private agent impersonation" }),
        privateAgentId,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      scope(
        owner.id,
        (c) =>
          createTaskComment(c, {
            taskId: privateTaskId,
            body: "Outside agent project",
          }),
        agentId,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      scope(
        author.id,
        (c) => createTaskComment(c, { taskId, body: "Missing agent" }),
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(await snapshot()).toEqual(before);
    const updated = await scope(
      author.id,
      (c) =>
        updateTaskComment(c, agentComment.id, { body: "Agent correction" }),
      agentId,
    );
    expect(updated).toMatchObject({
      createdAt: agentComment.createdAt,
      createdBy: author.id,
      agentId,
      body: "Agent correction",
    });
    agentComment = updated;
    const temporary = await scope(
      author.id,
      (c) => createTaskComment(c, { taskId, body: "Temporary agent comment" }),
      agentId,
    );
    await scope(author.id, (c) => deleteTaskComment(c, temporary.id), agentId);
    await expect(
      scope(author.id, (c) => getTaskComment(c, temporary.id)),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("bounds and seals chronological pages, including deleted cursor rows and scope/actor replay denial", async () => {
    const first = page.parse(
      await (
        await request(`${url()}?taskId=${taskId}&sort=createdAt&limit=1`)
      ).json(),
    );
    expect(first.items).toHaveLength(1);
    expect(first.next).not.toBeNull();
    expect(first.next).not.toContain(first.items[0]?.createdAt);
    const second = page.parse(
      await (
        await request(
          `${url()}?taskId=${taskId}&sort=createdAt&limit=1&after=${first.next}`,
        )
      ).json(),
    );
    expect(second.items).toHaveLength(1);
    expect(second.next).toBeNull();
    expect(
      new Set([...first.items, ...second.items].map((comment) => comment.id)),
    ).toEqual(new Set([humanComment.id, agentComment.id]));
    expect(
      (
        await request(
          `${url()}?taskId=${privateTaskId}&sort=createdAt&after=${first.next}`,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await request(
          `${url()}?taskId=${taskId}&sort=createdAt&after=${first.next}`,
          "GET",
          undefined,
          author.cookie,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await request(
          `${url()}?taskId=${taskId}&sort=updatedAt&after=${first.next}`,
        )
      ).status,
    ).toBe(400);
    const owned = await scope(owner.id, (c) =>
      createTaskComment(c, { taskId: privateTaskId, body: "First" }),
    );
    const next = await scope(owner.id, (c) =>
      createTaskComment(c, { taskId: privateTaskId, body: "Second" }),
    );
    const position = await scope(owner.id, (c) =>
      getTaskComments(c, {
        taskId: privateTaskId,
        sort: "createdAt",
        order: "desc",
        limit: 1,
      }),
    );
    expect(position.items[0]?.id).toBe(next.id);
    await scope(owner.id, (c) => deleteTaskComment(c, next.id));
    const continued = await scope(owner.id, (c) =>
      getTaskComments(c, {
        taskId: privateTaskId,
        sort: "createdAt",
        order: "desc",
        limit: 1,
        after: position.next ?? undefined,
      }),
    );
    expect(continued.items[0]?.id).toBe(owned.id);
    expect(
      (await scope(owner.id, (c) => getTaskComments(c, { taskId, limit: 100 })))
        .items,
    ).toHaveLength(2);
  });

  it("accepts independent concurrent human/agent writers and the exact UTF-8 body boundary", async () => {
    const before = await snapshot();
    const boundary = "😀".repeat(2500);
    const ownerResponse = request(url(), "POST", { taskId, body: boundary });
    const authorResponse = request(
      url(),
      "POST",
      { taskId, body: "Concurrent human author" },
      author.cookie,
    );
    const [ownerHuman, authorHuman, ownerAgent, authorAgent] =
      await Promise.all([
        ownerResponse.then(async (response) => {
          expect(response.status).toBe(200);
          return entry.parse(await response.json());
        }),
        authorResponse.then(async (response) => {
          expect(response.status).toBe(200);
          return entry.parse(await response.json());
        }),
        scope(
          owner.id,
          (c) =>
            createTaskComment(c, { taskId, body: "Concurrent first agent" }),
          agentId,
        ),
        scope(
          author.id,
          (c) =>
            createTaskComment(c, { taskId, body: "Concurrent second agent" }),
          otherAgentId,
        ),
      ]);
    expect(ownerHuman).toMatchObject({
      createdBy: owner.id,
      agentId: null,
      body: boundary,
    });
    expect(authorHuman).toMatchObject({ createdBy: author.id, agentId: null });
    expect(ownerAgent).toMatchObject({ createdBy: owner.id, agentId });
    expect(authorAgent).toMatchObject({
      createdBy: author.id,
      agentId: otherAgentId,
    });
    expect(
      new Set(
        [ownerHuman, authorHuman, ownerAgent, authorAgent].map(
          (comment) => comment.id,
        ),
      ).size,
    ).toBe(4);
    expect((await snapshot()).cursor).toBe(before.cursor + 4);
    expect(
      entry.parse(await (await request(`${url()}/${ownerHuman.id}`)).json())
        .body,
    ).toBe(boundary);
    await Promise.all([
      scope(owner.id, (c) => deleteTaskComment(c, ownerHuman.id)),
      scope(author.id, (c) => deleteTaskComment(c, authorHuman.id)),
      scope(owner.id, (c) => deleteTaskComment(c, ownerAgent.id), agentId),
      scope(
        author.id,
        (c) => deleteTaskComment(c, authorAgent.id),
        otherAgentId,
      ),
    ]);
    expect((await snapshot()).rows).toEqual(before.rows);
  });

  it("reauthorizes all operations after Project role downgrade and removal, without altering saved provenance", async () => {
    await app.database.db
      .update(projectMembers)
      .set({ role: "viewer" })
      .where(eq(projectMembers.userId, author.id));
    const downgraded = await snapshot();
    expect(
      (
        await request(
          `${url()}/${humanComment.id}`,
          "GET",
          undefined,
          author.cookie,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await request(
          `${url()}/${humanComment.id}`,
          "PATCH",
          { body: "Downgraded" },
          author.cookie,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(
          `${url()}/${humanComment.id}`,
          "DELETE",
          undefined,
          author.cookie,
        )
      ).status,
    ).toBe(403);
    await expect(
      scope(
        author.id,
        (c) =>
          updateTaskComment(c, agentComment.id, { body: "Downgraded agent" }),
        agentId,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await snapshot()).toEqual(downgraded);
    await app.database.db
      .delete(projectMembers)
      .where(eq(projectMembers.userId, author.id));
    const removed = await snapshot();
    for (const [method, body] of [
      ["GET", undefined],
      ["PATCH", { body: "Removed" }],
      ["DELETE", undefined],
    ] as const)
      expect(
        (
          await request(
            `${url()}/${humanComment.id}`,
            method,
            body,
            author.cookie,
          )
        ).status,
      ).toBe(403);
    expect(
      (
        await request(
          `${url()}?taskId=${taskId}`,
          "GET",
          undefined,
          author.cookie,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(
          url(),
          "POST",
          { taskId, body: "Removed writer" },
          author.cookie,
        )
      ).status,
    ).toBe(403);
    expect(await snapshot()).toEqual(removed);
    await scope(owner.id, (c) =>
      upsertProjectMember(c, projectId, author.id, "contributor"),
    );
    await app.database.db.delete(members).where(eq(members.userId, author.id));
    const revoked = await snapshot();
    expect(
      (
        await request(
          `${url()}/${humanComment.id}`,
          "GET",
          undefined,
          author.cookie,
        )
      ).status,
    ).toBe(403);
    await expect(
      scope(
        author.id,
        (c) => createTaskComment(c, { taskId, body: "Revoked sponsor" }),
        agentId,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await snapshot()).toEqual(revoked);
    expect(
      entry.parse(await (await request(`${url()}/${humanComment.id}`)).json()),
    ).toEqual(humanComment);
  });

  it("retains normal authentication/origin protections and SQL scope constraints", async () => {
    const before = await snapshot();
    expect(
      (await request(`${url()}?taskId=${taskId}`, "GET", undefined, "")).status,
    ).toBe(401);
    expect(
      (
        await request(
          url(),
          "POST",
          { taskId, body: "Wrong origin" },
          owner.cookie,
          "http://untrusted.example.test",
        )
      ).status,
    ).toBe(403);
    await expect(
      app.database.db.insert(taskComments).values({
        workspaceId,
        taskId: foreignTaskId,
        createdBy: owner.id,
        body: "Cross workspace",
      }),
    ).rejects.toMatchObject({
      cause: { code: "23503", constraint: "task_comments_task_workspace_fk" },
    });
    await expect(
      app.database.db.insert(taskComments).values({
        workspaceId,
        taskId,
        createdBy: "missing",
        body: "Missing human",
      }),
    ).rejects.toMatchObject({
      cause: { code: "23503", constraint: "task_comments_createdBy_fk" },
    });
    await expect(
      app.database.db.insert(taskComments).values({
        workspaceId,
        taskId,
        createdBy: owner.id,
        agentId: crypto.randomUUID(),
        body: "Missing agent",
      }),
    ).rejects.toMatchObject({
      cause: { code: "23503", constraint: "task_comments_agent_workspace_fk" },
    });
    for (const body of ["", " ", "😀".repeat(2501)])
      await expect(
        app.database.db
          .insert(taskComments)
          .values({ workspaceId, taskId, createdBy: owner.id, body }),
      ).rejects.toMatchObject({
        cause: { code: "23514", constraint: "task_comments_body_bytes" },
      });
    expect(await snapshot()).toEqual(before);
  });

  it("exports strict typed validators for native callers", () => {
    expect(validateTaskCommentBody("😀".repeat(2500))).toHaveLength(5000);
    expect(validateTaskCommentInput({ taskId, body: "Exact body" })).toEqual({
      taskId,
      body: "Exact body",
    });
    expect(validateTaskCommentUpdate({ body: "Correction" })).toEqual({
      body: "Correction",
    });
    for (const limit of [NaN, Infinity, -1, 0, 1.5, 101])
      expect(() => validateTaskCommentQuery({ taskId, limit })).toThrow();
    for (const input of [null, [], {}, { body: "OK", createdBy: "spoof" }])
      expect(() =>
        validateTaskCommentUpdate(input as { body: string }),
      ).toThrow();
  });
});
