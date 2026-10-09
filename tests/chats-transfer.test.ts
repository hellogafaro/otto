import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { z } from "zod";
import { createApp } from "../apps/server/src/app";
import { createAuth } from "../apps/server/src/auth";
import { startQueue } from "../apps/server/src/queue";
import { createRunRuntime } from "../packages/runs/src/runtime";
import { runs } from "../packages/runs/src/schema";
import { validateSchedule } from "../packages/schedules/src";
import { createSubscription } from "../packages/subscriptions/src";
import { subscriptions } from "../packages/subscriptions/src/schema";
import { claimInstallation, inWorkspace } from "../packages/workspaces/src";
import { pushDatabase } from "../scripts/push";
import { ControlledComputer } from "./fixtures/computer";
import { pi, piRuntime } from "./fixtures/pi";
import { startPostgres } from "./postgres";

const TABLES =
  "'chats','chat_participants','chat_reads','messages','runs','agent_sessions','schedules'";

it("offline Chat rename keeps IDs, rows, accepted request/share/session/queue bytes and matches fresh push", async () => {
  const database = await startPostgres();
  const fresh = await startPostgres();
  const boss = await startQueue(database.db, database.pool, {
    workers: false,
    install: true,
  });
  let app: ReturnType<typeof createApp>;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (r) => app.fetch(r),
  });
  try {
    const origin = server.url.origin;
    const auth = createAuth(
      database.db,
      crypto.randomUUID() + crypto.randomUUID(),
      origin,
    );
    app = createApp({ db: database.db, auth, boss, origin, pi });
    const registration = await auth.api.signUpEmail({
      body: {
        name: "Chat Owner",
        email: "chat-transfer@example.test",
        password: crypto.randomUUID() + crypto.randomUUID(),
      },
      asResponse: true,
    });
    const cookie = registration.headers.get("set-cookie") ?? "";
    const session = await auth.api.getSession({
      headers: new Headers({ cookie }),
    });
    if (!session) throw new Error("Missing authenticated fixture");
    const userId = session.user.id;
    const workspaceId = (await claimInstallation(database.db, userId, "Chats"))
      .id;
    const request = (path: string, method = "GET", json?: unknown) =>
      fetch(`${origin}/api/workspaces/${workspaceId}${path}`, {
        method,
        headers: { cookie, origin, "content-type": "application/json" },
        ...(json === undefined ? {} : { body: JSON.stringify(json) }),
      });
    const record = z.object({ id: z.string() }).passthrough();
    const ok = async (path: string, json: unknown) => {
      const response = await request(path, "POST", json);
      expect(response.status, await response.clone().text()).toBe(200);
    };
    const post = async (path: string, json: unknown, method = "POST") => {
      const response = await request(path, method, json);
      expect(response.status, await response.clone().text()).toBe(200);
      return record.parse(await response.json());
    };
    const agent = z.object({ agent: record }).parse(
      await (
        await request("/agents", "POST", {
          title: "Worker",
          instructions: "Work",
          model: "none",
          visibility: "workspace",
        })
      ).json(),
    ).agent;
    const chat = await post("/chats", {
      title: "Transfer",
      visibility: "workspace",
    });
    await ok(`/chats/${chat.id}/participants`, {
      agentId: agent.id,
      role: "contributor",
    });
    // Real runtime-produced retained scopes (the controlled computer is a fixture, not isolation proof).
    const accountId = (
      await inWorkspace(database.db, workspaceId, { userId }, (c) =>
        createSubscription(c, {
          provider: "codex",
          title: "Fixture native account",
          visibility: "workspace",
        }),
      )
    ).id;
    await database.db
      .update(subscriptions)
      .set({ status: "enabled" })
      .where(eq(subscriptions.id, accountId));
    const computer = new ControlledComputer(accountId);
    const runtime = createRunRuntime(database.db, {
      ...piRuntime,
      backend: computer,
      pi,
      deadlineMs: 30000,
      validateSchedule,
    });
    const withRuntime = async <T>(work: () => Promise<T>) => {
      const worker = await startQueue(database.db, database.pool, {
        runtime,
        pi,
      });
      const previous = app;
      app = createApp({ db: database.db, auth, boss, origin, pi, runtime });
      try {
        return await work();
      } finally {
        await worker.stop({ graceful: false });
        app = previous;
      }
    };
    const runState = async (id: string) =>
      (await database.db.select().from(runs).where(eq(runs.id, id)))[0];
    const runtimeAgents: Record<"prompt" | "script", string> = {
      prompt: "",
      script: "",
    };
    // Computer binding needs the runtime-backed API.
    await withRuntime(async () => {
      for (const type of ["prompt", "script"] as const) {
        const created = z.object({ agent: record }).parse(
          await (
            await request("/agents", "POST", {
              title: `Runtime ${type}`,
              instructions: "Work",
              model: "fixture",
              subscriptionId: accountId,
              visibility: "workspace",
            })
          ).json(),
        ).agent;
        await ok(`/agents/${created.id}/computer`, { computerRef: created.id });
        await ok(`/chats/${chat.id}/participants`, {
          agentId: created.id,
          role: "contributor",
        });
        runtimeAgents[type] = created.id;
      }
    });
    const runOnRetained = (type: "prompt" | "script", extra = {}) =>
      post("/runs", {
        chatId: chat.id,
        agentId: runtimeAgents[type],
        requestId: crypto.randomUUID(),
        type,
        body: "finish",
        ...extra,
      });
    const finish = async (id: string) =>
      expect
        .poll(async () => (await runState(id))?.state, { timeout: 15000 })
        .toBe("finished");
    await withRuntime(async () => {
      for (const type of ["prompt", "script"] as const)
        await finish((await runOnRetained(type)).id);
    });
    const runtimeScopes = async () =>
      (
        await database.pool.query(
          'select "agentId","executionScope" from environments where "agentId"=any($1) order by "agentId"',
          [Object.values(runtimeAgents)],
        )
      ).rows;
    const originalScopes = await runtimeScopes();
    for (const row of originalScopes) {
      // The persisted serialization keeps the historical private key; the Chat ID is retained in it.
      expect(JSON.parse(row.executionScope)).toMatchObject({
        conversationId: chat.id,
      });
      expect(row.executionScope).not.toContain("chatId");
    }
    const messageRequest = crypto.randomUUID();
    const first = await post(`/chats/${chat.id}/messages`, {
      requestId: messageRequest,
      body: "First",
    });
    const reply = await post(`/chats/${chat.id}/messages`, {
      requestId: crypto.randomUUID(),
      body: "Reply",
      replyTo: first.id,
    });
    await ok(`/chats/${chat.id}/read`, {
      cursor: z.object({ cursor: z.number() }).parse(reply).cursor,
    });
    const project = await post("/projects", { title: "Linked" });
    const task = await post("/tasks", {
      projectId: project.id,
      title: "Linked task",
    });
    await ok(`/tasks/${task.id}/links`, {
      type: "chat",
      reference: chat.id,
    });
    const retainedScope = JSON.stringify({
      accepted: "chat-rename-byte-proof",
      sources: [],
    });
    const environment = (
      await database.pool.query(
        'update environments set "executionScope"=$1 where "agentId"=$2 returning id,generation',
        [retainedScope, agent.id],
      )
    ).rows[0];
    if (!environment) throw new Error("Missing Agent Environment");
    await database.pool.query(
      'insert into agent_sessions(id,"workspaceId","chatId","agentId","environmentId","environmentGeneration",scope,"piVersion",provider,model,"accountId","contextRef") values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
      [
        crypto.randomUUID(),
        workspaceId,
        chat.id,
        agent.id,
        environment.id,
        environment.generation,
        retainedScope,
        "fixture-only",
        "codex",
        "controlled-model",
        "controlled-account",
        "/private/unchanged-session.jsonl",
      ],
    );
    const runInput = {
      chatId: chat.id,
      agentId: agent.id,
      requestId: crypto.randomUUID(),
      type: "script",
      body: "echo controlled",
    };
    const oldRun = await post("/runs", runInput);
    const share = await post("/shares/preview", {
      selection: {
        type: "chat",
        targetId: chat.id,
        messageIds: [first.id, reply.id],
      },
    });
    await ok(`/shares/${share.id}/publish`, {
      editToken: z.object({ editToken: z.number() }).parse(share).editToken,
    });
    expect((await request(`/runs/${oldRun.id}/stop`, "POST", {})).status).toBe(
      200,
    );
    // Reconstruct the captured old physical state: names, discriminators and frozen share JSON only.
    await database.pool.query(`
      DO $$ DECLARE e record; BEGIN
        FOR e IN SELECT c.conname,t.relname FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
          WHERE t.relname IN (${TABLES}) AND c.connamespace='public'::regnamespace AND c.conname LIKE '%chat%' LOOP
          EXECUTE format('ALTER TABLE %I RENAME CONSTRAINT %I TO %I',e.relname,e.conname,replace(e.conname,'chat','conversation')); END LOOP;
        FOR e IN SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename IN (${TABLES}) AND indexname LIKE '%chat%' LOOP
          EXECUTE format('ALTER INDEX %I RENAME TO %I',e.indexname,replace(e.indexname,'chat','conversation')); END LOOP;
      END $$;
      ALTER TABLE chats RENAME TO conversations;
      ALTER TABLE chat_participants RENAME TO conversation_participants;
      ALTER TABLE chat_reads RENAME TO conversation_reads;
      ALTER TABLE conversation_participants RENAME COLUMN "chatId" TO "conversationId";
      ALTER TABLE conversation_reads RENAME COLUMN "chatId" TO "conversationId";
      ALTER TABLE messages RENAME COLUMN "chatId" TO "conversationId";
      ALTER TABLE runs RENAME COLUMN "chatId" TO "conversationId";
      ALTER TABLE agent_sessions RENAME COLUMN "chatId" TO "conversationId";
      ALTER TABLE schedules RENAME COLUMN "chatId" TO "conversationId";
      UPDATE task_links SET type='conversation' WHERE type='chat';
      UPDATE content_shares SET
        selection=jsonb_set(selection,'{type}','"conversation"'),
        preview=jsonb_set(preview,'{type}','"conversation"'),
        snapshot=jsonb_set(snapshot,'{type}','"conversation"');
    `);
    const names = async (db: typeof database) =>
      (
        await db.pool.query(`
          select 'constraint' as kind, t.relname||'.'||c.conname as name from pg_constraint c join pg_class t on t.oid=c.conrelid
            where c.connamespace='public'::regnamespace and (t.relname in (${TABLES}) or c.confrelid in (select oid from pg_class where relname in (${TABLES})))
          union all select 'index', tablename||'.'||indexname from pg_indexes where schemaname='public' and tablename in (${TABLES})
          union all select 'column', table_name||'.'||column_name from information_schema.columns where table_schema='public' and table_name in (${TABLES}) and column_name ilike '%chat%'
          union all select 'table', table_name from information_schema.tables where table_schema='public' and table_name like 'chat%'
          order by 1,2`)
      ).rows;
    const proof = async () => ({
      runs: (
        await database.pool.query(
          `select id,coalesce(to_jsonb(r)->>'conversationId',to_jsonb(r)->>'chatId') as chat,inputs::text,"requestIdentity"::text,"requestId" from runs r order by id`,
        )
      ).rows,
      sessions: (
        await database.pool.query(
          'select scope,"contextRef","accountId" from agent_sessions order by id',
        )
      ).rows,
      scopes: (
        await database.pool.query(
          'select "executionScope" from environments order by id',
        )
      ).rows,
      shares: (
        await database.pool.query(
          'select id,selection::text,preview::text,snapshot::text,"editToken" from content_shares order by id',
        )
      ).rows,
      jobs: (
        await database.pool.query(
          "select id,name,data::text from queue.job order by id",
        )
      ).rows,
      rows: (
        await database.pool.query(
          `select (select count(*)::int from messages) as messages, (select count(*)::int from environments) as environments`,
        )
      ).rows,
    });
    // An old busy lease/Run must refuse atomically; its owner stops it first.
    await database.pool.query("update runs set state='queued' where id=$1", [
      oldRun.id,
    ]);
    const sql = await Bun.file(
      new URL("../scripts/rename-chats.sql", import.meta.url),
    ).text();
    const oldNames = await names(database);
    const busy = await proof();
    await expect(database.pool.query(sql)).rejects.toThrow("Quiescent Runs");
    await database.pool.query("ROLLBACK");
    expect(await proof()).toEqual(busy);
    expect(await names(database)).toEqual(oldNames);
    await database.pool.query(
      "update runs set state='interrupted' where id=$1",
      [oldRun.id],
    );
    // Mixed state (a pre-existing target table) must refuse without partial renames.
    await database.pool.query("create table chats(id int)");
    await expect(database.pool.query(sql)).rejects.toThrow(
      "Expected only old Conversation tables",
    );
    await database.pool.query("ROLLBACK");
    await database.pool.query("drop table chats");
    // The Schedules rename must have run first.
    await database.pool.query("alter table schedules rename to automations");
    await expect(database.pool.query(sql)).rejects.toThrow(
      "rename-schedules.sql first",
    );
    await database.pool.query("ROLLBACK");
    await database.pool.query("alter table automations rename to schedules");
    // Mixed discriminators refuse.
    await database.pool.query(
      "insert into task_links(\"taskId\",type,reference) values($1,'chat','mixed')",
      [task.id],
    );
    await expect(database.pool.query(sql)).rejects.toThrow(
      "Mixed Task-link discriminators",
    );
    await database.pool.query("ROLLBACK");
    await database.pool.query("delete from task_links where reference='mixed'");
    expect(await names(database)).toEqual(oldNames);
    const before = await proof();
    const oldRows = (
      await database.pool.query(
        'select m.id,m."conversationId" as "chatId",m.body,m."replyTo",m."requestId",m.cursor from messages m order by m.id',
      )
    ).rows;
    const oldChats = (
      await database.pool.query("select * from conversations order by id")
    ).rows;
    const oldParticipants = (
      await database.pool.query(
        'select id,"conversationId" as "chatId","userId","agentId",role from conversation_participants order by id',
      )
    ).rows;
    const oldReads = (
      await database.pool.query(
        'select "conversationId" as "chatId","userId",cursor from conversation_reads order by 1,2',
      )
    ).rows;
    await database.pool.query(sql);
    // Atomic rename: every scalar name changed and nothing else.
    expect(await names(database)).toEqual(await names(fresh));
    const after = await proof();
    expect(after).toEqual(before);
    expect(
      (await database.pool.query("select * from chats order by id")).rows,
    ).toEqual(oldChats);
    expect(
      (
        await database.pool.query(
          'select id,"chatId",body,"replyTo","requestId",cursor from messages order by id',
        )
      ).rows,
    ).toEqual(oldRows);
    expect(
      (
        await database.pool.query(
          'select id,"chatId","userId","agentId",role from chat_participants order by id',
        )
      ).rows,
    ).toEqual(oldParticipants);
    expect(
      (
        await database.pool.query(
          'select "chatId","userId",cursor from chat_reads order by 1,2',
        )
      ).rows,
    ).toEqual(oldReads);
    expect(
      (
        await database.pool.query(
          "select reference from task_links where type='chat'",
        )
      ).rows,
    ).toEqual([{ reference: chat.id }]);
    // A repeat refuses and changes nothing.
    await expect(database.pool.query(sql)).rejects.toThrow(
      "Expected only old Conversation tables",
    );
    await database.pool.query("ROLLBACK");
    expect(await proof()).toEqual(before);
    // New API: original IDs, exact old retries and legacy-projected frozen share.
    expect((await request(`/chats/${chat.id}`)).status).toBe(200);
    expect((await request(`/conversations/${chat.id}`)).status).toBe(404);
    expect((await post("/runs", runInput)).id).toBe(oldRun.id);
    expect(
      (
        await post(`/chats/${chat.id}/messages`, {
          requestId: messageRequest,
          body: "First",
        })
      ).id,
    ).toBe(first.id);
    const shared = await (
      await fetch(`${origin}/api/shares/${share.id}`)
    ).json();
    expect(shared).toMatchObject({ type: "chat" });
    expect(
      z
        .object({
          items: z.array(
            z.object({ selection: z.object({ type: z.string() }) }),
          ),
        })
        .parse(await (await request("/shares")).json()).items[0]?.selection
        .type,
    ).toBe("chat");
    expect(
      (await (await request(`/tasks/${task.id}/links`)).json()).items,
    ).toMatchObject([{ type: "chat", reference: chat.id }]);
    // Retained runtime scopes stay byte-equal and still authorize new prompt and script Runs on the same Environments.
    expect(await runtimeScopes()).toEqual(originalScopes);
    await withRuntime(async () => {
      for (const type of ["prompt", "script"] as const)
        await finish((await runOnRetained(type)).id);
      // A changed accepted source set is still denied against the retained scope; the guard is not relaxed.
      const document = await post("/documents", {
        title: "Changed source",
        body: "source",
        visibility: "workspace",
      });
      const changed = await runOnRetained("prompt", {
        documentIds: [document.id],
      });
      await expect
        .poll(async () => (await runState(changed.id))?.state, {
          timeout: 15000,
        })
        .toBe("failed");
      expect((await runState(changed.id))?.outcome).toBe(
        "admission_configuration_unavailable",
      );
    });
    expect(await runtimeScopes()).toEqual(originalScopes);
    // Fresh and repeated native push is semantically stable after the rename (including the new Runs above).
    const beforePush = await proof();
    const uri = `postgresql://otto_test@localhost/postgres?host=${encodeURIComponent(database.directory)}`;
    await pushDatabase(uri);
    expect(await proof()).toEqual(beforePush);
    expect(await names(database)).toEqual(await names(fresh));
  } finally {
    await server.stop(true);
    await boss.stop();
    await fresh.stop();
    await database.stop();
  }
}, 90000);
