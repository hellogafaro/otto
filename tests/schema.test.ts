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
        'insert into conversations(id,"workspaceId",title,visibility,"createdBy") values($1,$2,$3,$4,$5)',
        [
          conversationId,
          workspaceId,
          "Discussion",
          "workspace",
          "schema-owner",
        ],
      );
      await expect(
        database.pool.query(
          'insert into conversations("workspaceId",title,visibility,"createdBy") values($1,$2,$3,$4)',
          [workspaceId, "Invalid creator", "workspace", "absent-human"],
        ),
      ).rejects.toMatchObject({
        code: "23503",
        constraint: "conversations_createdBy_fk",
      });
      await expect(
        database.pool.query(
          'insert into conversations("workspaceId",title,visibility,"createdBy") values($1,$2,$3,$4)',
          [workspaceId, "Invalid audience", "public", "schema-owner"],
        ),
      ).rejects.toMatchObject({
        code: "23514",
        constraint: "conversations_visibility",
      });
      const agentId = crypto.randomUUID();
      const skillId = crypto.randomUUID();
      await database.pool.query(
        'insert into agents(id,"workspaceId","createdBy",name,instructions,model) values($1,$2,$3,$4,$5,$6)',
        [agentId, workspaceId, "schema-owner", "Agent", "Work", "fixture"],
      );
      await database.pool.query(
        'insert into skills(id,"workspaceId","createdBy",title,instructions,visibility) values($1,$2,$3,$4,$5,$6)',
        [
          skillId,
          workspaceId,
          "schema-owner",
          "Skill",
          "Exact body",
          "workspace",
        ],
      );
      await database.pool.query(
        'insert into agents_skills("workspaceId","agentId","skillId") values($1,$2,$3)',
        [workspaceId, agentId, skillId],
      );
      const subscriptionId = crypto.randomUUID();
      await database.pool.query(
        'insert into subscriptions(id,"workspaceId","createdBy",name,provider) values($1,$2,$3,$4,$5)',
        [subscriptionId, workspaceId, "schema-owner", "Native", "codex"],
      );
      await database.pool.query(
        'update agents set "subscriptionId"=$1 where id=$2',
        [subscriptionId, agentId],
      );
      await expect(
        database.pool.query(
          'insert into agents("workspaceId","createdBy",name,instructions,model,"subscriptionId") values($1,$2,$3,$4,$5,$6)',
          [
            otherWorkspaceId,
            "schema-owner",
            "Cross native",
            "Work",
            "fixture",
            subscriptionId,
          ],
        ),
      ).rejects.toMatchObject({
        code: "23503",
        constraint: "agents_subscriptionId_workspace_fk",
      });
      await expect(
        database.pool.query("update subscriptions set status=$1 where id=$2", [
          "active",
          subscriptionId,
        ]),
      ).rejects.toMatchObject({
        code: "23514",
        constraint: "subscriptions_status",
      });
      const selection = async () =>
        (
          await database.pool.query(
            'select a.id,a."createdBy",a."subscriptionId",s."skillId",d.instructions from agents a join agents_skills s on s."agentId"=a.id join skills d on d.id=s."skillId" where a.id=$1',
            [agentId],
          )
        ).rows;
      const savedSelection = await selection();
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
      expect(await selection()).toEqual(savedSelection);
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
      for (const table of [
        "agents",
        "documents",
        "connections",
        "subscriptions",
      ] as const) {
        const inputs = {
          subscriptions: '"workspaceId",name,provider,"createdBy"',
          agents: '"workspaceId",name,instructions,model,"createdBy"',
          documents: '"workspaceId",title,body,"createdBy"',
          connections: '"workspaceId",name,type,"accountRef","createdBy"',
        };
        const values = {
          subscriptions: [
            workspaceId,
            "Gateway account",
            "codex",
            "absent-human",
          ],
          agents: [workspaceId, "Bad", "Work", "fixture", "absent-human"],
          documents: [workspaceId, "Bad", "Body", "absent-human"],
          connections: [workspaceId, "Bad", "mcp", "fixture", "absent-human"],
        };
        await expect(
          database.pool.query(
            `insert into ${table}(${inputs[table]}) values(${values[table].map((_, i) => `$${i + 1}`).join(",")})`,
            values[table],
          ),
        ).rejects.toMatchObject({
          code: "23503",
          constraint: `${table}_createdBy_fk`,
        });
      }
      const messageSql =
        'insert into messages("workspaceId","conversationId","authorUserId",body,"requestId",cursor) values($1,$2,$3,$4,$5,$6)';
      for (const [messageWorkspace, destination] of [
        [workspaceId, crypto.randomUUID()],
        [otherWorkspaceId, conversationId],
      ]) {
        await expect(
          database.pool.query(messageSql, [
            messageWorkspace,
            destination,
            "schema-owner",
            "invalid",
            crypto.randomUUID(),
            1,
          ]),
        ).rejects.toMatchObject({
          code: "23503",
          constraint: "messages_conversationId_workspace_fk",
        });
      }
      await database.pool.query(
        'insert into conversation_reads("conversationId","userId",cursor) values($1,$2,1)',
        [conversationId, "schema-owner"],
      );
      await expect(
        database.pool.query(
          'insert into conversation_reads("conversationId","userId",cursor) values($1,$2,0)',
          [conversationId, "schema-owner"],
        ),
      ).rejects.toMatchObject({ code: "23505" });
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
          'insert into artifacts("workspaceId","ownerId","requestId",title,type,visibility,"objectKey",sha256,"byteLength","mediaType",request) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,jsonb_build_object())',
          [
            workspaceId,
            "schema-owner",
            crypto.randomUUID(),
            "Large",
            "file",
            "workspace",
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
