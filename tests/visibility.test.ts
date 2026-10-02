import { eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { createApp } from "../apps/server/src/app";
import { createAuth } from "../apps/server/src/auth";
import { startQueue } from "../apps/server/src/queue";
import { readRunSkillFile } from "../apps/server/src/skill-files";
import { createRunTools } from "../apps/server/src/tools";
import { agents } from "../packages/agents/src/schema";
import type { ArtifactStorage } from "../packages/artifacts/src";
import { connections } from "../packages/connections/src/schema";
import { documents } from "../packages/documents/src/schema";
import { RUN_QUEUE, validateRunSources } from "../packages/runs/src";
import {
  createRunRuntime,
  type RunRuntime,
} from "../packages/runs/src/runtime";
import { runActivity, runs } from "../packages/runs/src/schema";
import {
  claimInstallation,
  getCursor,
  inWorkspace,
} from "../packages/workspaces/src";
import { members } from "../packages/workspaces/src/schema";
import { ControlledComputer } from "./fixtures/computer";
import { harnesses } from "./fixtures/harnesses";
import { startPostgres } from "./postgres";

/** Real HTTP/auth/PG/queue, without a compute provider or external credential lookup. */
describe("user/workspace resource visibility", () => {
  let database: Awaited<ReturnType<typeof startPostgres>>;
  let boss: PgBoss;
  let worker: PgBoss;
  let runtime: RunRuntime;
  let computer: ControlledComputer;
  let accountId: string;
  let afterRead: (() => Promise<void>) | undefined;
  const objects = new Map<string, Uint8Array>();
  const storage: ArtifactStorage = {
    async put(key, bytes) {
      objects.set(key, bytes.slice());
    },
    async get(key) {
      const bytes = objects.get(key);
      if (!bytes) throw new Error("Missing controlled bytes");
      await afterRead?.();
      return bytes.slice();
    },
  };
  let app: ReturnType<typeof createApp>;
  let server: ReturnType<typeof Bun.serve>;
  let origin: string;
  let workspaceId: string;
  let owner: { id: string; cookie: string };
  let other: typeof owner;
  let outsider: typeof owner;
  const record = z.object({
    id: z.uuid(),
    ownerId: z.string(),
    visibility: z.enum(["user", "workspace"]),
    editToken: z.number(),
  });
  const page = z.object({
    items: z.array(z.object({ id: z.uuid() })),
    next: z.string().nullable(),
  });
  async function request(
    path: string,
    method = "GET",
    input?: unknown,
    human = owner,
  ) {
    return fetch(`${origin}/api/workspaces/${workspaceId}${path}`, {
      method,
      headers: {
        cookie: human.cookie,
        origin,
        "content-type": "application/json",
      },
      body: input === undefined ? undefined : JSON.stringify(input),
    });
  }
  async function value(response: Response) {
    expect(response.status, await response.clone().text()).toBe(200);
    return response.json();
  }
  async function agent(
    visibility: "user" | "workspace" = "user",
    human = owner,
    skillIds: string[] = [],
  ) {
    return z.object({ agent: record }).parse(
      await value(
        await request(
          "/agents",
          "POST",
          {
            name: "Agent",
            instructions: "Work",
            harness: "fixture",
            model: "fixture",
            visibility,
            skillIds,
            connectionId: accountId,
          },
          human,
        ),
      ),
    ).agent;
  }
  async function skill(
    visibility: "user" | "workspace" = "user",
    human = owner,
  ) {
    return record.parse(
      await value(
        await request(
          "/skills/import",
          "POST",
          {
            skillMd:
              "---\nname: scoped-skill\ndescription: Scoped material\n---\nprivate instructions",
            visibility,
          },
          human,
        ),
      ),
    );
  }
  async function connection(
    visibility: "user" | "workspace" = "user",
    human = owner,
  ) {
    return record.parse(
      await value(
        await request(
          "/connections",
          "POST",
          {
            name: "Account metadata",
            type: "model",
            accountRef: "fixture-account",
            visibility,
          },
          human,
        ),
      ),
    );
  }
  beforeAll(async () => {
    database = await startPostgres();
    boss = await startQueue(database.db, database.pool, {
      workers: false,
      install: true,
    });
    server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (req) => app.fetch(req),
    });
    origin = `http://127.0.0.1:${server.port}`;
    const auth = createAuth(
      database.db,
      crypto.randomUUID() + crypto.randomUUID(),
      origin,
    );
    app = createApp({ db: database.db, boss, auth, origin, harnesses });
    async function signup(name: string) {
      const response = await fetch(`${origin}/api/auth/sign-up/email`, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({
          name,
          email: `${name}@visibility.test`,
          password: crypto.randomUUID() + crypto.randomUUID(),
        }),
      });
      expect(response.status).toBe(200);
      const cookie = response.headers.get("set-cookie") ?? "";
      const session = await auth.api.getSession({
        headers: new Headers({ cookie }),
      });
      if (!session) throw new Error("No session");
      return { id: session.user.id, cookie };
    }
    owner = await signup("owner");
    other = await signup("other");
    outsider = await signup("outsider");
    workspaceId = (await claimInstallation(database.db, owner.id, "Visibility"))
      .id;
    await database.db
      .insert(members)
      .values({ workspaceId, userId: other.id, role: "contributor" });
    accountId = (await connection("workspace")).id;
    computer = new ControlledComputer(accountId);
    runtime = createRunRuntime(database.db, {
      backend: computer,
      harnesses,
      deadlineMs: 30000,
      handleTool: createRunTools(database.db, boss, { harnesses, storage }),
      readSkillFile: (input) => readRunSkillFile(database.db, storage, input),
    });
    app = createApp({
      db: database.db,
      boss,
      auth,
      origin,
      harnesses,
      runtime,
      storage,
    });
    worker = await startQueue(database.db, database.pool, {
      runtime,
      harnesses,
    });
  });
  afterAll(async () => {
    afterRead = undefined;
    await worker?.stop({ graceful: false });
    await computer?.close();
    await runtime?.close();
    await server?.stop(true);
    await boss?.stop();
    await database?.stop();
  });

  it("defaults to creator-only, rejects forged identity/old visibility, and allows contributor-owned Connections", async () => {
    for (const [path, input] of [
      [
        "/agents",
        {
          name: "Agent",
          instructions: "Work",
          harness: "fixture",
          model: "fixture",
        },
      ],
      ["/documents", { title: "Skill", body: "Secret", skill: true }],
      [
        "/connections",
        { name: "Account", type: "model", accountRef: "fixture" },
      ],
    ] as const) {
      for (const extra of [
        { ownerId: owner.id },
        { visibility: "shared" },
        { visibility: "personal" },
        { agentId: crypto.randomUUID() },
      ])
        expect(
          (await request(path, "POST", { ...input, ...extra }, other)).status,
        ).toBe(400);
      const response = await value(await request(path, "POST", input, other));
      const created = record.parse(
        path === "/agents"
          ? z.object({ agent: record }).parse(response).agent
          : response,
      );
      expect(created).toMatchObject({ ownerId: other.id, visibility: "user" });
      expect(
        (await request(`${path}/${created.id}`, "GET", undefined, owner))
          .status,
      ).toBe(403);
      expect(
        (await request(`${path}/${created.id}`, "GET", undefined, outsider))
          .status,
      ).toBe(403);
    }
    expect(
      (
        await request("/documents", "POST", {
          title: "Contradiction",
          body: "x",
          skill: true,
          access: "inherited",
          visibility: "workspace",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request("/documents", "POST", {
          title: "Ordinary",
          body: "x",
          access: "inherited",
          visibility: "workspace",
        })
      ).status,
    ).toBe(400);
  });
  it("workspace discovery/use never grants configuration; visibility edits are owner-only and stale-safe", async () => {
    for (const [path, created] of [
      ["/agents", await agent("workspace")],
      ["/documents", await skill("workspace")],
      ["/connections", await connection("workspace")],
    ] as const) {
      expect(
        (await request(`${path}/${created.id}`, "GET", undefined, other))
          .status,
      ).toBe(200);
      expect(
        (
          await request(
            `${path}/${created.id}`,
            "PATCH",
            { visibility: "user", editToken: 0 },
            other,
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await request(`${path}/${created.id}`, "PATCH", {
            ownerId: other.id,
            editToken: 0,
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await request(`${path}/${created.id}`, "PATCH", {
            visibility: "user",
            editToken: 0,
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await request(`${path}/${created.id}`, "PATCH", {
            visibility: "workspace",
            editToken: 0,
          })
        ).status,
      ).toBe(409);
      expect(
        (await request(`${path}/${created.id}`, "GET", undefined, other))
          .status,
      ).toBe(403);
    }
    const c = await connection("workspace");
    const view = await value(
      await request(`/connections/${c.id}`, "GET", undefined, other),
    );
    expect(Object.keys(view)).not.toContain("accountRef");
    expect(Object.keys(view)).not.toContain("credentialRef");
    expect(Object.keys(view)).not.toContain("config");
    expect(
      (await request(`/connections/${c.id}/disconnect`, "POST", {}, other))
        .status,
    ).toBe(403);
  });
  it("permits workspace skill reuse and proposals without granting maintainer edits", async () => {
    const shared = await skill("workspace");
    expect(
      (await request(`/skills/${shared.id}/export`, "GET", undefined, other))
        .status,
    ).toBe(200);
    expect(
      (
        await request(
          `/documents/${shared.id}`,
          "PATCH",
          { body: "overwrite", editToken: 0 },
          other,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(
          `/documents/${shared.id}/skill-files`,
          "PUT",
          { files: [], editToken: 0 },
          other,
        )
      ).status,
    ).toBe(403);
    const proposal = z
      .object({ id: z.uuid() })
      .parse(
        await value(
          await request(
            `/documents/${shared.id}/proposals`,
            "POST",
            { title: "Suggested", body: "Proposed", editToken: 0 },
            other,
          ),
        ),
      );
    expect(
      (
        await request(
          `/documents/${shared.id}/proposals/${proposal.id}/resolve`,
          "POST",
          { accept: true },
          other,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(
          `/documents/${shared.id}/proposals/${proposal.id}/resolve`,
          "POST",
          { accept: true },
        )
      ).status,
    ).toBe(200);
    expect(
      z
        .object({ body: z.string() })
        .parse(await value(await request(`/documents/${shared.id}`))).body,
    ).toBe("Proposed");
  });
  it("advances filtered pages from scanned candidates, including an empty first page", async () => {
    for (const [path, create, table] of [
      ["/agents", agent, agents],
      ["/documents", skill, documents],
      ["/connections", connection, connections],
    ] as const) {
      const hidden = await create("user");
      const visible = await create("workspace");
      const first = "00000000-0000-4000-8000-000000000001",
        second = "00000000-0000-4000-8000-000000000002";
      // Agent creation also creates Environment metadata; keep its FK intact.
      if (path === "/agents")
        await database.pool.query(
          'delete from environments where "agentId"=$1',
          [hidden.id],
        );
      await database.db
        .update(table)
        .set({ id: first })
        .where(eq(table.id, hidden.id));
      if (path === "/agents")
        await database.pool.query(
          'delete from environments where "agentId"=$1',
          [visible.id],
        );
      await database.db
        .update(table)
        .set({ id: second })
        .where(eq(table.id, visible.id));
      const found: string[] = [];
      let next: string | null = null;
      let firstPage = true;
      do {
        const result = page.parse(
          await value(
            await request(
              `${path}?limit=1${next ? `&after=${next}` : ""}`,
              "GET",
              undefined,
              other,
            ),
          ),
        );
        if (firstPage && path !== "/connections") {
          expect(result.items).toEqual([]);
          expect(result.next).toBe(first);
        }
        found.push(...result.items.map((item) => item.id));
        next = result.next;
        firstPage = false;
      } while (next);
      expect(found).toContain(second);
      expect(found).not.toContain(first);
      expect(
        (await request(`${path}?after=invalid`, "GET", undefined, other))
          .status,
      ).toBe(400);
    }
  });
  it("guards skill import/export/file selection, and a shared Agent cannot inherit a user skill", async () => {
    const privateSkill = await skill();
    expect(
      (
        await request(
          `/skills/${privateSkill.id}/export`,
          "GET",
          undefined,
          other,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(
          `/documents/${privateSkill.id}/skill-files`,
          "PUT",
          { files: [], editToken: 0 },
          other,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(`/documents/${privateSkill.id}/access`, "PUT", {
          readerIds: [other.id],
          writerIds: [],
          editToken: 0,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(
          "/agents",
          "POST",
          {
            name: "Steal",
            instructions: "Work",
            harness: "fixture",
            model: "fixture",
            skillIds: [privateSkill.id],
          },
          other,
        )
      ).status,
    ).toBe(403);
    const sharedAgent = await agent("workspace", owner, [privateSkill.id]);
    const conversation = z
      .object({ id: z.uuid() })
      .parse(
        await value(
          await request(
            "/conversations",
            "POST",
            { title: "Shared", access: "restricted" },
            other,
          ),
        ),
      );
    await value(
      await request(
        `/conversations/${conversation.id}/participants`,
        "POST",
        { agentId: sharedAgent.id, role: "contributor" },
        other,
      ),
    );
    const run = {
      agentId: sharedAgent.id,
      conversationId: conversation.id,
      requestId: crypto.randomUUID(),
      type: "prompt",
      body: "Work",
    };
    expect((await request("/runs", "POST", run, other)).status).toBe(403);
    await value(
      await request(`/documents/${privateSkill.id}`, "PATCH", {
        visibility: "workspace",
        editToken: 0,
      }),
    );
    expect(
      (
        await request(
          `/skills/${privateSkill.id}/export`,
          "GET",
          undefined,
          other,
        )
      ).status,
    ).toBe(200);
    await value(
      await request(
        "/runs",
        "POST",
        { ...run, requestId: crypto.randomUUID() },
        other,
      ),
    );
    await value(
      await request(`/documents/${privateSkill.id}`, "PATCH", {
        visibility: "user",
        editToken: 1,
      }),
    );
    expect(
      (
        await request(
          "/runs",
          "POST",
          { ...run, requestId: crypto.randomUUID() },
          other,
        )
      ).status,
    ).toBe(403);
  });
  async function runningSource(withFile = false) {
    const selected = await skill("workspace");
    if (withFile) {
      const file = z.object({ id: z.uuid() }).parse(
        await value(
          await request("/artifacts", "POST", {
            requestId: crypto.randomUUID(),
            title: "Skill bytes",
            type: "text",
            access: "inherited",
            mediaType: "text/plain",
            bytes: Buffer.from("immutable instructions").toString("base64"),
          }),
        ),
      );
      await value(
        await request(`/documents/${selected.id}/skill-files`, "PUT", {
          editToken: 0,
          files: [{ path: "references/source.txt", artifactId: file.id }],
        }),
      );
    }
    const configured = await agent("workspace", owner, [selected.id]);
    await value(
      await request(`/agents/${configured.id}/computer`, "POST", {
        computerRef: configured.id,
      }),
    );
    const conversation = z
      .object({ id: z.uuid() })
      .parse(
        await value(
          await request(
            "/conversations",
            "POST",
            { title: "Live visibility", access: "restricted" },
            other,
          ),
        ),
      );
    await value(
      await request(
        `/conversations/${conversation.id}/participants`,
        "POST",
        { agentId: configured.id, role: "contributor" },
        other,
      ),
    );
    return { selected, configured, conversation };
  }
  const state = async (id: string) =>
    (await database.db.select().from(runs).where(eq(runs.id, id)))[0]?.state;
  it.each(["agent", "skill", "connection", "membership"] as const)(
    "revokes live %s authority through HTTP and the real queue/runtime",
    async (resource) => {
      const source = await runningSource();
      const run = z.object({ id: z.uuid() }).parse(
        await value(
          await request(
            "/runs",
            "POST",
            {
              agentId: source.configured.id,
              conversationId: source.conversation.id,
              requestId: crypto.randomUUID(),
              type: "prompt",
              body: "hold",
            },
            other,
          ),
        ),
      );
      await expect
        .poll(() => state(run.id), { timeout: 10000 })
        .toBe("running");
      await expect
        .poll(
          async () =>
            (
              await database.db
                .select()
                .from(runActivity)
                .where(eq(runActivity.runId, run.id))
            ).length,
        )
        .toBe(1);
      const current = record.parse(
        await value(await request(`/connections/${accountId}`)),
      );
      try {
        if (resource === "membership")
          await database.db.delete(members).where(eq(members.userId, other.id));
        else {
          const path =
            resource === "agent"
              ? `/agents/${source.configured.id}`
              : resource === "skill"
                ? `/documents/${source.selected.id}`
                : `/connections/${accountId}`;
          await value(
            await request(path, "PATCH", {
              visibility: "user",
              editToken: resource === "connection" ? current.editToken : 0,
            }),
          );
        }
        await expect
          .poll(() => state(run.id), { timeout: 10000 })
          .toBe("interrupted");
        expect(
          (
            await database.db
              .select()
              .from(runActivity)
              .where(eq(runActivity.runId, run.id))
          ).map((row) => row.body),
        ).toEqual(["fixture output"]);
        expect(
          (
            await request(
              "/runs",
              "POST",
              {
                agentId: source.configured.id,
                conversationId: source.conversation.id,
                requestId: crypto.randomUUID(),
                type: "prompt",
                body: "finish",
              },
              other,
            )
          ).status,
        ).toBe(403);
      } finally {
        if (resource === "membership")
          await database.db
            .insert(members)
            .values({ workspaceId, userId: other.id, role: "contributor" });
        if (resource === "connection")
          await value(
            await request(`/connections/${accountId}`, "PATCH", {
              visibility: "workspace",
              editToken: current.editToken + 1,
            }),
          );
      }
    },
  );
  it("withholds accepted skill bytes when visibility changes during actual storage I/O", async () => {
    const source = await runningSource(true);
    let release: () => void = () => {};
    let entered = false;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    afterRead = async () => {
      entered = true;
      await blocked;
    };
    const launches = computer.launches;
    const run = z.object({ id: z.uuid() }).parse(
      await value(
        await request(
          "/runs",
          "POST",
          {
            agentId: source.configured.id,
            conversationId: source.conversation.id,
            requestId: crypto.randomUUID(),
            type: "prompt",
            body: "finish",
          },
          other,
        ),
      ),
    );
    try {
      await expect.poll(() => entered, { timeout: 10000 }).toBe(true);
      await value(
        await request(`/documents/${source.selected.id}`, "PATCH", {
          visibility: "user",
          editToken: 1,
        }),
      );
    } finally {
      release();
      afterRead = undefined;
    }
    await expect.poll(() => state(run.id), { timeout: 10000 }).toBe("failed");
    expect(computer.launches).toBe(launches);
    expect(
      await database.db
        .select()
        .from(runActivity)
        .where(eq(runActivity.runId, run.id)),
    ).toEqual([]);
  });
  it("keeps disabled manual Automations available, archived launches denied, and obsolete capabilities invalid", async () => {
    const configured = await agent();
    const conversation = z.object({ id: z.uuid() }).parse(
      await value(
        await request("/conversations", "POST", {
          title: "Manual",
          access: "restricted",
        }),
      ),
    );
    await value(
      await request(`/conversations/${conversation.id}/participants`, "POST", {
        agentId: configured.id,
        role: "contributor",
      }),
    );
    const input = {
      name: "Manual",
      agentId: configured.id,
      conversationId: conversation.id,
      type: "script",
      body: "fixture",
      status: "disabled",
    };
    for (const extra of [
      { skillIds: [] },
      { documentIds: [] },
      { messageIds: [] },
    ])
      expect(
        (await request("/automations", "POST", { ...input, ...extra })).status,
      ).toBe(400);
    const automation = z
      .object({ id: z.uuid() })
      .parse(await value(await request("/automations", "POST", input)));
    expect(
      (
        await request(`/automations/${automation.id}/run`, "POST", {
          requestId: crypto.randomUUID(),
        })
      ).status,
    ).toBe(200);
    await value(
      await request(`/automations/${automation.id}`, "PATCH", {
        status: "archived",
        editToken: 0,
      }),
    );
    expect(
      (
        await request(`/automations/${automation.id}/run`, "POST", {
          requestId: crypto.randomUUID(),
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(`/automations/${automation.id}`, "PATCH", {
          status: "enabled",
          editToken: 1,
        })
      ).status,
    ).toBe(409);
    await value(
      await request(`/automations/${automation.id}`, "PATCH", {
        status: "disabled",
        editToken: 1,
      }),
    );
    expect(
      (
        await request("/runs", "POST", {
          agentId: configured.id,
          conversationId: conversation.id,
          requestId: crypto.randomUUID(),
          type: "script",
          body: "fixture",
          skillIds: [],
        })
      ).status,
    ).toBe(400);
  });
  it("caps inherited Conversation writers by an explicit viewer row", async () => {
    const conversation = z.object({ id: z.uuid() }).parse(
      await value(
        await request("/conversations", "POST", {
          title: "Inherited viewer",
          access: "inherited",
        }),
      ),
    );
    await value(
      await request(`/conversations/${conversation.id}/participants`, "POST", {
        userId: other.id,
        role: "viewer",
      }),
    );
    const participants = z
      .object({
        items: z.array(
          z.object({ id: z.uuid(), userId: z.string().nullable() }),
        ),
      })
      .parse(
        await value(
          await request(`/conversations/${conversation.id}/participants`),
        ),
      );
    const viewer = participants.items.find((row) => row.userId === other.id);
    if (!viewer) throw new Error("No viewer");
    expect(
      (
        await request(
          `/conversations/${conversation.id}/messages`,
          "POST",
          { requestId: crypto.randomUUID(), body: "Forbidden" },
          other,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(
          `/conversations/${conversation.id}/participants/${viewer.id}`,
          "PATCH",
          { role: "contributor" },
          other,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(
          `/conversations/${conversation.id}/participants/${viewer.id}`,
          "DELETE",
          {},
          other,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(
          `/conversations/${conversation.id}`,
          "GET",
          undefined,
          other,
        )
      ).status,
    ).toBe(200);
    await value(
      await request(
        `/conversations/${conversation.id}/participants/${viewer.id}`,
        "DELETE",
        {},
      ),
    );
    expect(
      (
        await request(
          `/conversations/${conversation.id}/messages`,
          "POST",
          { requestId: crypto.randomUUID(), body: "Inherited contributor" },
          other,
        )
      ).status,
    ).toBe(200);
  });
  it("requires an eligible human owner when reopening a completed Task", async () => {
    const project = z
      .object({ id: z.uuid() })
      .parse(
        await value(await request("/projects", "POST", { name: "Reopen" })),
      );
    await value(
      await request(`/projects/${project.id}/members`, "POST", {
        userId: other.id,
        role: "contributor",
      }),
    );
    const task = z
      .object({ id: z.uuid() })
      .parse(
        await value(
          await request(
            "/tasks",
            "POST",
            { title: "Owned", projectId: project.id },
            other,
          ),
        ),
      );
    await value(
      await request(`/tasks/${task.id}/status`, "POST", {
        status: "done",
        editToken: 0,
      }),
    );
    await value(
      await request(`/projects/${project.id}/members/${other.id}`, "PATCH", {
        role: "viewer",
      }),
    );
    expect(
      (
        await request(`/tasks/${task.id}/status`, "POST", {
          status: "todo",
          editToken: 1,
        })
      ).status,
    ).toBe(403);
    await value(
      await request(`/tasks/${task.id}`, "PATCH", {
        ownerId: owner.id,
        editToken: 1,
      }),
    );
    expect(
      (
        await request(`/tasks/${task.id}/status`, "POST", {
          status: "doing",
          editToken: 2,
        })
      ).status,
    ).toBe(200);
  });
  it("requires Project write access as well as workspace admin to archive", async () => {
    const project = z
      .object({ id: z.uuid() })
      .parse(
        await value(
          await request("/projects", "POST", { name: "Archive authority" }),
        ),
      );
    await value(
      await request(`/projects/${project.id}/members`, "POST", {
        userId: other.id,
        role: "viewer",
      }),
    );
    await database.db
      .update(members)
      .set({ role: "admin" })
      .where(eq(members.userId, other.id));
    try {
      expect(
        (
          await request(
            `/projects/${project.id}/archive`,
            "POST",
            { archived: true },
            other,
          )
        ).status,
      ).toBe(403);
      await value(
        await request(`/projects/${project.id}/members/${other.id}`, "PATCH", {
          role: "contributor",
        }),
      );
      expect(
        (
          await request(
            `/projects/${project.id}/archive`,
            "POST",
            { archived: true },
            other,
          )
        ).status,
      ).toBe(200);
      expect(
        (
          await request(
            `/projects/${project.id}/archive`,
            "POST",
            { archived: false },
            other,
          )
        ).status,
      ).toBe(200);
    } finally {
      await database.db
        .update(members)
        .set({ role: "contributor" })
        .where(eq(members.userId, other.id));
    }
  });
  it("intersects selected restricted Document recipients with current Project membership", async () => {
    const project = z
      .object({ id: z.uuid() })
      .parse(
        await value(
          await request("/projects", "POST", { name: "Selected scope" }),
        ),
      );
    const doc = z.object({ id: z.uuid() }).parse(
      await value(
        await request("/documents", "POST", {
          title: "Project secret",
          body: "Scoped bytes",
          projectId: project.id,
          access: "restricted",
          readerIds: [other.id],
        }),
      ),
    );
    const configured = await agent("workspace");
    const conversation = z.object({ id: z.uuid() }).parse(
      await value(
        await request("/conversations", "POST", {
          title: "Wider output",
          access: "inherited",
        }),
      ),
    );
    await value(
      await request(`/conversations/${conversation.id}/participants`, "POST", {
        agentId: configured.id,
        role: "contributor",
      }),
    );
    expect(
      (await request(`/documents/${doc.id}`, "GET", undefined, other)).status,
    ).toBe(403);
    await value(
      await request(`/agents/${configured.id}/computer`, "POST", {
        computerRef: `selected-${configured.id}`,
      }),
    );
    const input = {
      requestId: crypto.randomUUID(),
      agentId: configured.id,
      conversationId: conversation.id,
      type: "prompt",
      body: "Work",
      documentIds: [doc.id],
    };
    const count = (await boss.findJobs(RUN_QUEUE)).length;
    expect((await request("/runs", "POST", input)).status).toBe(403);
    expect(
      await database.db
        .select()
        .from(runs)
        .where(eq(runs.requestId, input.requestId)),
    ).toEqual([]);
    expect((await boss.findJobs(RUN_QUEUE)).length).toBe(count);
    await value(
      await request(`/projects/${project.id}/members`, "POST", {
        userId: other.id,
        role: "contributor",
      }),
    );
    const admitted = z.object({ id: z.uuid() }).parse(
      await value(
        await request("/runs", "POST", {
          ...input,
          requestId: crypto.randomUUID(),
        }),
      ),
    );
    const saved = (
      await database.db.select().from(runs).where(eq(runs.id, admitted.id))
    )[0];
    if (!saved) throw new Error("No Run");
    await inWorkspace(database.db, workspaceId, { userId: owner.id }, (c) =>
      validateRunSources(c, saved),
    );
    await value(
      await request(
        `/projects/${project.id}/members/${other.id}`,
        "DELETE",
        {},
      ),
    );
    await expect(
      inWorkspace(database.db, workspaceId, { userId: owner.id }, (c) =>
        validateRunSources(c, saved),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
  it("intersects restricted Artifact attachment recipients with current Project membership", async () => {
    const project = z
      .object({ id: z.uuid() })
      .parse(
        await value(
          await request("/projects", "POST", { name: "Attachment scope" }),
        ),
      );
    const artifact = z.object({ id: z.uuid() }).parse(
      await value(
        await request("/artifacts", "POST", {
          requestId: crypto.randomUUID(),
          title: "Scoped",
          type: "text",
          access: "restricted",
          projectId: project.id,
          mediaType: "text/plain",
          bytes: Buffer.from("private").toString("base64"),
        }),
      ),
    );
    await value(
      await request(`/artifacts/${artifact.id}/access`, "PUT", {
        readerIds: [other.id],
        writerIds: [],
        editToken: 0,
      }),
    );
    const doc = z.object({ id: z.uuid() }).parse(
      await value(
        await request("/documents", "POST", {
          title: "Workspace",
          body: "Reference",
          access: "inherited",
        }),
      ),
    );
    expect(
      (
        await request(`/documents/${doc.id}/attachments`, "PUT", {
          artifactIds: [artifact.id],
          editToken: 0,
        })
      ).status,
    ).toBe(403);
    await value(
      await request(`/projects/${project.id}/members`, "POST", {
        userId: other.id,
        role: "contributor",
      }),
    );
    expect(
      (
        await request(`/documents/${doc.id}/attachments`, "PUT", {
          artifactIds: [artifact.id],
          editToken: 0,
        })
      ).status,
    ).toBe(200);
  });
  it("keeps user skill supporting bytes private and rejects sharing a private dependency", async () => {
    const selected = await skill();
    const file = z.object({ id: z.uuid() }).parse(
      await value(
        await request("/artifacts", "POST", {
          requestId: crypto.randomUUID(),
          title: "User bytes",
          type: "text",
          access: "restricted",
          mediaType: "text/plain",
          bytes: Buffer.from("owner-only supporting material").toString(
            "base64",
          ),
        }),
      ),
    );
    expect(
      (
        await request(`/documents/${selected.id}/skill-files`, "PUT", {
          editToken: 0,
          files: [{ path: "references/private.txt", artifactId: file.id }],
        })
      ).status,
    ).toBe(200);
    expect(
      (await request(`/skills/${selected.id}/export`, "GET", undefined, other))
        .status,
    ).toBe(403);
    expect(
      (await request(`/artifacts/${file.id}/file`, "GET", undefined, other))
        .status,
    ).toBe(403);
    expect(
      (
        await request(`/documents/${selected.id}`, "PATCH", {
          visibility: "workspace",
          editToken: 1,
        })
      ).status,
    ).toBe(403);
    expect(
      record.parse(await value(await request(`/documents/${selected.id}`)))
        .visibility,
    ).toBe("user");
    await value(
      await request(`/artifacts/${file.id}/access`, "PUT", {
        readerIds: [other.id],
        writerIds: [],
        editToken: 0,
      }),
    );
    expect(
      (
        await request(`/documents/${selected.id}`, "PATCH", {
          visibility: "workspace",
          editToken: 1,
        })
      ).status,
    ).toBe(200);
    expect(
      (await request(`/skills/${selected.id}/export`, "GET", undefined, other))
        .status,
    ).toBe(200);
    const configured = await agent("workspace", owner, [selected.id]);
    const conversation = z.object({ id: z.uuid() }).parse(
      await value(
        await request("/conversations", "POST", {
          title: "Shared file output",
          access: "inherited",
        }),
      ),
    );
    await value(
      await request(`/conversations/${conversation.id}/participants`, "POST", {
        agentId: configured.id,
        role: "contributor",
      }),
    );
    await worker.stop({ graceful: false });
    let runId: string | undefined;
    try {
      runId = z.object({ id: z.uuid() }).parse(
        await value(
          await request("/runs", "POST", {
            agentId: configured.id,
            conversationId: conversation.id,
            requestId: crypto.randomUUID(),
            type: "prompt",
            body: "hold",
          }),
        ),
      ).id;
      const input = {
        workspaceId,
        sponsorId: owner.id,
        runId,
        documentId: selected.id,
        path: "references/private.txt",
      };
      expect(
        new TextDecoder().decode(
          await readRunSkillFile(database.db, storage, input),
        ),
      ).toBe("owner-only supporting material");
      afterRead = async () => {
        afterRead = undefined;
        await value(
          await request(`/artifacts/${file.id}/access`, "PUT", {
            readerIds: [],
            writerIds: [],
            editToken: 1,
          }),
        );
      };
      await expect(
        readRunSkillFile(database.db, storage, input),
      ).rejects.toMatchObject({ code: "forbidden" });
    } finally {
      afterRead = undefined;
      if (runId) await value(await request(`/runs/${runId}/stop`, "POST", {}));
      worker = await startQueue(database.db, database.pool, {
        runtime,
        harnesses,
      });
    }
  });
  it.each(["message", "document", "grant"] as const)(
    "intersects saved and current source-Run recipients for private Artifact %s publication",
    async (target) => {
      await worker.stop({ graceful: false });
      let runId: string | undefined;
      try {
        const configured = await agent("workspace");
        const source = z.object({ id: z.uuid() }).parse(
          await value(
            await request("/conversations", "POST", {
              title: "Private source output",
              access: "restricted",
            }),
          ),
        );
        await value(
          await request(`/conversations/${source.id}/participants`, "POST", {
            userId: other.id,
            role: "contributor",
          }),
        );
        await value(
          await request(`/conversations/${source.id}/participants`, "POST", {
            agentId: configured.id,
            role: "contributor",
          }),
        );
        runId = z.object({ id: z.uuid() }).parse(
          await value(
            await request("/runs", "POST", {
              agentId: configured.id,
              conversationId: source.id,
              requestId: crypto.randomUUID(),
              type: "prompt",
              body: "Source output",
            }),
          ),
        ).id;
        const artifact = z.object({ id: z.uuid() }).parse(
          await value(
            await request("/artifacts", "POST", {
              requestId: crypto.randomUUID(),
              title: "Accepted output",
              type: "text",
              access: "restricted",
              sourceRunId: runId,
              mediaType: "text/plain",
              bytes: Buffer.from("accepted output").toString("base64"),
            }),
          ),
        );
        await value(
          await request(`/artifacts/${artifact.id}/access`, "PUT", {
            readerIds: [other.id],
            writerIds: [],
            editToken: 0,
          }),
        );
        expect(
          (await request(`/artifacts/${artifact.id}`, "GET", undefined, other))
            .status,
        ).toBe(200);
        const conversation = z.object({ id: z.uuid() }).parse(
          await value(
            await request("/conversations", "POST", {
              title: "Target output",
              access: "restricted",
            }),
          ),
        );
        await value(
          await request(
            `/conversations/${conversation.id}/participants`,
            "POST",
            { userId: other.id, role: "contributor" },
          ),
        );
        const doc = z.object({ id: z.uuid() }).parse(
          await value(
            await request("/documents", "POST", {
              title: "Target document",
              body: "Reference",
              access: "restricted",
              readerIds: [other.id],
            }),
          ),
        );
        const participants = z
          .object({
            items: z.array(
              z.object({ id: z.uuid(), userId: z.string().nullable() }),
            ),
          })
          .parse(
            await value(
              await request(`/conversations/${source.id}/participants`),
            ),
          );
        const peer = participants.items.find((p) => p.userId === other.id);
        if (!peer) throw new Error("Missing peer");
        await value(
          await request(
            `/conversations/${source.id}/participants/${peer.id}`,
            "DELETE",
            {},
          ),
        );
        expect(
          (await request(`/artifacts/${artifact.id}`, "GET", undefined, other))
            .status,
        ).toBe(403);
        const publish = () =>
          target === "message"
            ? request(`/conversations/${conversation.id}/messages`, "POST", {
                requestId: crypto.randomUUID(),
                body: "Attached output",
                artifactIds: [artifact.id],
              })
            : target === "document"
              ? request(`/documents/${doc.id}/attachments`, "PUT", {
                  artifactIds: [artifact.id],
                  editToken: 0,
                })
              : request(`/artifacts/${artifact.id}/access`, "PUT", {
                  readerIds: [other.id],
                  writerIds: [],
                  editToken: 1,
                });
        const cursor = () =>
          inWorkspace(
            database.db,
            workspaceId,
            { userId: owner.id },
            getCursor,
            false,
          );
        const before = await cursor();
        expect((await publish()).status).toBe(403);
        expect(await cursor()).toBe(before);
        expect(
          z
            .object({ editToken: z.number() })
            .parse(await value(await request(`/documents/${doc.id}`)))
            .editToken,
        ).toBe(0);
        expect(
          z
            .object({ editToken: z.number() })
            .parse(await value(await request(`/artifacts/${artifact.id}`)))
            .editToken,
        ).toBe(1);
        // An original recipient may regain current access, but a later invite never widens the saved cap.
        await value(
          await request(`/conversations/${source.id}/participants`, "POST", {
            userId: other.id,
            role: "contributor",
          }),
        );
        expect((await publish()).status).toBe(200);
        await database.db
          .insert(members)
          .values({ workspaceId, userId: outsider.id, role: "contributor" });
        try {
          await value(
            await request(`/conversations/${source.id}/participants`, "POST", {
              userId: outsider.id,
              role: "contributor",
            }),
          );
          const current = z
            .object({ editToken: z.number() })
            .parse(await value(await request(`/artifacts/${artifact.id}`)));
          const beforeLate = await cursor();
          expect(
            (
              await request(`/artifacts/${artifact.id}/access`, "PUT", {
                readerIds: [other.id, outsider.id],
                writerIds: [],
                editToken: current.editToken,
              })
            ).status,
          ).toBe(403);
          expect(await cursor()).toBe(beforeLate);
        } finally {
          await database.db
            .delete(members)
            .where(eq(members.userId, outsider.id));
        }
      } finally {
        if (runId)
          await value(await request(`/runs/${runId}/stop`, "POST", {}));
        worker = await startQueue(database.db, database.pool, {
          runtime,
          harnesses,
        });
      }
    },
  );
});
