import { eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { createApp } from "../apps/server/src/app";
import { createAuth } from "../apps/server/src/auth";
import { startQueue } from "../apps/server/src/queue";
import { readRunSkillFile } from "../apps/server/src/skill-files";
import { createRunTools } from "../apps/server/src/tools";
import { updateAgent } from "../packages/agents/src";
import { agents } from "../packages/agents/src/schema";
import { connections } from "../packages/connections/src/schema";
import { RUN_QUEUE, validateRunSources } from "../packages/runs/src";
import {
  createRunRuntime,
  type RunRuntime,
} from "../packages/runs/src/runtime";
import { runActivity, runs } from "../packages/runs/src/schema";
import { skills as skillsTable } from "../packages/skills/src/schema";
import { qualifySubscription } from "../packages/subscriptions/src/server";
import {
  claimInstallation,
  getCursor,
  inWorkspace,
} from "../packages/workspaces/src";
import { members, workspaces } from "../packages/workspaces/src/schema";
import { ControlledComputer } from "./fixtures/computer";
import { pi, piRuntime } from "./fixtures/pi";
import { fixtureStorage, testSpool } from "./fixtures/storage";
import { startPostgres } from "./postgres";

const transfers = await testSpool();

/** Real HTTP/auth/PG/queue, without a compute provider or external credential lookup. */
describe("user/workspace file visibility", () => {
  let database: Awaited<ReturnType<typeof startPostgres>>;
  let boss: PgBoss;
  let worker: PgBoss;
  let runtime: RunRuntime;
  let computer: ControlledComputer;
  let accountId: string;
  let afterRead: (() => Promise<void>) | undefined;
  const objects = new Map<string, Uint8Array>();
  const storage = fixtureStorage({
    async put(key, bytes) {
      objects.set(key, bytes.slice());
    },
    async get(key) {
      const bytes = objects.get(key);
      if (!bytes) throw new Error("Missing controlled bytes");
      await afterRead?.();
      return bytes.slice();
    },
  });
  let app: ReturnType<typeof createApp>;
  let server: ReturnType<typeof Bun.serve>;
  let origin: string;
  let workspaceId: string;
  let owner: { id: string; cookie: string };
  let other: typeof owner;
  let outsider: typeof owner;
  const record = z.object({
    id: z.uuid(),
    createdBy: z.string(),
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
            title: "Agent",
            instructions: "Work",
            model: "fixture",
            visibility,
            skillIds,
            subscriptionId: accountId,
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
            title: "Account metadata",
            type: "mcp",
            accountRef: "fixture-account",
            visibility,
          },
          human,
        ),
      ),
    );
  }
  async function subscription(
    visibility: "user" | "workspace" = "user",
    human = owner,
  ) {
    return z
      .object({
        id: z.uuid(),
        createdBy: z.string(),
        visibility: z.enum(["user", "workspace"]),
      })
      .parse(
        await value(
          await request(
            "/subscriptions",
            "POST",
            { title: "Managed account", visibility, provider: "codex" },
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
    app = createApp({ db: database.db, boss, auth, origin, pi });
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
    accountId = (await subscription("workspace")).id;
    // Explicit synthetic confirmed account: computer binding does not authenticate it.
    await inWorkspace(database.db, workspaceId, { userId: owner.id }, (c) =>
      qualifySubscription(c, accountId, "codex"),
    );
    computer = new ControlledComputer(accountId);
    runtime = createRunRuntime(database.db, {
      ...piRuntime,
      backend: computer,
      pi,
      deadlineMs: 30000,
      handleTool: createRunTools(database.db, boss, { pi, storage }),
      readSkillFile: (input) => readRunSkillFile(database.db, storage, input),
    });
    app = createApp({
      db: database.db,
      boss,
      auth,
      origin,
      pi,
      runtime,
      storage,
      spool: transfers.spool,
    });
    worker = await startQueue(database.db, database.pool, {
      runtime,
      pi,
    });
  });
  it("derives createdBy for reusable resources and rejects forged creator fields", async () => {
    expect(process.versions.bun).toBeDefined();
    for (const [path, payload] of [
      [
        "/agents",
        {
          title: "Creator",
          instructions: "Work",
          model: "fixture",
        },
      ],
      [
        "/documents",
        { title: "Creator", body: "Body", visibility: "workspace" },
      ],
      [
        "/connections",
        { title: "Creator", type: "mcp", accountRef: "fixture" },
      ],
    ] as const) {
      for (const forged of [
        { createdBy: other.id },
        { createdById: other.id },
      ]) {
        expect(
          (await request(path, "POST", { ...payload, ...forged })).status,
        ).toBe(400);
      }
      const response = await value(await request(path, "POST", payload));
      const created = path === "/agents" ? response.agent : response;
      expect(created).toMatchObject({ createdBy: owner.id });
      expect(created).not.toHaveProperty("ownerId");
      const id = z.object({ id: z.uuid() }).parse(created).id;
      expect(
        (
          await request(`${path}/${id}`, "PATCH", {
            createdBy: other.id,
            editToken: 0,
          })
        ).status,
      ).toBe(400);
    }
  });

  it("stores shared skill selections once in workspace-safe relations and replaces them atomically", async () => {
    const first = await skill("workspace");
    const second = await skill("workspace");
    const selected = [first.id, second.id].sort();
    const a = await agent("workspace", owner, [...selected].reverse());
    const b = await agent("workspace", owner, [first.id]);
    const read = async () =>
      z
        .object({ skillIds: z.array(z.uuid()), editToken: z.number() })
        .parse(await value(await request(`/agents/${a.id}`)));
    expect((await read()).skillIds).toEqual(selected);
    const stored = await database.pool.query(
      'select "agentId", "skillId" from agents_skills where "agentId" = any($1::uuid[]) order by "agentId", "skillId"',
      [[a.id, b.id]],
    );
    expect(stored.rowCount).toBe(3);
    const columns = await database.pool.query(
      "select column_name from information_schema.columns where table_name='agents' and column_name='skillIds'",
    );
    expect(columns.rowCount).toBe(0);
    expect(
      (
        await request(
          `/agents/${a.id}`,
          "PATCH",
          { skillIds: [first.id], editToken: 0 },
          other,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(`/agents/${a.id}`, "PATCH", {
          skillIds: [first.id, first.id],
          editToken: 0,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(`/agents/${a.id}`, "PATCH", {
          skillIds: Array.from({ length: 51 }, () => crypto.randomUUID()),
          editToken: 0,
        })
      ).status,
    ).toBe(400);
    const before = await inWorkspace(
      database.db,
      workspaceId,
      { userId: owner.id },
      getCursor,
    );
    const changed = await request(`/agents/${a.id}`, "PATCH", {
      skillIds: [second.id],
      editToken: 0,
    });
    expect(changed.status).toBe(200);
    expect(await read()).toEqual({ skillIds: [second.id], editToken: 1 });
    expect(
      (
        await request(`/agents/${a.id}`, "PATCH", {
          skillIds: [],
          editToken: 0,
        })
      ).status,
    ).toBe(409);
    expect(await read()).toEqual({ skillIds: [second.id], editToken: 1 });
    expect(
      await inWorkspace(
        database.db,
        workspaceId,
        { userId: owner.id },
        getCursor,
      ),
    ).toBe(before + 1);
    expect((await value(await request(`/agents/${b.id}`))).skillIds).toEqual([
      first.id,
    ]);
    expect(
      (
        await request(`/agents/${a.id}`, "PATCH", {
          skillIds: [],
          editToken: 1,
        })
      ).status,
    ).toBe(200);
    expect(await read()).toEqual({ skillIds: [], editToken: 2 });
  });

  it("rejects invalid skill relations and rolls back replacement including the Agent edit fence", async () => {
    const valid = await skill("workspace");
    const privateSkill = await skill("user", other);
    const a = await agent("workspace", owner, [valid.id]);
    const foreignWorkspace = crypto.randomUUID();
    await database.db
      .insert(workspaces)
      .values({ id: foreignWorkspace, title: "Foreign relation" });
    const foreignSkill = crypto.randomUUID();
    await database.db.insert(skillsTable).values({
      id: foreignSkill,
      workspaceId: foreignWorkspace,
      createdBy: owner.id,
      title: "Foreign",
      instructions: "No cross-workspace",

      visibility: "workspace",
    });
    const ordinary = z.object({ id: z.uuid() }).parse(
      await value(
        await request("/documents", "POST", {
          title: "Ordinary",
          body: "No implicit skill",
          visibility: "workspace",
        }),
      ),
    );
    const cursor = await inWorkspace(
      database.db,
      workspaceId,
      { userId: owner.id },
      getCursor,
    );
    for (const [skillId, status] of [
      [privateSkill.id, 403],
      [foreignSkill, 404],
      [ordinary.id, 404],
      [crypto.randomUUID(), 404],
    ] as const) {
      expect(
        (
          await request(`/agents/${a.id}`, "PATCH", {
            skillIds: [skillId],
            editToken: 0,
          })
        ).status,
      ).toBe(status);
    }
    const insert =
      'insert into agents_skills("workspaceId","agentId","skillId") values($1,$2,$3)';
    await expect(
      database.pool.query(insert, [workspaceId, a.id, valid.id]),
    ).rejects.toMatchObject({ code: "23505" });
    await expect(
      database.pool.query(insert, [workspaceId, a.id, foreignSkill]),
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "agents_skills_skill_workspace_fk",
    });
    await expect(
      database.pool.query(insert, [foreignWorkspace, a.id, foreignSkill]),
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "agents_skills_agent_workspace_fk",
    });
    // The real mutation updates Agent then replaces the relation; FK failure must roll both back.
    await expect(
      inWorkspace(database.db, workspaceId, { userId: owner.id }, (c) =>
        updateAgent(c, a.id, {
          title: "Must roll back",
          skillIds: [foreignSkill],
          editToken: 0,
        }),
      ),
    ).rejects.toMatchObject({ cause: { code: "23503" } });
    const current = z
      .object({
        skillIds: z.array(z.uuid()),
        editToken: z.number(),
        title: z.string(),
      })
      .parse(await value(await request(`/agents/${a.id}`)));
    expect(current).toEqual({
      skillIds: [valid.id],
      editToken: 0,
      title: "Agent",
    });
    expect(
      await inWorkspace(
        database.db,
        workspaceId,
        { userId: owner.id },
        getCursor,
      ),
    ).toBe(cursor);
    const results = await Promise.all([
      request(`/agents/${a.id}`, "PATCH", { skillIds: [], editToken: 0 }),
      request(`/agents/${a.id}`, "PATCH", {
        skillIds: [valid.id],
        editToken: 0,
      }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const winner = results.find((r) => r.status === 200);
    if (!winner) throw new Error("Missing winning edit");
    const expected = z
      .object({ skillIds: z.array(z.uuid()), editToken: z.number() })
      .parse(await winner.json());
    expect(expected.editToken).toBe(1);
    expect(
      z
        .object({ skillIds: z.array(z.uuid()), editToken: z.number() })
        .parse(await value(await request(`/agents/${a.id}`))),
    ).toEqual(expected);
  });

  it("hydrates all 50 selected skills in singular and paginated Agent projections without a second stored array", async () => {
    const skills = Array.from({ length: 50 }, () => crypto.randomUUID());
    await database.db.insert(skillsTable).values(
      skills.map((id) => ({
        id,
        workspaceId,
        createdBy: owner.id,
        title: "Bounded",
        instructions: "Skill",

        visibility: "workspace" as const,
      })),
    );
    const a = await agent("workspace", owner, skills);
    const projection = z.object({ id: z.uuid(), skillIds: z.array(z.uuid()) });
    expect(
      projection.parse(await value(await request(`/agents/${a.id}`))).skillIds,
    ).toEqual([...skills].sort());
    const list = z
      .object({ items: z.array(projection), next: z.string().nullable() })
      .parse(await value(await request("/agents?limit=100")));
    expect(list.items.find((row) => row.id === a.id)?.skillIds).toEqual(
      [...skills].sort(),
    );
    expect(
      (
        await request(`/agents/${a.id}`, "PATCH", {
          skillIds: [...skills, crypto.randomUUID()],
          editToken: 0,
        })
      ).status,
    ).toBe(400);
    expect(
      projection.parse(await value(await request(`/agents/${a.id}`))).skillIds,
    ).toEqual([...skills].sort());
  });

  it("canonicalizes UUID skill selections and rejects equivalent duplicates without mutation", async () => {
    const selected = await skill("workspace");
    const a = await agent("workspace");
    const cursor = await inWorkspace(
      database.db,
      workspaceId,
      { userId: owner.id },
      getCursor,
    );
    expect(
      (
        await request(`/agents/${a.id}`, "PATCH", {
          skillIds: [selected.id, selected.id.toUpperCase()],
          editToken: 0,
        })
      ).status,
    ).toBe(400);
    expect(
      await inWorkspace(
        database.db,
        workspaceId,
        { userId: owner.id },
        getCursor,
      ),
    ).toBe(cursor);
    const changed = z
      .object({ skillIds: z.array(z.uuid()), editToken: z.number() })
      .parse(
        await value(
          await request(`/agents/${a.id}`, "PATCH", {
            skillIds: [selected.id.toUpperCase()],
            editToken: 0,
          }),
        ),
      );
    expect(changed).toEqual({ skillIds: [selected.id], editToken: 1 });
    expect(
      z
        .object({ skillIds: z.array(z.uuid()), editToken: z.number() })
        .parse(await value(await request(`/agents/${a.id}`))),
    ).toEqual(changed);
  });

  it("uses one Document audience and creator edits without collaborator ACLs", async () => {
    const doc = z
      .object({
        id: z.uuid(),
        visibility: z.literal("user"),
        createdBy: z.string(),
        editToken: z.number(),
      })
      .parse(
        await value(
          await request("/documents", "POST", {
            title: "Personal",
            body: "Source",
          }),
        ),
      );
    expect(doc.createdBy).toBe(owner.id);
    expect(
      (await request(`/documents/${doc.id}`, "GET", undefined, other)).status,
    ).toBe(403);
    expect(
      (
        await request(`/documents/${doc.id}`, "PATCH", {
          visibility: "workspace",
          editToken: 0,
        })
      ).status,
    ).toBe(200);
    const shared = await value(
      await request(`/documents/${doc.id}`, "GET", undefined, other),
    );
    for (const field of ["access", "readerIds", "writerIds"])
      expect(shared).not.toHaveProperty(field);
    expect(
      (
        await request(
          `/documents/${doc.id}`,
          "PATCH",
          { body: "Denied", editToken: 1 },
          other,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(`/documents/${doc.id}`, "PATCH", {
          body: "Stale",
          editToken: 0,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(`/documents/${doc.id}`, "PATCH", {
          visibility: "user",
          editToken: 1,
        })
      ).status,
    ).toBe(200);
    expect(
      (await request(`/documents/${doc.id}`, "GET", undefined, other)).status,
    ).toBe(403);
    expect(
      (
        await request(`/documents/${doc.id}/access`, "PUT", {
          readerIds: [other.id],
          writerIds: [],
          editToken: 2,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await request("/documents", "POST", {
          title: "Old ACL",
          body: "No",
          visibility: "participants",
          readerIds: [other.id],
        })
      ).status,
    ).toBe(400);
  });

  it("never authenticates accounts through computer binding and checks the creator even after qualification", async () => {
    const account = await subscription("workspace");
    const view = z.object({
      id: z.uuid(),
      status: z.enum(["needs_auth", "enabled", "disabled"]),
      createdBy: z.string(),
    });
    const read = async () =>
      view.parse(await value(await request(`/subscriptions/${account.id}`)));
    expect(await read()).toMatchObject({
      status: "needs_auth",
      createdBy: owner.id,
    });
    for (const forbidden of [
      { status: "enabled" },
      { createdBy: other.id },
      { accountRef: "switched" },
    ])
      expect(
        (
          await request(`/subscriptions/${account.id}`, "PATCH", {
            ...forbidden,
          })
        ).status,
      ).toBe(400);
    expect(
      (
        await request("/connections", "POST", {
          title: "Native is not an app",
          type: "model",
          accountRef: "fixture",
        })
      ).status,
    ).toBe(400);
    const a = z.object({ agent: z.object({ id: z.uuid() }) }).parse(
      await value(
        await request("/agents", "POST", {
          title: "Native qualification",
          instructions: "Work",
          model: "fixture",
          subscriptionId: account.id,
        }),
      ),
    ).agent;
    expect(
      (await request(`/agents/${a.id}/computer`, "POST", { computerRef: a.id }))
        .status,
    ).toBe(200);
    expect((await read()).status).toBe("needs_auth");
    // Controlled confirmed persistence event; the actual public SDK/Infisical path is exercised separately.
    await inWorkspace(database.db, workspaceId, { userId: owner.id }, (c) =>
      qualifySubscription(c, account.id, "codex"),
    );
    expect((await read()).status).toBe("enabled");
    await expect(
      inWorkspace(database.db, workspaceId, { userId: other.id }, (c) =>
        qualifySubscription(c, account.id, "codex"),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(
      (
        await request(`/subscriptions/${account.id}`, "PATCH", {
          status: "disabled",
        })
      ).status,
    ).toBe(200);
    await expect(
      inWorkspace(database.db, workspaceId, { userId: owner.id }, (c) =>
        qualifySubscription(c, account.id, "codex"),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(
      (await request(`/agents/${a.id}/computer`, "POST", { computerRef: a.id }))
        .status,
    ).toBe(200);
    expect((await read()).status).toBe("disabled");
    expect(
      (
        await request(`/subscriptions/${account.id}`, "PATCH", {
          status: "needs_auth",
        })
      ).status,
    ).toBe(200);
    await inWorkspace(database.db, workspaceId, { userId: owner.id }, (c) =>
      qualifySubscription(c, account.id, "codex"),
    );
    expect((await read()).status).toBe("enabled");
  });

  it("keeps Subscription metadata creator-controlled and rechecks current creator membership", async () => {
    const account = await subscription("workspace", other);
    expect((await request(`/subscriptions/${account.id}`, "GET")).status).toBe(
      200,
    );
    expect(
      (
        await request(`/subscriptions/${account.id}`, "PATCH", {
          status: "disabled",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(
          `/subscriptions/${account.id}`,
          "GET",
          undefined,
          outsider,
        )
      ).status,
    ).toBe(403);
    const body = await value(await request(`/subscriptions/${account.id}`));
    for (const field of [
      "accountRef",
      "credentialRef",
      "mode",
      "connected",
      "editToken",
    ])
      expect(body).not.toHaveProperty(field);
    await database.db.delete(members).where(eq(members.userId, other.id));
    try {
      expect(
        (await request(`/subscriptions/${account.id}`, "GET")).status,
      ).toBe(403);
    } finally {
      await database.db
        .insert(members)
        .values({ workspaceId, userId: other.id, role: "contributor" });
    }
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
          title: "Agent",
          instructions: "Work",
          model: "fixture",
        },
      ],
      ["/skills", { title: "Skill", instructions: "Secret" }],
      [
        "/connections",
        { title: "Account", type: "mcp", accountRef: "fixture" },
      ],
    ] as const) {
      for (const extra of [
        { createdBy: owner.id },
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
      expect(created).toMatchObject({
        createdBy: other.id,
        visibility: "user",
      });
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
        await request("/skills", "POST", {
          title: "Contradiction",
          instructions: "x",

          visibility: "workspace",
          access: "inherited",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request("/documents", "POST", {
          title: "Ordinary",
          body: "x",
          visibility: "workspace",
          access: "inherited",
        })
      ).status,
    ).toBe(400);
  });
  it("workspace discovery/use never grants configuration; visibility edits are owner-only and stale-safe", async () => {
    for (const [path, created] of [
      ["/agents", await agent("workspace")],
      ["/skills", await skill("workspace")],
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
            createdBy: other.id,
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
          `/skills/${shared.id}`,
          "PATCH",
          { instructions: "overwrite", editToken: 0 },
          other,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(
          `/skills/${shared.id}/files`,
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
            `/skills/${shared.id}/proposals`,
            "POST",
            { title: "Suggested", instructions: "Proposed", editToken: 0 },
            other,
          ),
        ),
      );
    expect(
      (
        await request(
          `/skills/${shared.id}/proposals/${proposal.id}/resolve`,
          "POST",
          { accept: true },
          other,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(
          `/skills/${shared.id}/proposals/${proposal.id}/resolve`,
          "POST",
          { accept: true },
        )
      ).status,
    ).toBe(200);
    expect(
      z
        .object({ instructions: z.string() })
        .parse(await value(await request(`/skills/${shared.id}`))).instructions,
    ).toBe("Proposed");
  });
  it("narrows private rows in SQL so a hidden first row is never scanned or named by a cursor", async () => {
    for (const [path, create, table] of [
      ["/agents", agent, agents],
      ["/skills", skill, skillsTable],
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
        // Private rows are narrowed in SQL, so the hidden first row is never scanned or named by a cursor.
        if (firstPage) {
          expect(result.items.map((item) => item.id)).toEqual([second]);
          expect(result.next).not.toBe(first);
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
          `/skills/${privateSkill.id}/files`,
          "PUT",
          { files: [], editToken: 0 },
          other,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(`/skills/${privateSkill.id}/access`, "PUT", {
          readerIds: [other.id],
          writerIds: [],
          editToken: 0,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(
          "/agents",
          "POST",
          {
            title: "Steal",
            instructions: "Work",
            model: "fixture",
            skillIds: [privateSkill.id],
          },
          other,
        )
      ).status,
    ).toBe(403);
    const sharedAgent = await agent("workspace", owner, [privateSkill.id]);
    const chat = z
      .object({ id: z.uuid() })
      .parse(
        await value(
          await request(
            "/chats",
            "POST",
            { title: "Shared", visibility: "participants" },
            other,
          ),
        ),
      );
    await value(
      await request(
        `/chats/${chat.id}/participants`,
        "POST",
        { agentId: sharedAgent.id, role: "contributor" },
        other,
      ),
    );
    const run = {
      agentId: sharedAgent.id,
      chatId: chat.id,
      requestId: crypto.randomUUID(),
      type: "prompt",
      body: "Work",
    };
    expect((await request("/runs", "POST", run, other)).status).toBe(403);
    await value(
      await request(`/skills/${privateSkill.id}`, "PATCH", {
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
      await request(`/skills/${privateSkill.id}`, "PATCH", {
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
          await request("/files", "POST", {
            requestId: crypto.randomUUID(),
            title: "Skill bytes",
            type: "text",
            visibility: "workspace",
            mediaType: "text/plain",
            bytes: Buffer.from("immutable instructions").toString("base64"),
          }),
        ),
      );
      await value(
        await request(`/skills/${selected.id}/files`, "PUT", {
          editToken: 0,
          files: [{ path: "references/source.txt", fileId: file.id }],
        }),
      );
    }
    const configured = await agent("workspace", owner, [selected.id]);
    await value(
      await request(`/agents/${configured.id}/computer`, "POST", {
        computerRef: configured.id,
      }),
    );
    const chat = z
      .object({ id: z.uuid() })
      .parse(
        await value(
          await request(
            "/chats",
            "POST",
            { title: "Live visibility", visibility: "participants" },
            other,
          ),
        ),
      );
    await value(
      await request(
        `/chats/${chat.id}/participants`,
        "POST",
        { agentId: configured.id, role: "contributor" },
        other,
      ),
    );
    return { selected, configured, chat };
  }
  const state = async (id: string) =>
    (await database.db.select().from(runs).where(eq(runs.id, id)))[0]?.state;
  it.each(["agent", "skill", "subscription", "membership"] as const)(
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
              chatId: source.chat.id,
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
      try {
        if (resource === "membership")
          await database.db.delete(members).where(eq(members.userId, other.id));
        else {
          const path =
            resource === "agent"
              ? `/agents/${source.configured.id}`
              : resource === "skill"
                ? `/skills/${source.selected.id}`
                : `/subscriptions/${accountId}`;
          await value(
            await request(path, "PATCH", {
              visibility: "user",
              ...(resource === "subscription" ? {} : { editToken: 0 }),
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
                chatId: source.chat.id,
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
        if (resource === "subscription")
          await value(
            await request(`/subscriptions/${accountId}`, "PATCH", {
              visibility: "workspace",
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
            chatId: source.chat.id,
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
        await request(`/skills/${source.selected.id}`, "PATCH", {
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
  it("keeps disabled manual Schedules available, archived launches denied, and obsolete capabilities invalid", async () => {
    const configured = await agent();
    const chat = z.object({ id: z.uuid() }).parse(
      await value(
        await request("/chats", "POST", {
          title: "Manual",
          visibility: "participants",
        }),
      ),
    );
    await value(
      await request(`/chats/${chat.id}/participants`, "POST", {
        agentId: configured.id,
        role: "contributor",
      }),
    );
    const input = {
      title: "Manual",
      agentId: configured.id,
      chatId: chat.id,
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
        (await request("/schedules", "POST", { ...input, ...extra })).status,
      ).toBe(400);
    const schedule = z
      .object({ id: z.uuid() })
      .parse(await value(await request("/schedules", "POST", input)));
    expect(
      (
        await request(`/schedules/${schedule.id}/run`, "POST", {
          requestId: crypto.randomUUID(),
        })
      ).status,
    ).toBe(200);
    await value(
      await request(`/schedules/${schedule.id}`, "PATCH", {
        status: "archived",
        editToken: 0,
      }),
    );
    expect(
      (
        await request(`/schedules/${schedule.id}/run`, "POST", {
          requestId: crypto.randomUUID(),
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(`/schedules/${schedule.id}`, "PATCH", {
          status: "enabled",
          editToken: 1,
        })
      ).status,
    ).toBe(409);
    await value(
      await request(`/schedules/${schedule.id}`, "PATCH", {
        status: "disabled",
        editToken: 1,
      }),
    );
    expect(
      (
        await request("/runs", "POST", {
          agentId: configured.id,
          chatId: chat.id,
          requestId: crypto.randomUUID(),
          type: "script",
          body: "fixture",
          skillIds: [],
        })
      ).status,
    ).toBe(400);
  });
  it("caps workspace Chat writers by an explicit viewer row", async () => {
    const chat = z.object({ id: z.uuid() }).parse(
      await value(
        await request("/chats", "POST", {
          title: "Inherited viewer",
          visibility: "workspace",
        }),
      ),
    );
    await value(
      await request(`/chats/${chat.id}/participants`, "POST", {
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
      .parse(await value(await request(`/chats/${chat.id}/participants`)));
    const viewer = participants.items.find((row) => row.userId === other.id);
    if (!viewer) throw new Error("No viewer");
    expect(
      (
        await request(
          `/chats/${chat.id}/messages`,
          "POST",
          { requestId: crypto.randomUUID(), body: "Forbidden" },
          other,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(
          `/chats/${chat.id}/participants/${viewer.id}`,
          "PATCH",
          { role: "contributor" },
          other,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(
          `/chats/${chat.id}/participants/${viewer.id}`,
          "DELETE",
          {},
          other,
        )
      ).status,
    ).toBe(403);
    expect(
      (await request(`/chats/${chat.id}`, "GET", undefined, other)).status,
    ).toBe(200);
    await value(
      await request(
        `/chats/${chat.id}/participants/${viewer.id}`,
        "DELETE",
        {},
      ),
    );
    expect(
      (
        await request(
          `/chats/${chat.id}/messages`,
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
        await value(await request("/projects", "POST", { title: "Reopen" })),
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
          await request("/projects", "POST", { title: "Archive authority" }),
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
  it("intersects selected workspace Document recipients with current Project membership", async () => {
    const project = z
      .object({ id: z.uuid() })
      .parse(
        await value(
          await request("/projects", "POST", { title: "Selected scope" }),
        ),
      );
    const doc = z.object({ id: z.uuid() }).parse(
      await value(
        await request("/documents", "POST", {
          title: "Project secret",
          body: "Scoped bytes",
          projectId: project.id,
          visibility: "workspace",
        }),
      ),
    );
    const configured = await agent("workspace");
    const chat = z.object({ id: z.uuid() }).parse(
      await value(
        await request("/chats", "POST", {
          title: "Wider output",
          visibility: "workspace",
        }),
      ),
    );
    await value(
      await request(`/chats/${chat.id}/participants`, "POST", {
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
      chatId: chat.id,
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
  it("intersects workspace File attachment recipients with current Project membership", async () => {
    const project = z
      .object({ id: z.uuid() })
      .parse(
        await value(
          await request("/projects", "POST", { title: "Attachment scope" }),
        ),
      );
    const file = z.object({ id: z.uuid() }).parse(
      await value(
        await request("/files", "POST", {
          requestId: crypto.randomUUID(),
          title: "Scoped",
          type: "text",
          visibility: "user",
          projectId: project.id,
          mediaType: "text/plain",
          bytes: Buffer.from("private").toString("base64"),
        }),
      ),
    );
    await value(
      await request(`/files/${file.id}`, "PATCH", {
        visibility: "workspace",
      }),
    );
    const doc = z.object({ id: z.uuid() }).parse(
      await value(
        await request("/documents", "POST", {
          title: "Workspace",
          body: "Reference",
          visibility: "workspace",
        }),
      ),
    );
    expect(
      (
        await request(`/documents/${doc.id}/attachments`, "PUT", {
          fileIds: [file.id],
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
          fileIds: [file.id],
          editToken: 0,
        })
      ).status,
    ).toBe(200);
  });
  it("keeps user skill supporting bytes private and rejects sharing a private dependency", async () => {
    const selected = await skill();
    const file = z.object({ id: z.uuid() }).parse(
      await value(
        await request("/files", "POST", {
          requestId: crypto.randomUUID(),
          title: "User bytes",
          type: "text",
          visibility: "user",
          mediaType: "text/plain",
          bytes: Buffer.from("owner-only supporting material").toString(
            "base64",
          ),
        }),
      ),
    );
    expect(
      (
        await request(`/skills/${selected.id}/files`, "PUT", {
          editToken: 0,
          files: [{ path: "references/private.txt", fileId: file.id }],
        })
      ).status,
    ).toBe(200);
    expect(
      (await request(`/skills/${selected.id}/export`, "GET", undefined, other))
        .status,
    ).toBe(403);
    expect(
      (await request(`/files/${file.id}/file`, "GET", undefined, other)).status,
    ).toBe(403);
    expect(
      (
        await request(`/skills/${selected.id}`, "PATCH", {
          visibility: "workspace",
          editToken: 1,
        })
      ).status,
    ).toBe(403);
    expect(
      record.parse(await value(await request(`/skills/${selected.id}`)))
        .visibility,
    ).toBe("user");
    await value(
      await request(`/files/${file.id}`, "PATCH", {
        visibility: "workspace",
      }),
    );
    expect(
      (
        await request(`/skills/${selected.id}`, "PATCH", {
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
    const chat = z.object({ id: z.uuid() }).parse(
      await value(
        await request("/chats", "POST", {
          title: "Shared file output",
          visibility: "workspace",
        }),
      ),
    );
    await value(
      await request(`/chats/${chat.id}/participants`, "POST", {
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
            chatId: chat.id,
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
        skillId: selected.id,
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
          await request(`/files/${file.id}`, "PATCH", {
            visibility: "user",
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
        pi,
      });
    }
  });
  it.each(["message", "document", "grant"] as const)(
    "intersects saved and current source-Run recipients for private File %s publication",
    async (target) => {
      await worker.stop({ graceful: false });
      let runId: string | undefined;
      try {
        const configured = await agent("workspace");
        const source = z.object({ id: z.uuid() }).parse(
          await value(
            await request("/chats", "POST", {
              title: "Private source output",
              visibility: "participants",
            }),
          ),
        );
        await value(
          await request(`/chats/${source.id}/participants`, "POST", {
            userId: other.id,
            role: "contributor",
          }),
        );
        await value(
          await request(`/chats/${source.id}/participants`, "POST", {
            agentId: configured.id,
            role: "contributor",
          }),
        );
        runId = z.object({ id: z.uuid() }).parse(
          await value(
            await request("/runs", "POST", {
              agentId: configured.id,
              chatId: source.id,
              requestId: crypto.randomUUID(),
              type: "prompt",
              body: "Source output",
            }),
          ),
        ).id;
        const file = z.object({ id: z.uuid() }).parse(
          await value(
            await request("/files", "POST", {
              requestId: crypto.randomUUID(),
              title: "Accepted output",
              type: "text",
              visibility: "user",
              sourceRunId: runId,
              mediaType: "text/plain",
              bytes: Buffer.from("accepted output").toString("base64"),
            }),
          ),
        );
        await value(
          await request(`/files/${file.id}`, "PATCH", {
            visibility: "workspace",
          }),
        );
        expect(
          (await request(`/files/${file.id}`, "GET", undefined, other)).status,
        ).toBe(200);
        const chat = z.object({ id: z.uuid() }).parse(
          await value(
            await request("/chats", "POST", {
              title: "Target output",
              visibility: "participants",
            }),
          ),
        );
        await value(
          await request(`/chats/${chat.id}/participants`, "POST", {
            userId: other.id,
            role: "contributor",
          }),
        );
        const doc = z.object({ id: z.uuid() }).parse(
          await value(
            await request("/documents", "POST", {
              title: "Target document",
              body: "Reference",
              visibility: "workspace",
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
            await value(await request(`/chats/${source.id}/participants`)),
          );
        const peer = participants.items.find((p) => p.userId === other.id);
        if (!peer) throw new Error("Missing peer");
        await value(
          await request(
            `/chats/${source.id}/participants/${peer.id}`,
            "DELETE",
            {},
          ),
        );
        expect(
          (await request(`/files/${file.id}`, "GET", undefined, other)).status,
        ).toBe(403);
        const publish = () =>
          target === "message"
            ? request(`/chats/${chat.id}/messages`, "POST", {
                requestId: crypto.randomUUID(),
                body: "Attached output",
                fileIds: [file.id],
              })
            : target === "document"
              ? request(`/documents/${doc.id}/attachments`, "PUT", {
                  fileIds: [file.id],
                  editToken: 0,
                })
              : request(`/files/${file.id}`, "PATCH", {
                  visibility: "workspace",
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
          await value(await request(`/files/${file.id}`)),
        ).not.toHaveProperty("editToken");
        // An original recipient may regain current access, but a later invite never widens the saved cap.
        await value(
          await request(`/chats/${source.id}/participants`, "POST", {
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
            await request(`/chats/${source.id}/participants`, "POST", {
              userId: outsider.id,
              role: "contributor",
            }),
          );
          const beforeLate = await cursor();
          expect(
            (
              await request(`/files/${file.id}`, "PATCH", {
                visibility: "workspace",
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
          pi,
        });
      }
    },
  );
});
