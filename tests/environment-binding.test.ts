import { existsSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { createApp } from "../apps/server/src/app";
import { createAuth } from "../apps/server/src/auth";
import { startQueue } from "../apps/server/src/queue";
import { getEnvironment } from "../packages/environments/src";
import { environments } from "../packages/environments/src/schema";
import { snapshotRunDocuments } from "../packages/library/src";
import { RUN_QUEUE } from "../packages/runs/src";
import {
  createRunRuntime,
  type RunRuntime,
} from "../packages/runs/src/runtime";
import { openNativeStorage } from "../packages/sessions/src/native";
import { required } from "../packages/shared/src";
import { claimInstallation, inWorkspace } from "../packages/workspaces/src";
import { members, workspaces } from "../packages/workspaces/src/schema";
import { controlledModel } from "./fixtures/native-model";
import { startPostgres } from "./postgres";

describe("disabled computer binding and preserved PostgreSQL records", () => {
  let database: Awaited<ReturnType<typeof startPostgres>>;
  let boss: PgBoss;
  let runtime: RunRuntime;
  let native: Awaited<ReturnType<typeof openNativeStorage>>;
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
    native = await openNativeStorage({
      connectionString: `postgresql://otto_test@localhost/postgres?host=${encodeURIComponent(database.directory)}`,
    });
    runtime = createRunRuntime(database.db, {
      storage: native,
      resolveModel: async () => controlledModel(),
      tools: () => ({}),
      snapshotDocuments: snapshotRunDocuments,
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
      nativeStorage: native,
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
    await native?.close();
    await runtime?.close();
    await server?.stop(true);
    await boss?.stop();
    await database?.stop();
    if (database) expect(existsSync(database.directory)).toBe(false);
  });

  it.each(["declared", "existing provider-first"])(
    "repeats native push with %s uniqueness, preserving unsupported records and native storage",
    async (constraint) => {
      const first = await agent();
      const second = await agent(owner, otherWorkspaceId);
      const third = await agent();
      const ref = crypto.randomUUID();
      const runId = crypto.randomUUID();
      await database.db
        .update(environments)
        .set({
          provider: "retained-unsupported-provider",
          computerRef: ref,
          activeRunId: runId,
          state: "uncertain",
          executionScope: "retained-unsupported-scope",
        })
        .where(eq(environments.agentId, first));
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
                "select format('%I.%I', schemaname, tablename) as name from pg_tables where schemaname in ('public','queue','mastra') order by schemaname,tablename",
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
              "select schemaname,tablename,indexname,indexdef from pg_indexes where schemaname in ('public','queue','mastra') order by schemaname,tablename,indexname",
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
        503,
      );
      await expect(
        database.pool.query(
          'update environments set provider=$1, "computerRef"=$2 where "agentId"=$3',
          ["retained-unsupported-provider", ref, second],
        ),
      ).rejects.toMatchObject({
        code: "23505",
        constraint: "environments_provider_computer_unique",
      });
      expect(await snapshot()).toEqual(before);
    },
  );

  it("refuses binding for two Agents across workspaces without claiming a computer", async () => {
    const first = await agent();
    const second = await agent(owner, otherWorkspaceId);
    const before = [await saved(first), await saved(second)];
    const ref = crypto.randomUUID();
    const responses = await Promise.all([
      bind(first, ref),
      bind(second, ref, owner, otherWorkspaceId),
    ]);
    expect(responses.map((r) => r.status)).toEqual([503, 503]);
    expect([await saved(first), await saved(second)]).toEqual(before);
    expect(
      before.every(
        (row) =>
          row.state === "unavailable" &&
          row.activeRunId === null &&
          row.computerRef === null,
      ),
    ).toBe(true);
  });

  it("preserves unsupported uncertain records rather than releasing or replacing their lease", async () => {
    const id = await agent();
    await database.db
      .update(environments)
      .set({
        provider: "retained-unsupported-provider",
        computerRef: "retained-reference",
        activeRunId: crypto.randomUUID(),
        state: "uncertain",
      })
      .where(eq(environments.agentId, id));
    const before = await saved(id);
    for (const ref of ["retained-reference", "replacement-reference"]) {
      expect((await bind(id, ref)).status).toBe(503);
      expect(await saved(id)).toEqual(before);
    }
  });

  it("denies a viewer and does not turn restored writer authority into a compute provider", async () => {
    const id = await agent(contributor);
    const before = await saved(id);
    await database.db
      .update(members)
      .set({ role: "viewer" })
      .where(
        and(
          eq(members.workspaceId, workspaceId),
          eq(members.userId, contributor.id),
        ),
      );
    expect((await bind(id, "unavailable", contributor)).status).toBe(403);
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
    expect((await bind(id, "unavailable", contributor)).status).toBe(503);
    expect(await saved(id)).toEqual(before);
    expect(
      await inWorkspace(
        database.db,
        workspaceId,
        { userId: contributor.id },
        (c) => getEnvironment(c, id),
      ),
    ).toEqual(before);
  });
});
