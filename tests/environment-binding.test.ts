import { existsSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { createApp } from "../apps/server/src/app";
import { createAuth } from "../apps/server/src/auth";
import { startQueue } from "../apps/server/src/queue";
import {
  bindEnvironment,
  bindExecutionScope,
  claimEnvironment,
  settleEnvironment,
} from "../packages/environments/src";
import { environments } from "../packages/environments/src/schema";
import { RUN_QUEUE } from "../packages/runs/src";
import {
  createRunRuntime,
  type RunRuntime,
} from "../packages/runs/src/runtime";
import { required } from "../packages/shared/src";
import { claimInstallation, inWorkspace } from "../packages/workspaces/src";
import { members, workspaces } from "../packages/workspaces/src/schema";
import { ControlledComputer } from "./fixtures/computer";
import { pi, piRuntime } from "./fixtures/pi";
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

  function push(native = false) {
    const command = Bun.spawnSync(
      [
        process.execPath,
        ...(native
          ? [
              "--bun",
              "drizzle-kit",
              "push",
              "--config=drizzle.config.ts",
              "--verbose",
            ]
          : ["scripts/push.ts"]),
      ],
      {
        cwd: new URL("../", import.meta.url).pathname,
        env: {
          PATH: process.env.PATH,
          DATABASE_URL: `postgresql://otto_test@localhost/postgres?host=${encodeURIComponent(database.directory)}`,
        },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        timeout: 30000,
      },
    );
    const output = command.stdout.toString() + command.stderr.toString();
    expect(command.exitCode, output).toBe(0);
    return output;
  }

  beforeAll(async () => {
    expect(process.versions.bun).toBeTruthy();
    database = await startPostgres({ schema: false });
    push();
    boss = await startQueue(database.db, database.pool, {
      workers: false,
      install: true,
    });
    computer = new ControlledComputer("unused-scripts-only-account");
    runtime = createRunRuntime(database.db, {
      ...piRuntime,
      pi,
      backend: computer,
    });
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
      pi,
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
    if (database) expect(existsSync(database.directory)).toBe(false);
  });

  it.each(["declared", "existing provider-first"])(
    "repeats native push with %s uniqueness and populated Environments, retaining leases, data and queue objects",
    async (constraint) => {
      const first = await agent();
      const second = await agent(owner, otherWorkspaceId);
      const third = await agent();
      const ref = crypto.randomUUID();
      expect((await bind(first, ref)).status).toBe(200);
      expect((await bind(second, ref, owner, otherWorkspaceId)).status).toBe(
        409,
      );
      const runId = crypto.randomUUID();
      await inWorkspace(
        database.db,
        workspaceId,
        { userId: owner.id },
        async (c) => {
          await bindExecutionScope(c, first, "retained-fixture-scope");
          await claimEnvironment(c, first, runId, 0);
          await settleEnvironment(c.tx, workspaceId, first, runId, 0, false);
        },
      );
      expect(await saved(first)).toMatchObject({
        activeRunId: runId,
        state: "uncertain",
        generation: 0,
      });
      for (const id of [second, third])
        expect(await saved(id)).toMatchObject({
          provider: null,
          computerRef: null,
          activeRunId: null,
        });
      const pending = await boss.send(
        RUN_QUEUE,
        { runId },
        { startAfter: 3600 },
      );
      expect(pending).toBeTruthy();
      await database.pool.query(
        "create table if not exists public.unmanaged_probe (id integer primary key, value text not null)",
      );
      await database.pool.query(
        "insert into public.unmanaged_probe values (1, 'must survive') on conflict do nothing",
      );
      if (constraint === "existing provider-first")
        // Model the input revision's physical constraint on this private fixture only.
        await database.pool.query(
          'alter table environments drop constraint environments_provider_computer_unique, add constraint environments_provider_computer_unique unique(provider, "computerRef")',
        );
      const snapshot = async () => {
        const tables = z
          .array(z.object({ name: z.string() }))
          .parse(
            (
              await database.pool.query(
                "select format('%I.%I', schemaname, tablename) as name from pg_tables where schemaname in ('public','queue') order by schemaname,tablename",
              )
            ).rows,
          );
        const data = [];
        for (const { name } of tables) {
          // Native pg-boss startup updates queue.version service heartbeat times.
          // Compare its schema version and every other table's complete row bytes.
          const value =
            name === "queue.version"
              ? "t.version::text"
              : "row_to_json(t)::text";
          data.push({
            name,
            rows: (
              await database.pool.query(
                `select encode(sha256(convert_to(${value}, 'UTF8')), 'hex') as hash from ${name} t order by hash`,
              )
            ).rows,
          });
        }
        return {
          data,
          bindingConstraint: (
            await database.pool.query(
              "select oid,conindid,pg_get_constraintdef(oid) as definition from pg_constraint where conname='environments_provider_computer_unique'",
            )
          ).rows,
          constraints: (
            await database.pool.query(
              "select conrelid::regclass::text as table_name, conname, pg_get_constraintdef(oid) as definition from pg_constraint where connamespace in ('public'::regnamespace,'queue'::regnamespace) order by table_name,conname",
            )
          ).rows,
          indexes: (
            await database.pool.query(
              "select schemaname,tablename,indexname,indexdef from pg_indexes where schemaname in ('public','queue') order by schemaname,tablename,indexname",
            )
          ).rows,
          queue: (
            await database.pool.query(
              "select oid,relname,relkind from pg_class where relnamespace='queue'::regnamespace order by oid",
            )
          ).rows,
        };
      };
      const before = await snapshot();
      for (let attempt = 0; attempt < 2; attempt++) {
        push();
        expect(await snapshot()).toEqual(before);
      }
      const output = push(true);
      expect(output).toMatch(/Changes applied|No changes detected/);
      expect(output).not.toMatch(
        /truncate|Do you want|environments_provider_computer_unique/i,
      );
      expect(await snapshot()).toEqual(before);
      expect((await bind(second, ref, owner, otherWorkspaceId)).status).toBe(
        409,
      );
      await expect(
        database.pool.query(
          'update environments set provider=$1, "computerRef"=$2 where "agentId"=$3',
          [computer.provider, ref, second],
        ),
      ).rejects.toMatchObject({
        code: "23505",
        constraint: "environments_provider_computer_unique",
      });
      expect(await snapshot()).toEqual(before);
    },
  );

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
