import { and, eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { createApp } from "../apps/server/src/app";
import { createAuth } from "../apps/server/src/auth";
import { startQueue } from "../apps/server/src/queue";
import {
  bindEnvironment,
  claimEnvironment,
  settleEnvironment,
} from "../packages/environments/src";
import { environments } from "../packages/environments/src/schema";
import {
  createRunRuntime,
  type RunRuntime,
} from "../packages/runs/src/runtime";
import { required } from "../packages/shared/src";
import { claimInstallation, inWorkspace } from "../packages/workspaces/src";
import { members, workspaces } from "../packages/workspaces/src/schema";
import { ControlledComputer } from "./fixtures/computer";
import { harnesses } from "./fixtures/harnesses";
import { startPostgres } from "./postgres";

/** Real auth/HTTP/PG/runtime binding with a controlled connector; no provider isolation claim. */
describe("exclusive computer binding and writer authorization", () => {
  let database: Awaited<ReturnType<typeof startPostgres>>;
  let boss: PgBoss;
  let runtime: RunRuntime;
  let computer: ControlledComputer;
  let app: ReturnType<typeof createApp>;
  let server: ReturnType<typeof Bun.serve>;
  let origin: string;
  let workspaceId: string;
  let otherWorkspaceId: string;
  let owner: { id: string; cookie: string };
  let contributor: { id: string; cookie: string };

  async function request(
    path: string,
    body: unknown,
    human = owner,
    workspace = workspaceId,
  ) {
    return fetch(`${origin}/api/workspaces/${workspace}${path}`, {
      method: "POST",
      headers: {
        cookie: human.cookie,
        origin,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  }
  async function agent(human = owner, workspace = workspaceId) {
    const response = await request(
      "/agents",
      {
        title: "Binding fixture",
        visibility: "workspace",
        instructions: "Work",
        harness: "fixture",
        model: "fixture",
      },
      human,
      workspace,
    );
    expect(response.status).toBe(200);
    return z
      .object({ agent: z.object({ id: z.uuid(), subscriptionId: z.null() }) })
      .parse(await response.json()).agent.id;
  }
  const bind = (
    id: string,
    ref: string,
    human = owner,
    workspace = workspaceId,
  ) =>
    request(`/agents/${id}/computer`, { computerRef: ref }, human, workspace);
  const saved = async (id: string) =>
    required(
      (
        await database.db
          .select()
          .from(environments)
          .where(eq(environments.agentId, id))
      )[0],
    );

  beforeAll(async () => {
    expect(process.versions.bun).toBeTruthy();
    database = await startPostgres();
    boss = await startQueue(database.db, database.pool, {
      workers: false,
      install: true,
    });
    computer = new ControlledComputer("unused-scripts-only-account");
    runtime = createRunRuntime(database.db, { harnesses, backend: computer });
    server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (r) => app.fetch(r),
    });
    origin = server.url.origin;
    const auth = createAuth(
      database.db,
      crypto.randomUUID() + crypto.randomUUID(),
      origin,
    );
    app = createApp({
      db: database.db,
      boss,
      auth,
      origin,
      harnesses,
      runtime,
    });
    async function human(name: string) {
      const response = await fetch(`${origin}/api/auth/sign-up/email`, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({
          name,
          email: `${name}@binding.test`,
          password: crypto.randomUUID() + crypto.randomUUID(),
        }),
      });
      expect(response.status).toBe(200);
      const body = z
        .object({ user: z.object({ id: z.string() }) })
        .parse(await response.json());
      return {
        id: body.user.id,
        cookie: response.headers.get("set-cookie") ?? "",
      };
    }
    owner = await human("owner");
    contributor = await human("contributor");
    workspaceId = (await claimInstallation(database.db, owner.id, "Binding"))
      .id;
    otherWorkspaceId = required(
      (
        await database.db
          .insert(workspaces)
          .values({ title: "Other binding workspace" })
          .returning()
      )[0],
    ).id;
    await database.db.insert(members).values([
      { workspaceId, userId: contributor.id, role: "contributor" },
      { workspaceId: otherWorkspaceId, userId: owner.id, role: "owner" },
    ]);
  });
  afterAll(async () => {
    await computer?.close();
    await runtime?.close();
    await server?.stop(true);
    await boss?.stop();
    await database?.stop();
  });

  it("rejects a second Agent on the same computer and preserves an uncertain lease", async () => {
    const first = await agent();
    const second = await agent();
    const ref = crypto.randomUUID();
    expect((await bind(first, ref)).status).toBe(200);
    const untouched = await saved(second);
    expect((await bind(second, ref)).status).toBe(409);
    expect(await saved(second)).toEqual(untouched);
    const runId = crypto.randomUUID();
    await inWorkspace(
      database.db,
      workspaceId,
      { userId: owner.id },
      async (c) => {
        await claimEnvironment(c, first, runId, 0);
        await expect(
          settleEnvironment(c.tx, workspaceId, first, runId, 99, true),
        ).rejects.toMatchObject({ code: "conflict" });
        await settleEnvironment(c.tx, workspaceId, first, runId, 0, false);
      },
    );
    const leased = await saved(first);
    expect((await bind(second, ref)).status).toBe(409);
    expect((await bind(first, ref)).status).toBe(409);
    expect(await saved(first)).toEqual(leased);
    expect(await saved(second)).toEqual(untouched);
  });

  it("allows exactly one concurrent cross-workspace binding to a canonical computer", async () => {
    const first = await agent();
    const second = await agent(owner, otherWorkspaceId);
    const ref = crypto.randomUUID();
    const responses = await Promise.all([
      bind(first, ref),
      bind(second, ref, owner, otherWorkspaceId),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    const rows = [await saved(first), await saved(second)];
    expect(rows.filter((row) => row.computerRef === ref)).toHaveLength(1);
    expect(rows.filter((row) => row.state === "unavailable")).toHaveLength(1);
  });

  it("enforces exclusivity in PostgreSQL even outside the domain guard", async () => {
    const first = await agent();
    const second = await agent(owner, otherWorkspaceId);
    const ref = crypto.randomUUID();
    expect((await bind(first, ref)).status).toBe(200);
    await expect(
      database.pool.query(
        'update environments set provider = $1, "computerRef" = $2 where "agentId" = $3',
        [computer.provider, ref, second],
      ),
    ).rejects.toMatchObject({
      code: "23505",
      constraint: "environments_provider_computer_unique",
    });
    expect((await saved(second)).computerRef).toBeNull();
  });

  it("propagates unrelated database failures without translating them to conflicts", async () => {
    const id = await agent();
    const before = await saved(id);
    await expect(
      inWorkspace(database.db, workspaceId, { userId: owner.id }, (c) =>
        bindEnvironment(c, id, computer.provider, "invalid\0reference"),
      ),
    ).rejects.toMatchObject({ cause: { code: "22021" } });
    expect(await saved(id)).toEqual(before);
  });

  it("allows distinct references and independent leases while preserving rebinding fences", async () => {
    const first = await agent();
    const second = await agent(owner, otherWorkspaceId);
    const refs = [crypto.randomUUID(), crypto.randomUUID()];
    const firstRef = required(refs[0]);
    const secondRef = required(refs[1]);
    expect((await bind(first, firstRef)).status).toBe(200);
    expect((await bind(first, firstRef)).status).toBe(200);
    expect((await bind(first, secondRef)).status).toBe(409);
    expect(
      (await bind(second, secondRef, owner, otherWorkspaceId)).status,
    ).toBe(200);
    const runIds = [crypto.randomUUID(), crypto.randomUUID()];
    await Promise.all([
      inWorkspace(database.db, workspaceId, { userId: owner.id }, (c) =>
        claimEnvironment(c, first, required(runIds[0]), 0),
      ),
      inWorkspace(database.db, otherWorkspaceId, { userId: owner.id }, (c) =>
        claimEnvironment(c, second, required(runIds[1]), 0),
      ),
    ]);
    expect((await saved(first)).activeRunId).toBe(runIds[0]);
    expect((await saved(second)).activeRunId).toBe(runIds[1]);
    expect((await bind(first, firstRef)).status).toBe(409);
    await expect(
      inWorkspace(database.db, workspaceId, { userId: owner.id }, (c) =>
        claimEnvironment(c, first, required(runIds[0]), 1),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("denies a downgraded scripts-only owner without mutation, then permits the restored writer", async () => {
    const id = await agent(contributor);
    const before = await saved(id);
    const ref = crypto.randomUUID();
    await database.db
      .update(members)
      .set({ role: "viewer" })
      .where(
        and(
          eq(members.workspaceId, workspaceId),
          eq(members.userId, contributor.id),
        ),
      );
    expect((await bind(id, ref, contributor)).status).toBe(403);
    expect(await saved(id)).toEqual(before);
    await expect(
      inWorkspace(database.db, workspaceId, { userId: contributor.id }, (c) =>
        bindEnvironment(c, id, computer.provider, ref),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await saved(id)).toEqual(before);
    await database.db
      .update(members)
      .set({ role: "contributor" })
      .where(
        and(
          eq(members.workspaceId, workspaceId),
          eq(members.userId, contributor.id),
        ),
      );
    expect((await bind(id, ref, contributor)).status).toBe(200);
    expect(await saved(id)).toMatchObject({
      computerRef: ref,
      provider: computer.provider,
      state: "ready",
      generation: before.generation,
    });
  });
});
