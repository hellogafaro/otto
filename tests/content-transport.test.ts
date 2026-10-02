import { DomainError } from "@otto/shared";
import { chromium } from "@playwright/test";
import type { Server } from "bun";
import { eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { z } from "zod";
import { createApp } from "../apps/server/src/app";
import { createAuth } from "../apps/server/src/auth";
import { startQueue } from "../apps/server/src/queue";
import { createRealtime, type RealtimeData } from "../apps/server/src/realtime";
import {
  type ArtifactStorage,
  previewArtifact,
} from "../packages/artifacts/src";
import { documents } from "../packages/documents/src/schema";
import { runs } from "../packages/runs/src/schema";
import { updateTask } from "../packages/tasks/src";
import { claimInstallation, inWorkspace } from "../packages/workspaces/src";
import { members, users } from "../packages/workspaces/src/schema";
import { harnesses } from "./fixtures/harnesses";
import { startPostgres } from "./postgres";

const record = z
  .object({ id: z.string(), editToken: z.number().optional() })
  .passthrough();
const page = z.object({ items: z.array(record), next: z.string().nullable() });

describe("content through real HTTP/WebSocket/PostgreSQL; object bytes use a named in-memory fixture", () => {
  let database: Awaited<ReturnType<typeof startPostgres>>;
  let boss: PgBoss;
  let server: Server<RealtimeData>;
  let app: ReturnType<typeof createApp>;
  let realtime: ReturnType<typeof createRealtime>;
  let origin: string;
  let workspaceId: string;
  let owner: string;
  let collaborator: string;
  let viewer: string;
  let cookie = "";
  let collaboratorCookie = "";
  let viewerCookie = "";
  let projectId: string;
  let conversationId: string;
  const objects = new Map<string, Uint8Array>();
  let afterStorageRead: (() => Promise<void>) | undefined;
  const storage: ArtifactStorage = {
    async put(key, bytes) {
      if (!objects.has(key)) objects.set(key, bytes.slice());
    },
    async get(key) {
      const value = objects.get(key);
      if (!value) throw new Error("Missing fixture bytes");
      await afterStorageRead?.();
      return value.slice();
    },
  };
  const request = (
    path: string,
    method = "GET",
    input?: unknown,
    authCookie = cookie,
  ) =>
    fetch(`${origin}${path}`, {
      method,
      headers: {
        Cookie: authCookie,
        Origin: origin,
        "Content-Type": "application/json",
      },
      body: input === undefined ? undefined : JSON.stringify(input),
    });
  const content = (
    path: string,
    method = "GET",
    input?: unknown,
    authCookie = cookie,
  ) =>
    request(`/api/workspaces/${workspaceId}${path}`, method, input, authCookie);
  const api = (
    path: string,
    method = "GET",
    input?: unknown,
    authCookie = cookie,
  ) =>
    request(`/api/workspaces/${workspaceId}${path}`, method, input, authCookie);
  const saved = async (response: Response) => {
    expect(response.status, await response.clone().text()).toBe(200);
    return record.parse(await response.json());
  };
  const createDoc = async (
    body = "visible body",
    visibility: "user" | "workspace" = "workspace",
  ) =>
    saved(
      await api("/documents", "POST", {
        title: "A document",
        body,
        visibility,
      }),
    );
  const createArtifact = async (
    text = "immutable bytes",
    sourceRunId?: string,
  ) =>
    saved(
      await api("/artifacts", "POST", {
        requestId: crypto.randomUUID(),
        title: "Reference file",
        type: "text",
        visibility: "workspace",
        mediaType: "text/plain",
        bytes: Buffer.from(text).toString("base64"),
        sourceRunId,
      }),
    );
  const preview = async (
    selection: unknown,
    existing?: { id: string; editToken: number },
  ) => saved(await content("/shares/preview", "POST", { selection, existing }));
  const publish = async (share: { id: string; editToken?: number }) =>
    saved(
      await content(`/shares/${share.id}/publish`, "POST", {
        editToken: share.editToken ?? 0,
      }),
    );
  beforeAll(async () => {
    database = await startPostgres();
    boss = await startQueue(database.db, database.pool, {
      workers: false,
      install: true,
    });
    server = Bun.serve<RealtimeData>({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(req, server) {
        if (new URL(req.url).pathname === "/api/realtime") {
          const data = await realtime.prepare(req);
          if (data instanceof Response) return data;
          if (server.upgrade(req, { data })) return;
          return new Response(null, { status: 400 });
        }
        return app.fetch(req);
      },
      websocket: {
        open: (ws) => realtime.websocket.open(ws),
        message: (ws) => realtime.websocket.message(ws),
        close: (ws) => realtime.websocket.close(ws),
      },
    });
    origin = `http://127.0.0.1:${server.port}`;
    const auth = createAuth(
      database.db,
      crypto.randomUUID() + crypto.randomUUID(),
      origin,
    );
    const options = { db: database.db, boss, auth, origin, storage };
    app = createApp({ ...options, harnesses });
    realtime = createRealtime(options);
    async function signup(name: string) {
      const response = await request(
        "/api/auth/sign-up/email",
        "POST",
        {
          name,
          email: `${name}@example.test`,
          password: crypto.randomUUID() + crypto.randomUUID(),
        },
        "",
      );
      expect(response.status).toBe(200);
      const value = response.headers.get("set-cookie") ?? "";
      const session = await auth.api.getSession({
        headers: new Headers({ cookie: value }),
      });
      if (!session) throw new Error("No login session");
      return { cookie: value, id: session.user.id };
    }
    const first = await signup("owner");
    owner = first.id;
    cookie = first.cookie;
    const second = await signup("collaborator");
    collaborator = second.id;
    collaboratorCookie = second.cookie;
    const third = await signup("viewer");
    viewer = third.id;
    viewerCookie = third.cookie;
    workspaceId = (
      await claimInstallation(database.db, owner, "Content transport")
    ).id;
    // Verified-email fixture; email delivery qualification belongs to the operations lane.
    await database.db.update(users).set({ emailVerified: true });
    for (const [userId, email, role, authCookie] of [
      [
        collaborator,
        "collaborator@example.test",
        "contributor",
        collaboratorCookie,
      ],
      [viewer, "viewer@example.test", "viewer", viewerCookie],
    ] as const) {
      const invite = await saved(
        await api("/invitations", "POST", { email, role }),
      );
      expect(
        (
          await request(
            `/api/invitations/${invite.id}/accept`,
            "POST",
            {},
            authCookie,
          )
        ).status,
      ).toBe(200);
      expect(userId).toBeTruthy();
    }
    projectId = (
      await saved(await api("/projects", "POST", { title: "Project alpha" }))
    ).id;
    for (const userId of [collaborator, viewer])
      expect(
        (
          await api(`/projects/${projectId}/members`, "POST", {
            userId,
            role: userId === viewer ? "viewer" : "contributor",
          })
        ).status,
      ).toBe(200);
    conversationId = (
      await saved(
        await api("/conversations", "POST", {
          title: "Content discussion",
          visibility: "workspace",
          projectId,
        }),
      )
    ).id;
  });
  afterAll(async () => {
    afterStorageRead = undefined;
    realtime?.close();
    await server?.stop(true);
    await boss?.stop();
    await database?.stop();
  });

  it("round-trips Otto titles through HTTP without renaming human names or native identifiers", async () => {
    const project = await saved(
      await api("/projects", "POST", { title: "Title contract" }),
    );
    const agent = z.object({ agent: record }).parse(
      await (
        await api("/agents", "POST", {
          title: "Agent title",
          instructions: "Work",
          harness: "codex-acp",
          model: "configured-id",
        })
      ).json(),
    ).agent;
    const connection = await saved(
      await api("/connections", "POST", {
        title: "App title",
        type: "mcp",
        accountRef: "fixture-account",
      }),
    );
    const subscription = await saved(
      await api("/subscriptions", "POST", { title: "Subscription title" }),
    );
    const automation = await saved(
      await api("/automations", "POST", {
        title: "Automation title",
        agentId: agent.id,
        conversationId,
        type: "script",
        body: "fixture",
        status: "disabled",
        timezone: "UTC",
      }),
    );
    for (const [path, row] of [
      ["projects", project],
      ["agents", agent],
      ["connections", connection],
      ["subscriptions", subscription],
      ["automations", automation],
    ] as const) {
      expect(row).toHaveProperty("title");
      expect(row).not.toHaveProperty("name");
      const changes =
        path === "agents" || path === "automations"
          ? { title: "Updated title", editToken: row.editToken }
          : { title: "Updated title" };
      const updated = await saved(
        await api(`/${path}/${row.id}`, "PATCH", changes),
      );
      expect(updated.title).toBe("Updated title");
      expect(updated).not.toHaveProperty("name");
      const read = await saved(await api(`/${path}/${row.id}`));
      expect(read.title).toBe("Updated title");
      expect(read).not.toHaveProperty("name");
      expect(
        (
          await database.pool.query(`select name from ${path} where id=$1`, [
            row.id,
          ])
        ).rows[0]?.name,
      ).toBe("Updated title");
    }
    const workspaces = page.parse(
      await (await request("/api/workspaces")).json(),
    );
    expect(
      workspaces.items.find((row) => row.id === workspaceId),
    ).toMatchObject({ title: "Content transport" });
    expect(
      workspaces.items.find((row) => row.id === workspaceId),
    ).not.toHaveProperty("name");
    const humans = z
      .object({
        items: z.array(z.object({ userId: z.string(), name: z.string() })),
      })
      .parse(await (await api("/members")).json());
    expect(humans.items.find((row) => row.userId === owner)).toHaveProperty(
      "name",
    );
    expect(humans.items.find((row) => row.userId === owner)).not.toHaveProperty(
      "title",
    );
    const fieldId = crypto.randomUUID();
    const collection = await saved(
      await api("/collections", "POST", {
        title: "Collection",
        fields: [{ id: fieldId, title: "Count", type: "number" }],
      }),
    );
    expect(collection.fields).toEqual([
      { id: fieldId, title: "Count", type: "number" },
    ]);
    const changed = await saved(
      await api(`/collections/${collection.id}`, "PATCH", {
        editToken: 0,
        fields: [{ id: fieldId, title: "Total", type: "number" }],
      }),
    );
    expect(changed.fields).toEqual([
      { id: fieldId, title: "Total", type: "number" },
    ]);
    const legacyFields = [
      { id: fieldId, name: "Legacy label", type: "number" },
    ];
    await database.pool.query("update collections set fields=$1 where id=$2", [
      JSON.stringify(legacyFields),
      collection.id,
    ]);
    const legacyRead = await saved(await api(`/collections/${collection.id}`));
    expect(legacyRead.fields).toEqual([
      { id: fieldId, title: "Legacy label", type: "number" },
    ]);
    expect(
      (
        await database.pool.query(
          "select fields from collections where id=$1",
          [collection.id],
        )
      ).rows[0]?.fields,
    ).toEqual(legacyFields);
  });

  it("edits Project and Conversation display metadata without tokens while retaining writer and archive gates", async () => {
    const project = await saved(
      await api("/projects", "POST", { title: "Token-free" }),
    );
    const conversation = await saved(
      await api("/conversations", "POST", {
        title: "Before",
        visibility: "workspace",
      }),
    );
    for (const [path, changes, field] of [
      [`/projects/${project.id}`, { title: "After" }, "title"],
      [`/conversations/${conversation.id}`, { title: "After" }, "title"],
    ] as const) {
      const updated = await saved(await api(path, "PATCH", changes));
      expect(updated).toHaveProperty(field, "After");
      expect(updated).not.toHaveProperty("editToken");
      expect(
        (await api(path, "PATCH", { [field]: "Denied" }, viewerCookie)).status,
      ).toBe(403);
      expect(await saved(await api(path))).toHaveProperty(field, "After");
      expect(
        (await api(`${path}/archive`, "POST", { archived: true }, viewerCookie))
          .status,
      ).toBe(403);
      expect(
        (await api(`${path}/archive`, "POST", { archived: true })).status,
      ).toBe(200);
      expect(await saved(await api(path))).toHaveProperty("archived", true);
      expect(
        (await api(`${path}/archive`, "POST", { archived: false })).status,
      ).toBe(200);
    }
  });

  it("keeps Conversation management with its creator while participants can discuss", async () => {
    const group = await saved(
      await api("/conversations", "POST", {
        title: "Creator group",
        visibility: "participants",
      }),
    );
    expect(
      (
        await api(`/conversations/${group.id}/participants`, "POST", {
          userId: collaborator,
          role: "contributor",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await api(
          `/conversations/${group.id}`,
          "PATCH",
          { title: "Not creator" },
          collaboratorCookie,
        )
      ).status,
    ).toBe(403);
    expect(group).toHaveProperty("createdBy", owner);
    expect(group).not.toHaveProperty("access");
    for (const [path, method, body] of [
      [`/conversations/${group.id}/archive`, "POST", { archived: true }],
      [
        `/conversations/${group.id}/participants`,
        "POST",
        { userId: viewer, role: "contributor" },
      ],
    ] as const)
      expect((await api(path, method, body, collaboratorCookie)).status).toBe(
        403,
      );
    const discussion = await saved(
      await api(
        `/conversations/${group.id}/messages`,
        "POST",
        { requestId: crypto.randomUUID(), body: "Participant discussion" },
        collaboratorCookie,
      ),
    );
    expect(discussion.body).toBe("Participant discussion");
    expect(
      (await api(`/conversations/${group.id}`, "GET", undefined, viewerCookie))
        .status,
    ).toBe(403);
    expect(
      (
        await api(`/conversations/${group.id}/participants`, "POST", {
          userId: viewer,
          role: "viewer",
        })
      ).status,
    ).toBe(200);
    expect(
      (await api(`/conversations/${group.id}`, "GET", undefined, viewerCookie))
        .status,
    ).toBe(200);
    expect(
      (
        await api(
          `/conversations/${group.id}/messages`,
          "POST",
          { requestId: crypto.randomUUID(), body: "Viewer denied" },
          viewerCookie,
        )
      ).status,
    ).toBe(403);
    const listed = page.parse(
      await (await api(`/conversations/${group.id}/participants`)).json(),
    );
    const peer = listed.items.find((item) => item.userId === collaborator);
    expect(peer).toBeDefined();
    expect(
      (
        await api(
          `/conversations/${group.id}/participants/${peer?.id}`,
          "DELETE",
          undefined,
          collaboratorCookie,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await api(
          `/conversations/${group.id}/participants/${peer?.id}`,
          "DELETE",
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await api(
          `/conversations/${group.id}/messages?after=0`,
          "GET",
          undefined,
          collaboratorCookie,
        )
      ).status,
    ).toBe(403);
    const workspace = await saved(
      await api(
        "/conversations",
        "POST",
        { title: "Workspace discussion", visibility: "workspace" },
        collaboratorCookie,
      ),
    );
    expect(workspace.createdBy).toBe(collaborator);
    expect((await api(`/conversations/${workspace.id}`, "GET")).status).toBe(
      200,
    );
    expect(
      (
        await api(`/conversations/${workspace.id}`, "PATCH", {
          title: "Workspace owner cannot impersonate creator",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await api(`/conversations/${workspace.id}/messages`, "POST", {
          requestId: crypto.randomUUID(),
          body: "Eligible workspace discussion",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await api("/conversations", "POST", {
          title: "Forged",
          visibility: "workspace",
          createdBy: collaborator,
        })
      ).status,
    ).toBe(400);
  });

  it("uses auth, current roles, origin checks and bounded input on new routes", async () => {
    for (const query of ["after=invalid", "limit=0", "limit=101"]) {
      const invalid = await content(`/documents?${query}`);
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toEqual({ error: "invalid" });
    }
    expect((await content("/documents", "GET", undefined, "")).status).toBe(
      401,
    );
    expect(
      (
        await fetch(
          `${origin}/api/workspaces/${workspaceId}/projects/${projectId}`,
          {
            method: "PATCH",
            headers: {
              Cookie: cookie,
              Origin: "https://foreign.test",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              title: "wrong",
              repositoryUrl: null,
            }),
          },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await content(
          `/projects/${projectId}`,
          "PATCH",
          { title: "wrong", repositoryUrl: null },
          viewerCookie,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await content("/shares/preview", "POST", {
          selection: {
            type: "conversation",
            targetId: conversationId,
            messageIds: Array.from({ length: 51 }, () => crypto.randomUUID()),
          },
        })
      ).status,
    ).toBe(400);
  });
  it("edits tasks with stale protection, preserves ownership, and blocks owner demotion/removal", async () => {
    const task = await saved(
      await api(
        "/tasks",
        "POST",
        { projectId, title: "Original" },
        collaboratorCookie,
      ),
    );
    expect(task.ownerId).toBe(collaborator);
    const updated = await saved(
      await content(
        `/tasks/${task.id}`,
        "PATCH",
        { title: "Updated", notes: "searchable zebra", editToken: 0 },
        collaboratorCookie,
      ),
    );
    expect(updated.updatedAt).not.toBeNull();
    expect(updated.ownerId).toBe(collaborator);
    expect(
      (
        await content(`/tasks/${task.id}`, "PATCH", {
          title: "Lost",
          notes: "",
          editToken: 0,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await content(
          `/projects/${projectId}/members/${collaborator}`,
          "PATCH",
          { role: "viewer" },
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await content(
          `/projects/${projectId}/members/${collaborator}`,
          "DELETE",
          undefined,
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await api(`/projects/${projectId}/members`, "POST", {
          userId: collaborator,
          role: "viewer",
        })
      ).status,
    ).toBe(409);
    const found = page.parse(
      await (await content(`/tasks?projectId=${projectId}&query=zebra`)).json(),
    );
    expect(found.items.map((x) => x.id)).toContain(task.id);
    await saved(
      await content(`/tasks/${task.id}/archive`, "POST", {
        archived: true,
        editToken: 1,
      }),
    );
    expect(
      page
        .parse(await (await content(`/tasks?projectId=${projectId}`)).json())
        .items.map((x) => x.id),
    ).not.toContain(task.id);
    expect((await api(`/tasks/${task.id}`)).status).toBe(200);
    await saved(
      await content(`/tasks/${task.id}/archive`, "POST", {
        archived: false,
        editToken: 2,
      }),
    );
  });
  it("atomically edits Task ownership with stale control and rejects forged agent ownership", async () => {
    const task = await saved(
      await api("/tasks", "POST", { projectId, title: "Owner edit" }),
    );
    const forged = {
      title: "Forged",
      notes: "",
      ownerId: collaborator,
      editToken: 0,
    };
    await expect(
      inWorkspace(
        database.db,
        workspaceId,
        { userId: owner, agentId: crypto.randomUUID() },
        (c) => updateTask(c, task.id, forged),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(
      (
        await content(
          `/tasks/${task.id}`,
          "PATCH",
          { ownerId: collaborator, editToken: 0 },
          collaboratorCookie,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await content(`/tasks/${task.id}`, "PATCH", {
          ownerId: viewer,
          editToken: 0,
        })
      ).status,
    ).toBe(403);
    const edited = await saved(
      await content(`/tasks/${task.id}`, "PATCH", {
        title: "Owner and title",
        ownerId: collaborator,
        editToken: 0,
      }),
    );
    expect(edited).toMatchObject({
      ownerId: collaborator,
      title: "Owner and title",
      notes: "",
      editToken: 1,
    });
    expect(
      (
        await content(`/tasks/${task.id}`, "PATCH", {
          ownerId: owner,
          editToken: 0,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await content(`/tasks/${task.id}`, "PATCH", {
          ownerId: owner,
          editToken: 1,
          agentId: crypto.randomUUID(),
        })
      ).status,
    ).toBe(400);
    expect(
      (await content(`/tasks/${task.id}/owner`, "POST", { userId: owner }))
        .status,
    ).toBe(404);
    expect(await (await api(`/tasks/${task.id}`)).json()).toMatchObject({
      ownerId: collaborator,
      title: "Owner and title",
      editToken: 1,
    });
  });
  it("uses token-checked partial record edits and rejects obsolete browser installation fields", async () => {
    const skill = await saved(
      await api("/documents", "POST", {
        title: "Skill",
        body: "Original instructions",
        skill: true,
        visibility: "workspace",
        whenToUse: "x".repeat(500),
      }),
    );
    const changed = await saved(
      await api(`/documents/${skill.id}`, "PATCH", {
        whenToUse: "y".repeat(500),
        editToken: 0,
      }),
    );
    expect(changed).toMatchObject({
      title: "Skill",
      body: "Original instructions",
      whenToUse: "y".repeat(500),
      editToken: 1,
    });
    expect(
      (
        await api(`/documents/${skill.id}`, "PATCH", {
          whenToUse: "stale",
          editToken: 0,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await api(
          `/documents/${skill.id}`,
          "PATCH",
          { body: "forbidden", editToken: 1 },
          viewerCookie,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await api(`/documents/${skill.id}`, "PATCH", {
          whenToUse: "x".repeat(100001),
          editToken: 1,
        })
      ).status,
    ).toBe(400);
    expect(
      (await api(`/documents/${skill.id}`, "PATCH", { editToken: 1 })).status,
    ).toBe(400);
    const ordinary = await saved(
      await api("/documents", "POST", {
        title: "Ordinary",
        body: "",
        visibility: "workspace",
      }),
    );
    expect(
      (
        await api(`/documents/${ordinary.id}`, "PATCH", {
          whenToUse: "not a skill",
          editToken: 0,
        })
      ).status,
    ).toBe(400);
    const collection = await saved(
      await api("/collections", "POST", { title: "List", fields: [] }),
    );
    expect(
      await saved(
        await api(`/collections/${collection.id}`, "PATCH", {
          view: "list",
          editToken: 0,
        }),
      ),
    ).toMatchObject({ title: "List", view: "list", fields: [], editToken: 1 });
    expect(
      (
        await api(`/collections/${collection.id}`, "PATCH", {
          view: "table",
          editToken: 0,
        })
      ).status,
    ).toBe(409);
    expect(
      (await api(`/collections/${collection.id}`, "PATCH", { editToken: 1 }))
        .status,
    ).toBe(400);
    const agentInput = {
      title: "Worker",
      instructions: "original",
      harness: "fixture",
      model: "fixture",
    };
    for (const extra of [
      { harnessVersion: "browser-pin" },
      { documentIds: [] },
      { messageIds: [] },
    ])
      expect(
        (
          await api("/agents", "POST", {
            visibility: "workspace",
            ...agentInput,
            ...extra,
          })
        ).status,
      ).toBe(400);
    const connection = await saved(
      await api("/subscriptions", "POST", {
        title: "Native",
      }),
    );
    const result = z
      .object({
        agent: z
          .object({ id: z.string(), editToken: z.number() })
          .passthrough(),
      })
      .parse(
        await (
          await api("/agents", "POST", {
            visibility: "workspace",
            ...agentInput,
            subscriptionId: connection.id,
          })
        ).json(),
      );
    expect(result.agent).not.toHaveProperty("harnessVersion");
    expect(
      await saved(
        await api(`/agents/${result.agent.id}`, "PATCH", {
          instructions: "edited",
          editToken: 0,
        }),
      ),
    ).toMatchObject({
      title: "Worker",
      instructions: "edited",
      subscriptionId: connection.id,
      editToken: 1,
    });
    expect(
      (
        await api(`/agents/${result.agent.id}`, "PATCH", {
          instructions: "stale",
          editToken: 0,
        })
      ).status,
    ).toBe(409);
  });
  it("shares Document reads while retaining creator edits and stale-content denial", async () => {
    const doc = await createDoc("private content", "user");
    expect(
      (await api(`/documents/${doc.id}`, "GET", undefined, collaboratorCookie))
        .status,
    ).toBe(403);
    await saved(
      await content(`/documents/${doc.id}`, "PATCH", {
        visibility: "workspace",
        editToken: 0,
      }),
    );
    expect(
      (await api(`/documents/${doc.id}`, "GET", undefined, viewerCookie))
        .status,
    ).toBe(200);
    expect(
      (
        await api(
          `/documents/${doc.id}`,
          "PATCH",
          { title: "Denied", body: "contributor changed", editToken: 1 },
          collaboratorCookie,
        )
      ).status,
    ).toBe(403);
    await saved(
      await api(`/documents/${doc.id}`, "PATCH", {
        title: "Edited",
        body: "creator changed",
        editToken: 1,
      }),
    );
    expect(
      (
        await api(
          `/documents/${doc.id}`,
          "PATCH",
          { title: "No", body: "viewer changed", editToken: 2 },
          viewerCookie,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await content(`/documents/${doc.id}`, "PATCH", {
          visibility: "user",
          editToken: 1,
        })
      ).status,
    ).toBe(409);
    await saved(
      await content(`/documents/${doc.id}`, "PATCH", {
        visibility: "user",
        editToken: 2,
      }),
    );
    expect(
      (await api(`/documents/${doc.id}`, "GET", undefined, collaboratorCookie))
        .status,
    ).toBe(403);
    expect(
      page
        .parse(
          await (
            await content(
              "/documents?query=contributor",
              "GET",
              undefined,
              collaboratorCookie,
            )
          ).json(),
        )
        .items.map((x) => x.id),
    ).not.toContain(doc.id);
  });
  it("keeps preview unpublished, freezes selection, rejects stale publication and explicitly updates/revokes it", async () => {
    const doc = await createDoc("PUBLIC private-tail", "user");
    const draft = await preview({
      type: "document",
      targetId: doc.id,
      start: 0,
      end: 6,
    });
    expect((await request(`/api/shares/${draft.id}`)).status).toBe(404);
    const active = await publish(draft);
    const read = await request(`/api/shares/${draft.id}`, "GET", undefined, "");
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual({
      type: "document",
      title: "A document",
      body: "PUBLIC",
    });
    expect(read.headers.get("cache-control")).toBe("no-store");
    await saved(
      await api(`/documents/${doc.id}`, "PATCH", {
        title: "Changed",
        body: "UPDATED never auto-publish",
        editToken: 0,
      }),
    );
    expect(
      await (
        await request(`/api/shares/${draft.id}`, "GET", undefined, "")
      ).json(),
    ).toEqual({ type: "document", title: "A document", body: "PUBLIC" });
    const next = await preview(
      { type: "document", targetId: doc.id, start: 0, end: 7 },
      { id: active.id, editToken: active.editToken ?? 0 },
    );
    expect(
      await (
        await request(`/api/shares/${draft.id}`, "GET", undefined, "")
      ).json(),
    ).toEqual({ type: "document", title: "A document", body: "PUBLIC" });
    const listed = z
      .object({
        items: z.array(z.object({ id: z.string(), published: z.boolean() })),
      })
      .parse(await (await content("/shares")).json());
    expect(listed.items.find((item) => item.id === draft.id)?.published).toBe(
      true,
    );
    await saved(
      await api(`/documents/${doc.id}`, "PATCH", {
        title: "Changed again",
        body: "new body",
        editToken: 1,
      }),
    );
    expect(
      (
        await content(`/shares/${next.id}/publish`, "POST", {
          editToken: next.editToken,
        })
      ).status,
    ).toBe(409);
    const fresh = await preview(
      { type: "document", targetId: doc.id, start: 0, end: 3 },
      { id: next.id, editToken: next.editToken ?? 0 },
    );
    await publish(fresh);
    expect(
      await (await request(`/api/shares/${draft.id}`)).json(),
    ).toMatchObject({ body: "new" });
    expect(
      (await content(`/shares/${draft.id}/revoke`, "POST", {})).status,
    ).toBe(200);
    expect((await request(`/api/shares/${draft.id}`)).status).toBe(404);
    const revoked = z
      .object({
        items: z.array(z.object({ id: z.string(), published: z.boolean() })),
      })
      .parse(await (await content("/shares")).json());
    expect(revoked.items.find((item) => item.id === draft.id)?.published).toBe(
      false,
    );
    expect(
      (
        await content(`/shares/${fresh.id}/publish`, "POST", {
          editToken: fresh.editToken,
        })
      ).status,
    ).toBe(409);
  });
  it("publishes only selected messages, excludes IDs/replies/attachments, and supports read/mention attention", async () => {
    const first = await saved(
      await content(`/conversations/${conversationId}/messages`, "POST", {
        body: "hidden first",
        requestId: crypto.randomUUID(),
      }),
    );
    const requestId = crypto.randomUUID();
    const selected = await saved(
      await content(`/conversations/${conversationId}/messages`, "POST", {
        body: "Selected result",
        requestId,
        replyTo: first.id,
        mentionUserIds: [collaborator],
      }),
    );
    expect(
      (
        await saved(
          await content(`/conversations/${conversationId}/messages`, "POST", {
            body: "Selected result",
            requestId,
            replyTo: first.id,
            mentionUserIds: [collaborator],
          }),
        )
      ).id,
    ).toBe(selected.id);
    expect(
      (
        await content(`/conversations/${conversationId}/messages`, "POST", {
          body: "Selected result",
          requestId,
          mentionUserIds: [collaborator],
        })
      ).status,
    ).toBe(409);
    const share = await preview({
      type: "conversation",
      targetId: conversationId,
      messageIds: [selected.id],
    });
    await publish(share);
    expect(
      await (
        await request(`/api/shares/${share.id}`, "GET", undefined, "")
      ).json(),
    ).toEqual({
      type: "conversation",
      title: "Content discussion",
      messages: [{ body: "Selected result" }],
    });
    const attention = z
      .object({
        items: z.array(
          z.object({ conversationId: z.string(), unread: z.array(record) }),
        ),
      })
      .parse(
        await (
          await content(
            "/attention?mentionsOnly=true",
            "GET",
            undefined,
            collaboratorCookie,
          )
        ).json(),
      );
    expect(
      attention.items
        .find((x) => x.conversationId === conversationId)
        ?.unread.map((x) => x.id),
    ).toContain(selected.id);
    expect(
      (
        await content(
          `/conversations/${conversationId}/read`,
          "POST",
          { cursor: selected.cursor },
          collaboratorCookie,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await content(
          `/conversations/${conversationId}/read`,
          "POST",
          { cursor: first.cursor },
          collaboratorCookie,
        )
      ).status,
    ).toBe(200);
    expect(
      await (
        await content(
          "/attention?mentionsOnly=true",
          "GET",
          undefined,
          collaboratorCookie,
        )
      ).json(),
    ).toMatchObject({ items: [] });
    expect(
      (
        await content(
          `/conversations/${conversationId}/read`,
          "POST",
          { cursor: 999999 },
          collaboratorCookie,
        )
      ).status,
    ).toBe(400);
  });
  it("guards public file bytes and rechecks revoke after storage I/O", async () => {
    const artifact = await createArtifact();
    const share = await preview({
      type: "artifact",
      targetId: artifact.id,
      includeFile: true,
    });
    await publish(share);
    const download = await request(
      `/api/shares/${share.id}/file`,
      "GET",
      undefined,
      "",
    );
    expect(download.status).toBe(200);
    expect(await download.text()).toBe("immutable bytes");
    expect(download.headers.get("content-type")).toBe(
      "application/octet-stream",
    );
    expect(download.headers.get("content-disposition")).toContain("attachment");
    afterStorageRead = async () => {
      afterStorageRead = undefined;
      expect(
        (await content(`/shares/${share.id}/revoke`, "POST", {})).status,
      ).toBe(200);
    };
    expect(
      (await request(`/api/shares/${share.id}/file`, "GET", undefined, ""))
        .status,
    ).toBe(404);
    const metadata = await preview({
      type: "artifact",
      targetId: artifact.id,
      includeFile: false,
    });
    await publish(metadata);
    expect((await request(`/api/shares/${metadata.id}/file`)).status).toBe(404);
  });
  it("reports temporary public-file storage failure without converting it to missing content", async () => {
    const artifact = await createArtifact("available after recovery");
    const share = await preview({
      type: "artifact",
      targetId: artifact.id,
      includeFile: true,
    });
    await publish(share);
    afterStorageRead = async () => {
      throw new DomainError("unavailable");
    };
    try {
      expect(
        (await request(`/api/shares/${share.id}/file`, "GET", undefined, ""))
          .status,
      ).toBe(503);
    } finally {
      afterStorageRead = undefined;
    }
    expect(
      await (
        await request(`/api/shares/${share.id}/file`, "GET", undefined, "")
      ).text(),
    ).toBe("available after recovery");
  });
  it("imports/exports skills and pins supporting-file references in actual accepted Run input and queue", async () => {
    const skillMd =
      "---\nname: review-skill\ndescription: Review code carefully\nallowed-tools: fake-tool\n---\nRead references/guide.txt";
    const skill = await saved(
      await content("/skills/import", "POST", {
        skillMd,
        visibility: "workspace",
      }),
    );
    const file = await createArtifact("original skill material");
    await saved(
      await content(`/documents/${skill.id}/skill-files`, "PUT", {
        editToken: 0,
        files: [{ path: "references/guide.txt", artifactId: file.id }],
      }),
    );
    expect(
      (
        await content(`/documents/${skill.id}/skill-files`, "PUT", {
          editToken: 1,
          files: [{ path: "references/../escape", artifactId: file.id }],
        })
      ).status,
    ).toBe(400);
    const exported = z
      .object({
        skillMd: z.string(),
        files: z.array(
          z.object({
            path: z.string(),
            artifactId: z.string(),
            sha256: z.string(),
          }),
        ),
      })
      .parse(await (await content(`/skills/${skill.id}/export`)).json());
    expect(exported.skillMd).toBe(
      '---\nname: "review-skill"\ndescription: "Review code carefully"\nallowed-tools: "fake-tool"\n---\nRead references/guide.txt',
    );
    const skillRecord = await database.db
      .select()
      .from(documents)
      .where(eq(documents.id, skill.id));
    expect(skillRecord[0]?.skillMetadata).toEqual({
      "allowed-tools": "fake-tool",
    });
    expect(exported.files[0]?.artifactId).toBe(file.id);
    const created = z.object({ agent: record }).parse(
      await (
        await api("/agents", "POST", {
          visibility: "workspace",
          title: "Content worker",
          skillIds: [skill.id],
          instructions: "Work",
          harness: "codex-acp",
          model: "unqualified",
        })
      ).json(),
    );
    expect(
      (
        await api(`/conversations/${conversationId}/participants`, "POST", {
          agentId: created.agent.id,
          role: "contributor",
        })
      ).status,
    ).toBe(200);
    const input = {
      conversationId,
      agentId: created.agent.id,
      type: "script",
      body: "fixture only; no process launch",
      requestId: crypto.randomUUID(),
    };
    const run = await saved(await api("/runs", "POST", input));
    expect((await saved(await api("/runs", "POST", input))).id).toBe(run.id);
    const accepted = (
      await database.db.select().from(runs).where(eq(runs.id, run.id))
    )[0];
    expect(accepted?.inputs.grants).toEqual([]);
    expect(accepted?.inputs.skills[0]).toMatchObject({
      documentId: skill.id,
      supportingFiles: exported.files.map((f) => ({ ...f, byteLength: 23 })),
    });
    const replacement = await createArtifact("replacement skill material");
    await saved(
      await content(`/documents/${skill.id}/skill-files`, "PUT", {
        editToken: 1,
        files: [{ path: "references/guide.txt", artifactId: replacement.id }],
      }),
    );
    expect(
      (await database.db.select().from(runs).where(eq(runs.id, run.id)))[0]
        ?.inputs,
    ).toEqual(accepted?.inputs);
    expect(
      (
        await database.pool.query(
          "select count(*)::int as count from queue.job where data->>'runId'=$1",
          [run.id],
        )
      ).rows[0]?.count,
    ).toBe(1);
    const output = await createArtifact("Run output", run.id);
    await expect(
      inWorkspace(
        database.db,
        workspaceId,
        { userId: owner, agentId: created.agent.id },
        (c) => previewArtifact(c, output.id),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    // The production Better Auth sign-up rule permits three requests per ten seconds.
    await Bun.sleep(11000);
    const joined = await request(
      "/api/auth/sign-up/email",
      "POST",
      {
        name: "Later member",
        email: "later-content@example.test",
        password: crypto.randomUUID() + crypto.randomUUID(),
      },
      "",
    );
    expect(joined.status).toBe(200);
    const laterCookie = joined.headers.get("set-cookie") ?? "";
    const later = z
      .object({ user: z.object({ id: z.string() }) })
      .parse(await joined.json()).user.id;
    await database.db
      .update(users)
      .set({ emailVerified: true })
      .where(eq(users.id, later));
    const invitation = await saved(
      await api("/invitations", "POST", {
        email: "later-content@example.test",
        role: "contributor",
      }),
    );
    expect(
      (
        await request(
          `/api/invitations/${invitation.id}/accept`,
          "POST",
          {},
          laterCookie,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await api(`/projects/${projectId}/members`, "POST", {
          userId: later,
          role: "contributor",
        })
      ).status,
    ).toBe(200);
    expect(
      (await api(`/artifacts/${output.id}`, "GET", undefined, laterCookie))
        .status,
    ).toBe(403);
    expect(
      page
        .parse(
          await (
            await content("/artifacts", "GET", undefined, laterCookie)
          ).json(),
        )
        .items.map((item) => item.id),
    ).not.toContain(output.id);
    expect(
      (
        await content(
          "/shares/preview",
          "POST",
          {
            selection: {
              type: "artifact",
              targetId: output.id,
              includeFile: true,
            },
          },
          laterCookie,
        )
      ).status,
    ).toBe(403);
    const runShare = await preview({
      type: "artifact",
      targetId: output.id,
      includeFile: true,
    });
    await publish(runShare);
    expect(
      await (
        await request(`/api/shares/${runShare.id}/file`, "GET", undefined, "")
      ).text(),
    ).toBe("Run output");
    for (const authCookie of [collaboratorCookie, viewerCookie])
      expect(
        (
          await content(
            "/shares/preview",
            "POST",
            {
              selection: {
                type: "artifact",
                targetId: output.id,
                includeFile: true,
              },
            },
            authCookie,
          )
        ).status,
      ).toBe(403);
    await saved(
      await content(`/artifacts/${output.id}`, "PATCH", {
        title: "Later metadata",
        labels: ["new"],
      }),
    );
    expect(
      await (
        await request(`/api/shares/${runShare.id}`, "GET", undefined, "")
      ).json(),
    ).toMatchObject({ title: "Reference file" });
    expect(
      (await content(`/shares/${runShare.id}/revoke`, "POST", {})).status,
    ).toBe(200);
    expect(
      (await request(`/api/shares/${runShare.id}/file`, "GET", undefined, ""))
        .status,
    ).toBe(404);
    // Leave other content scenarios at their original three-human fixture audience.
    await database.db.delete(members).where(eq(members.userId, later));
    expect(
      (
        await content(`/documents/${skill.id}/skill-files`, "PUT", {
          editToken: 2,
          files: [{ path: "references/result", artifactId: output.id }],
        })
      ).status,
    ).toBe(403);
  });
  it("renames stable Collection fields and preserves properties across view/archive transitions", async () => {
    const fieldId = crypto.randomUUID();
    const collection = await saved(
      await api("/collections", "POST", {
        title: "Reading list",
        fields: [{ id: fieldId, title: "Count", type: "number" }],
      }),
    );
    const doc = await createDoc();
    await saved(
      await api(`/documents/${doc.id}/collection`, "POST", {
        collectionId: collection.id,
        properties: { [fieldId]: 4 },
        editToken: 0,
      }),
    );
    await saved(
      await content(`/collections/${collection.id}`, "PATCH", {
        title: "Reading list",
        fields: [{ id: fieldId, title: "Total", type: "number" }],
        editToken: 0,
      }),
    );
    expect(
      (
        await content(`/collections/${collection.id}`, "PATCH", {
          title: "Invalid",
          fields: [{ id: fieldId, title: "Total", type: "text" }],
          editToken: 1,
        })
      ).status,
    ).toBe(409);
    await saved(
      await content(`/collections/${collection.id}`, "PATCH", {
        view: "list",
        editToken: 1,
      }),
    );
    expect(await (await api(`/documents/${doc.id}`)).json()).toMatchObject({
      properties: { [fieldId]: 4 },
    });
    await saved(
      await content(`/collections/${collection.id}/archive`, "POST", {
        archived: true,
        editToken: 2,
      }),
    );
    expect(
      page
        .parse(await (await content("/collections")).json())
        .items.map((x) => x.id),
    ).not.toContain(collection.id);
    expect(
      (
        await api(`/documents/${doc.id}/collection`, "POST", {
          collectionId: collection.id,
          properties: { [fieldId]: 5 },
          editToken: 1,
        })
      ).status,
    ).toBe(409);
    await saved(
      await content(`/collections/${collection.id}/archive`, "POST", {
        archived: false,
        editToken: 3,
      }),
    );
  });
  it("filters linked records independently and prevents capturing private messages into wider tasks", async () => {
    const privateDoc = await createDoc("hidden", "user");
    const task = await saved(
      await api("/tasks", "POST", { projectId, title: "Linked work" }),
    );
    expect(
      (
        await content(`/tasks/${task.id}/links`, "POST", {
          type: "document",
          reference: privateDoc.id,
        })
      ).status,
    ).toBe(200);
    expect(
      await (
        await content(
          `/tasks/${task.id}/links`,
          "GET",
          undefined,
          collaboratorCookie,
        )
      ).json(),
    ).toEqual({ items: [], next: null });
    const group = await saved(
      await api("/conversations", "POST", {
        title: "Private source",
        visibility: "participants",
        projectId,
      }),
    );
    const message = await saved(
      await content(`/conversations/${group.id}/messages`, "POST", {
        body: "private source text",
        requestId: crypto.randomUUID(),
      }),
    );
    expect(
      (
        await content("/tasks/capture", "POST", {
          projectId,
          title: "Unsafe copy",
          conversationId: group.id,
          messageId: message.id,
        })
      ).status,
    ).toBe(403);
    const visible = await saved(
      await content(`/conversations/${conversationId}/messages`, "POST", {
        body: "capture this once",
        requestId: crypto.randomUUID(),
      }),
    );
    const captured = await saved(
      await content("/tasks/capture", "POST", {
        projectId,
        title: "Captured task",
        conversationId,
        messageId: visible.id,
      }),
    );
    expect(captured.notes).toBe("capture this once");
    expect(captured.ownerId).toBe(owner);
  });
  it("refreshes authorized Document content over WebSocket and closes after visibility removal", async () => {
    const doc = await createDoc("before realtime", "user");
    await saved(
      await content(`/documents/${doc.id}`, "PATCH", {
        visibility: "workspace",
        editToken: 0,
      }),
    );
    const frames: string[] = [];
    let closeCode: number | undefined;
    const ws = new WebSocket(
      `${origin.replace("http", "ws")}/api/realtime?workspaceId=${workspaceId}&conversationId=${conversationId}&documentId=${doc.id}`,
      { headers: { Cookie: collaboratorCookie, Origin: origin } },
    );
    ws.on("message", (data) => frames.push(data.toString()));
    ws.on("close", (code) => {
      closeCode = code;
    });
    try {
      await expect
        .poll(() => frames.some((frame) => frame.includes("before realtime")), {
          timeout: 5000,
        })
        .toBe(true);
      await saved(
        await api(`/documents/${doc.id}`, "PATCH", {
          title: "Realtime doc",
          body: "after realtime",
          editToken: 1,
        }),
      );
      await expect
        .poll(() => frames.some((frame) => frame.includes("after realtime")), {
          timeout: 5000,
        })
        .toBe(true);
      await saved(
        await content(`/documents/${doc.id}`, "PATCH", {
          visibility: "user",
          editToken: 2,
        }),
      );
      await expect.poll(() => closeCode, { timeout: 5000 }).toBe(4403);
    } finally {
      ws.close();
    }
  });

  it("paginates searchable Documents beyond 100, hides archived rows and preserves direct reads", async () => {
    const ids = [];
    for (let i = 0; i < 103; i++)
      ids.push(
        (
          await saved(
            await api("/documents", "POST", {
              title: `Pagination record ${i}`,
              body: "needleable",
              visibility: "workspace",
            }),
          )
        ).id,
      );
    const first = page.parse(
      await (await content("/documents?query=needleable")).json(),
    );
    expect(first.items).toHaveLength(100);
    expect(first.next).toBeTruthy();
    const second = page.parse(
      await (
        await content(`/documents?query=needleable&after=${first.next}`)
      ).json(),
    );
    expect(second.items).toHaveLength(3);
    expect(
      new Set([...first.items, ...second.items].map((item) => item.id)).size,
    ).toBe(103);
    expect(second.next).toBeNull();
    const id = ids[0];
    if (!id) throw new Error("Missing document");
    await saved(
      await content(`/documents/${id}/archive`, "POST", {
        archived: true,
        editToken: 0,
      }),
    );
    expect((await api(`/documents/${id}`)).status).toBe(200);
    expect(
      page
        .parse(
          await (
            await content("/documents?archived=true&query=needleable")
          ).json(),
        )
        .items.map((item) => item.id),
    ).toContain(id);
    await saved(
      await content(`/documents/${id}/archive`, "POST", {
        archived: false,
        editToken: 1,
      }),
    );
  });
  it("keeps agent/human proposals separate until an authorized human accepts an unchanged Document", async () => {
    const doc = await createDoc("authoritative");
    const proposal = await saved(
      await content(
        `/documents/${doc.id}/proposals`,
        "POST",
        { title: "Suggested", body: "proposed body", editToken: 0 },
        collaboratorCookie,
      ),
    );
    expect(await (await api(`/documents/${doc.id}`)).json()).toMatchObject({
      body: "authoritative",
    });
    expect(
      (
        await content(
          `/documents/${doc.id}/proposals/${proposal.id}/resolve`,
          "POST",
          { accept: true },
          viewerCookie,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await content(
          `/documents/${doc.id}/proposals/${proposal.id}/resolve`,
          "POST",
          { accept: true },
        )
      ).status,
    ).toBe(200);
    expect(await (await api(`/documents/${doc.id}`)).json()).toMatchObject({
      body: "proposed body",
    });
    const stale = await saved(
      await content(`/documents/${doc.id}/proposals`, "POST", {
        title: "Outdated",
        body: "old suggestion",
        editToken: 1,
      }),
    );
    await saved(
      await api(`/documents/${doc.id}`, "PATCH", {
        title: "Human edit",
        body: "human winner",
        editToken: 1,
      }),
    );
    expect(
      (
        await content(
          `/documents/${doc.id}/proposals/${stale.id}/resolve`,
          "POST",
          { accept: true },
        )
      ).status,
    ).toBe(409);
  });
  it("handles Conversation role changes, ephemeral presence, archive/restore and rechecks attachments", async () => {
    const group = await saved(
      await api("/conversations", "POST", {
        title: "Presence",
        visibility: "participants",
      }),
    );
    expect(
      (
        await api(`/conversations/${group.id}/participants`, "POST", {
          userId: collaborator,
          role: "contributor",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await content(
          `/conversations/${group.id}/presence`,
          "PUT",
          { typing: true },
          collaboratorCookie,
        )
      ).status,
    ).toBe(200);
    expect(
      await (await content(`/conversations/${group.id}/presence`)).json(),
    ).toEqual([{ userId: collaborator, typing: true }]);
    const participants = z
      .object({
        items: z.array(
          z.object({ id: z.string(), userId: z.string().nullable() }),
        ),
        next: z.string().nullable(),
      })
      .parse(
        await (await content(`/conversations/${group.id}/participants`)).json(),
      );
    const participant = participants.items.find(
      (p) => p.userId === collaborator,
    );
    if (!participant) throw new Error("Missing participant");
    expect(
      (
        await content(
          `/conversations/${group.id}/participants/${participant.id}`,
          "PATCH",
          { role: "viewer" },
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await content(
          `/conversations/${group.id}/presence`,
          "PUT",
          { typing: true },
          collaboratorCookie,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await content(
          `/conversations/${group.id}/messages`,
          "POST",
          { body: "viewer write", requestId: crypto.randomUUID() },
          collaboratorCookie,
        )
      ).status,
    ).toBe(403);
    const file = await createArtifact("attachment bytes");
    const message = await saved(
      await content(`/conversations/${group.id}/messages`, "POST", {
        body: "file reference",
        requestId: crypto.randomUUID(),
        artifactIds: [file.id],
      }),
    );
    expect(message.artifactIds).toEqual([file.id]);
    await saved(
      await content(`/conversations/${group.id}/archive`, "POST", {
        archived: true,
        editToken: 0,
      }),
    );
    expect(
      (
        await content(`/conversations/${group.id}/messages`, "POST", {
          body: "discussion remains available while archived",
          requestId: crypto.randomUUID(),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await content(
          `/conversations/${group.id}/messages`,
          "POST",
          { body: "viewer remains read-only", requestId: crypto.randomUUID() },
          collaboratorCookie,
        )
      ).status,
    ).toBe(403);
    expect((await content(`/conversations/${group.id}`)).status).toBe(200);
    await saved(
      await content(`/conversations/${group.id}/archive`, "POST", {
        archived: false,
        editToken: 1,
      }),
    );
    expect(
      (
        await api(
          `/conversations/${group.id}/participants/${participant.id}`,
          "DELETE",
          {},
        )
      ).status,
    ).toBe(200);
    expect(
      await (await content(`/conversations/${group.id}/presence`)).json(),
    ).toEqual([]);
  });
  it("uses token-free custodial Artifact metadata and one current visibility without changing immutable receipts", async () => {
    const input = {
      requestId: crypto.randomUUID(),
      title: "Private artifact",
      type: "text",
      visibility: "user",
      mediaType: "text/plain",
      bytes: Buffer.from("private bytes").toString("base64"),
    };
    const artifact = await saved(await api("/artifacts", "POST", input));
    for (const field of [
      "editToken",
      "access",
      "readerIds",
      "writerIds",
      "objectKey",
      "request",
    ])
      expect(artifact).not.toHaveProperty(field);
    expect(
      (
        await api(
          `/artifacts/${artifact.id}`,
          "GET",
          undefined,
          collaboratorCookie,
        )
      ).status,
    ).toBe(403);
    await saved(
      await api(`/artifacts/${artifact.id}`, "PATCH", {
        visibility: "workspace",
        title: "Renamed",
        labels: ["selected"],
      }),
    );
    expect(
      (
        await api(
          `/artifacts/${artifact.id}/file`,
          "GET",
          undefined,
          collaboratorCookie,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await api(
          `/artifacts/${artifact.id}`,
          "PATCH",
          { title: "Denied" },
          collaboratorCookie,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await api(
          `/artifacts/${artifact.id}/archive`,
          "POST",
          { archived: true },
          collaboratorCookie,
        )
      ).status,
    ).toBe(403);
    expect((await saved(await api("/artifacts", "POST", input))).title).toBe(
      "Renamed",
    );
    expect(
      (await api("/artifacts", "POST", { ...input, visibility: "workspace" }))
        .status,
    ).toBe(409);
    const doc = await createDoc();
    expect(
      (
        await content(`/documents/${doc.id}/attachments`, "PUT", {
          artifactIds: [artifact.id],
          editToken: 0,
        })
      ).status,
    ).toBe(200);
    await saved(
      await api(`/artifacts/${artifact.id}`, "PATCH", { visibility: "user" }),
    );
    expect(
      (
        await api(
          `/artifacts/${artifact.id}/file`,
          "GET",
          undefined,
          collaboratorCookie,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await api(`/artifacts/${artifact.id}/access`, "PUT", {
          readerIds: [collaborator],
          writerIds: [],
          editToken: 0,
        })
      ).status,
    ).toBe(404);
  });

  it("persists Project defaults and uses real membership/archive gates", async () => {
    const project = await saved(
      await api("/projects", "POST", { title: "Lifecycle project" }),
    );
    const skill = await saved(
      await content("/skills/import", "POST", {
        skillMd:
          "---\nname: lifecycle-skill\ndescription: Check lifecycle\n---\nInstructions",
        visibility: "workspace",
      }),
    );
    expect(
      (
        await content(`/projects/${project.id}`, "PATCH", {
          skillIds: [skill.id],
          editToken: 0,
        })
      ).status,
    ).toBe(400);
    await saved(
      await content(`/projects/${project.id}`, "PATCH", {
        title: "Edited project",
        repositoryUrl: "https://example.test/repo",
      }),
    );
    expect(
      (
        await api(`/projects/${project.id}/members`, "POST", {
          userId: collaborator,
          role: "contributor",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await content(
          `/projects/${project.id}/members/${collaborator}`,
          "DELETE",
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await content(
          `/projects/${project.id}`,
          "GET",
          undefined,
          collaboratorCookie,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await content(`/projects/${project.id}/archive`, "POST", {
          archived: true,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await api("/tasks", "POST", {
          projectId: project.id,
          title: "Preserved task capture",
        })
      ).status,
    ).toBe(200);
    expect((await content(`/projects/${project.id}`)).status).toBe(200);
    expect(
      (
        await content(`/projects/${project.id}/archive`, "POST", {
          archived: false,
        })
      ).status,
    ).toBe(200);
  });

  it("preserves saved discussion and explicit Stop after Project and Conversation archive", async () => {
    const project = await saved(
      await api("/projects", "POST", { title: "Archive controls" }),
    );
    const conversation = await saved(
      await api("/conversations", "POST", {
        title: "Admitted work",
        visibility: "workspace",
        projectId: project.id,
      }),
    );
    const created = z.object({ agent: record }).parse(
      await (
        await api("/agents", "POST", {
          visibility: "workspace",
          title: "Archive worker",
          instructions: "Work",
          harness: "codex-acp",
          model: "unqualified",
        })
      ).json(),
    );
    expect(
      (
        await api(`/conversations/${conversation.id}/participants`, "POST", {
          agentId: created.agent.id,
          role: "contributor",
        })
      ).status,
    ).toBe(200);
    const input = {
      conversationId: conversation.id,
      agentId: created.agent.id,
      type: "script",
      body: "fixture only; no process launch",
      requestId: crypto.randomUUID(),
    };
    const run = await saved(await api("/runs", "POST", input));
    await saved(
      await content(`/conversations/${conversation.id}/archive`, "POST", {
        archived: true,
        editToken: 0,
      }),
    );
    expect(
      (
        await content(`/projects/${project.id}/archive`, "POST", {
          archived: true,
        })
      ).status,
    ).toBe(200);
    expect(
      (await database.db.select().from(runs).where(eq(runs.id, run.id)))[0]
        ?.state,
    ).toBe("queued");
    expect(
      await (await api(`/runs/${run.id}/stop`, "POST", {})).json(),
    ).toEqual({ stopped: true });
    expect((await saved(await api("/runs", "POST", input))).id).toBe(run.id);
    const message = {
      body: "Saved discussion after archive",
      requestId: crypto.randomUUID(),
    };
    const result = await saved(
      await content(
        `/conversations/${conversation.id}/messages`,
        "POST",
        message,
      ),
    );
    expect(
      (
        await saved(
          await content(
            `/conversations/${conversation.id}/messages`,
            "POST",
            message,
          ),
        )
      ).id,
    ).toBe(result.id);
    expect(
      await (await api(`/runs/${run.id}/stop`, "POST", {})).json(),
    ).toEqual({ stopped: true });
    expect(
      (await database.db.select().from(runs).where(eq(runs.id, run.id)))[0]
        ?.state,
    ).toBe("interrupted");
    expect((await content(`/conversations/${conversation.id}`)).status).toBe(
      200,
    );
    await saved(
      await content(`/conversations/${conversation.id}/archive`, "POST", {
        archived: false,
        editToken: 1,
      }),
    );
  });

  it("renders selected HTML in a browser sandbox without scripts, cookies or network access", async () => {
    const html =
      '<!doctype html><html><head><title>Frozen artifact proof</title></head><body><h1>Frozen artifact</h1><p>Only the selected file is shown.</p><script>document.body.dataset.executed="yes";fetch("/api/workspaces");</script></body></html>';
    const artifact = await saved(
      await api("/artifacts", "POST", {
        requestId: crypto.randomUUID(),
        title: "HTML result",
        type: "html",
        visibility: "user",
        mediaType: "text/html",
        bytes: Buffer.from(html).toString("base64"),
      }),
    );
    const share = await preview({
      type: "artifact",
      targetId: artifact.id,
      includeFile: true,
    });
    await publish(share);
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 900, height: 500 },
      });
      const requests: string[] = [];
      page.on("request", (request) => requests.push(request.url()));
      const response = await page.goto(
        `${origin}/api/shares/${share.id}/preview`,
      );
      expect(response?.status()).toBe(200);
      expect(await page.locator("h1").textContent()).toBe("Frozen artifact");
      expect(
        await page.locator("body").getAttribute("data-executed"),
      ).toBeNull();
      expect(
        await page.evaluate(() => {
          try {
            document.cookie;
            return "readable";
          } catch (error) {
            return error instanceof Error ? error.name : "unknown";
          }
        }),
      ).toBe("SecurityError");
      expect(requests.some((url) => url.endsWith("/api/workspaces"))).toBe(
        false,
      );
      await page.screenshot({
        path: "docs/evidence/content-share-sandbox.png",
      });
    } finally {
      await browser.close();
    }
  });

  it("closes a published Run Artifact when the publisher loses its group source Conversation", async () => {
    const conversation = await saved(
      await api("/conversations", "POST", {
        title: "Private Run source",
        visibility: "participants",
      }),
    );
    const configured = z.object({ agent: record }).parse(
      await (
        await api("/agents", "POST", {
          visibility: "workspace",
          title: "Source worker",
          instructions: "Fixture",
          harness: "codex-acp",
          model: "unqualified",
        })
      ).json(),
    );
    expect(
      (
        await api(`/conversations/${conversation.id}/participants`, "POST", {
          agentId: configured.agent.id,
          role: "contributor",
        })
      ).status,
    ).toBe(200);
    const run = await saved(
      await api("/runs", "POST", {
        conversationId: conversation.id,
        agentId: configured.agent.id,
        type: "script",
        body: "No native launch",
        requestId: crypto.randomUUID(),
      }),
    );
    const artifact = await saved(
      await api("/artifacts", "POST", {
        requestId: crypto.randomUUID(),
        title: "Selected source result",
        type: "text",
        visibility: "user",
        sourceRunId: run.id,
        mediaType: "text/plain",
        bytes: Buffer.from("selected source bytes").toString("base64"),
      }),
    );
    const share = await preview({
      type: "artifact",
      targetId: artifact.id,
      includeFile: true,
    });
    await publish(share);
    expect(
      await (
        await request(`/api/shares/${share.id}/file`, "GET", undefined, "")
      ).text(),
    ).toBe("selected source bytes");
    const people = z
      .object({
        items: z.array(
          z.object({ id: z.string(), userId: z.string().nullable() }),
        ),
        next: z.string().nullable(),
      })
      .parse(
        await (
          await content(`/conversations/${conversation.id}/participants`)
        ).json(),
      );
    const self = people.items.find((person) => person.userId === owner);
    if (!self) throw new Error("Missing source participant");
    expect(
      (
        await api(
          `/conversations/${conversation.id}/participants/${self.id}`,
          "DELETE",
        )
      ).status,
    ).toBe(200);
    expect(
      (await request(`/api/shares/${share.id}`, "GET", undefined, "")).status,
    ).toBe(404);
    expect(
      (await request(`/api/shares/${share.id}/file`, "GET", undefined, ""))
        .status,
    ).toBe(404);
    expect((await api(`/artifacts/${artifact.id}`)).status).toBe(403);
    expect(
      (await content(`/shares/${share.id}/revoke`, "POST", {})).status,
    ).toBe(200);
  });
  it("closes published shares when the publisher loses membership", async () => {
    const doc = await saved(
      await api(
        "/documents",
        "POST",
        { title: "Collaborator note", body: "selected", visibility: "user" },
        collaboratorCookie,
      ),
    );
    const draft = await saved(
      await content(
        "/shares/preview",
        "POST",
        { selection: { type: "document", targetId: doc.id, start: 0, end: 8 } },
        collaboratorCookie,
      ),
    );
    await saved(
      await content(
        `/shares/${draft.id}/publish`,
        "POST",
        { editToken: 0 },
        collaboratorCookie,
      ),
    );
    expect(
      (await request(`/api/shares/${draft.id}`, "GET", undefined, "")).status,
    ).toBe(200);
    // Permission-revocation fixture; owned-task removal remains separately guarded through HTTP above.
    await database.db.delete(members).where(eq(members.userId, collaborator));
    expect(
      (await request(`/api/shares/${draft.id}`, "GET", undefined, "")).status,
    ).toBe(404);
  });
});
