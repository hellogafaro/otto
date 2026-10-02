import { expect, it } from "vitest";
import { z } from "zod";
import { startQueue } from "../apps/server/src/queue";
import { RUN_QUEUE } from "../packages/runs/src";
import { pushDatabase } from "../scripts/push";
import { startPostgres } from "./postgres";

it("pushes fresh declarative constraints, repeats without changing data/definitions or touching queue-owned objects", async () => {
  expect(process.versions.bun).toBeDefined();
  const database = await startPostgres({ schema: false });
  const url = `postgresql://otto_test@localhost/postgres?host=${encodeURIComponent(database.directory)}`;
  try {
    const command = Bun.spawnSync([process.execPath, "scripts/push.ts"], {
      cwd: new URL("../", import.meta.url).pathname,
      env: { PATH: process.env.PATH, DATABASE_URL: url },
      stdout: "pipe",
      stderr: "pipe",
      timeout: 30000,
    });
    expect(command.exitCode).toBe(0);
    const boss = await startQueue(database.db, database.pool, {
      workers: false,
    });
    try {
      await database.pool.query(
        "insert into auth_users(id,name,email) values('schema-owner','Owner','schema@example.test')",
      );
      const workspaceId = crypto.randomUUID();
      const otherWorkspaceId = crypto.randomUUID();
      const projectId = crypto.randomUUID();
      const conversationId = crypto.randomUUID();
      await database.pool.query(
        "insert into workspaces(id,name,cursor) values($1,'Source',42),($2,'Other',0)",
        [workspaceId, otherWorkspaceId],
      );
      await database.pool.query(
        'insert into projects(id,"workspaceId",name) values($1,$2,$3)',
        [projectId, workspaceId, "Source"],
      );
      await database.pool.query(
        'insert into conversations(id,"workspaceId",title,access) values($1,$2,$3,$4)',
        [conversationId, workspaceId, "Discussion", "inherited"],
      );
      const pending = await boss.send(
        RUN_QUEUE,
        { runId: crypto.randomUUID() },
        { startAfter: 60 },
      );
      const definitions = async () => ({
        constraints: (
          await database.pool.query(
            "select c.relname,conname,pg_get_constraintdef(p.oid) as definition from pg_constraint p join pg_class c on c.oid=p.conrelid where p.connamespace='public'::regnamespace order by c.relname,conname",
          )
        ).rows,
        indexes: (
          await database.pool.query(
            "select tablename,indexname,indexdef from pg_indexes where schemaname='public' order by tablename,indexname",
          )
        ).rows,
        queue: (
          await database.pool.query(
            "select c.oid,c.relname,c.relkind from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='queue' order by c.oid",
          )
        ).rows,
      });
      const before = await definitions();
      const beforeJob = await boss.getJobById(RUN_QUEUE, pending ?? "missing");
      await pushDatabase(url);
      await pushDatabase(url);
      expect(await definitions()).toEqual(before);
      expect(await boss.getJobById(RUN_QUEUE, pending ?? "missing")).toEqual(
        beforeJob,
      );
      expect(
        (
          await database.pool.query(
            "select cursor from workspaces where id=$1",
            [workspaceId],
          )
        ).rows,
      ).toEqual([{ cursor: 42 }]);
      expect(
        (
          await database.pool.query(
            "select to_regnamespace('drizzle') as history",
          )
        ).rows,
      ).toEqual([{ history: null }]);
      const task =
        'insert into tasks("workspaceId","projectId",title,"ownerId",status) values($1,$2,$3,$4,$5)';
      await expect(
        database.pool.query(task, [
          otherWorkspaceId,
          projectId,
          "Cross workspace",
          "schema-owner",
          "todo",
        ]),
      ).rejects.toMatchObject({
        code: "23503",
        constraint: "tasks_projectId_workspace_fk",
      });
      await expect(
        database.pool.query(task, [
          workspaceId,
          projectId,
          "Unknown human",
          "absent-human",
          "todo",
        ]),
      ).rejects.toMatchObject({
        code: "23503",
        constraint: "tasks_ownerId_fk",
      });
      await expect(
        database.pool.query(task, [
          workspaceId,
          projectId,
          "Invalid status",
          "schema-owner",
          "invented",
        ]),
      ).rejects.toMatchObject({
        code: "23514",
        constraint: "tasks_status_values",
      });
      await expect(
        database.pool.query(
          'insert into workspace_members("workspaceId","userId",role) values($1,$2,$3)',
          [workspaceId, "schema-owner", "invented"],
        ),
      ).rejects.toMatchObject({
        code: "23514",
        constraint: "workspace_members_role_values",
      });
      await expect(
        database.pool.query("insert into installation_setups(id) values(2)"),
      ).rejects.toMatchObject({ code: "23514", constraint: "single_setup" });
      await expect(
        database.pool.query(
          'insert into messages("workspaceId","conversationId","authorUserId",body,cursor,"requestId") values($1,$2,$3,$4,1,gen_random_uuid())',
          [workspaceId, conversationId, "schema-owner", "x".repeat(100001)],
        ),
      ).rejects.toMatchObject({ code: "23514", constraint: "messages_size" });
      await expect(
        database.pool.query(
          'insert into artifacts("workspaceId","ownerId","requestId",title,type,access,"objectKey",sha256,"byteLength","mediaType") values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
          [
            workspaceId,
            "schema-owner",
            crypto.randomUUID(),
            "Large",
            "file",
            "inherited",
            crypto.randomUUID(),
            "a".repeat(64),
            8388609,
            "text/plain",
          ],
        ),
      ).rejects.toMatchObject({ code: "23514", constraint: "artifacts_size" });
      await expect(
        database.pool.query(
          'insert into runs("workspaceId","conversationId","agentId","sponsorId","environmentId","environmentGeneration","requestId",type,inputs,cursor) values($1,$2,$3,$4,$5,0,$6,$7,$8,1)',
          [
            workspaceId,
            conversationId,
            crypto.randomUUID(),
            "schema-owner",
            crypto.randomUUID(),
            crypto.randomUUID(),
            "script",
            JSON.stringify({ body: "x".repeat(1048576) }),
          ],
        ),
      ).rejects.toMatchObject({ code: "23514", constraint: "runs_input_size" });
      await database.pool.query(task, [
        workspaceId,
        projectId,
        "Valid human task",
        "schema-owner",
        "todo",
      ]);
      const constraintNames = z
        .array(z.object({ conname: z.string() }))
        .parse(before.constraints)
        .map((c) => c.conname);
      expect(constraintNames).toContain("runs_input_size");
      expect(constraintNames).toContain("runs_sponsorId_fk");
      expect(constraintNames).toContain("runs_sessionId_workspace_fk");
      expect(before.constraints.length).toBeGreaterThan(100);
    } finally {
      await boss.stop();
    }
  } finally {
    await database.stop();
  }
});
