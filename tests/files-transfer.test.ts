import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { z } from "zod";
import { createApp } from "../apps/server/src/app";
import { createAuth } from "../apps/server/src/auth";
import { startQueue } from "../apps/server/src/queue";
import { readRunSkillFile } from "../apps/server/src/skill-files";
import { createRunTools } from "../apps/server/src/tools";
import { createRunRuntime } from "../packages/runs/src/runtime";
import { runs } from "../packages/runs/src/schema";
import { validateSchedule } from "../packages/schedules/src";
import { createSubscription } from "../packages/subscriptions/src";
import { subscriptions } from "../packages/subscriptions/src/schema";
import { claimInstallation, inWorkspace } from "../packages/workspaces/src";
import { pushDatabase } from "../scripts/push";
import { ControlledComputer } from "./fixtures/computer";
import { pi, piRuntime } from "./fixtures/pi";
import { fixtureStorage, testSpool } from "./fixtures/storage";
import { startPostgres } from "./postgres";

const transfers = await testSpool();

const TABLES = "'files','documents','messages','task_links'";

it("offline File rename keeps IDs, bytes, upload/Skill/share/Run/scope/queue evidence and matches a fresh push", async () => {
  const database = await startPostgres();
  const fresh = await startPostgres();
  const boss = await startQueue(database.db, database.pool, {
    workers: false,
    install: true,
  });
  const objects = new Map<string, Uint8Array>();
  let puts = 0;
  const storage = fixtureStorage({
    async put(key, bytes) {
      puts++;
      objects.set(key, bytes.slice());
    },
    async get(key) {
      const bytes = objects.get(key);
      if (!bytes) throw new Error("Missing fixture bytes");
      return bytes.slice();
    },
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
    app = createApp({
      db: database.db,
      auth,
      boss,
      origin,
      pi,
      storage,
      spool: transfers.spool,
    });
    const registration = await auth.api.signUpEmail({
      body: {
        name: "File Owner",
        email: "file-transfer@example.test",
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
    const workspaceId = (await claimInstallation(database.db, userId, "Files"))
      .id;
    const request = (path: string, method = "GET", json?: unknown) =>
      fetch(`${origin}/api/workspaces/${workspaceId}${path}`, {
        method,
        headers: { cookie, origin, "content-type": "application/json" },
        ...(json === undefined ? {} : { body: JSON.stringify(json) }),
      });
    const record = z.object({ id: z.string() }).passthrough();
    const post = async (path: string, json: unknown, method = "POST") => {
      const response = await request(path, method, json);
      expect(response.status, await response.clone().text()).toBe(200);
      return record.parse(await response.json());
    };
    const ok = async (path: string, json: unknown, method = "POST") => {
      const response = await request(path, method, json);
      expect(response.status, await response.clone().text()).toBe(200);
    };
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
      handleTool: createRunTools(database.db, boss, { storage, pi }),
      readSkillFile: (input) => readRunSkillFile(database.db, storage, input),
    });
    const withRuntime = async <T>(work: () => Promise<T>) => {
      const worker = await startQueue(database.db, database.pool, {
        runtime,
        pi,
      });
      const previous = app;
      app = createApp({
        db: database.db,
        auth,
        boss,
        origin,
        pi,
        storage,
        spool: transfers.spool,
        runtime,
      });
      try {
        return await work();
      } finally {
        await worker.stop({ graceful: false });
        app = previous;
      }
    };
    const runState = async (id: string) =>
      (await database.db.select().from(runs).where(eq(runs.id, id)))[0];
    const finish = (id: string) =>
      expect
        .poll(
          async () => {
            const row = await runState(id);
            return `${row?.state}:${row?.state === "finished" ? "" : (row?.outcome ?? "")}`;
          },
          { timeout: 15000 },
        )
        .toBe("finished:");
    const bytes = new TextEncoder().encode("immutable supporting bytes");
    const upload = {
      requestId: crypto.randomUUID(),
      title: "Source file",
      type: "text",
      labels: ["a"],
      mediaType: "text/plain",
      visibility: "workspace",
      bytes: Buffer.from(bytes).toString("base64"),
    };
    const file = await post("/files", upload);
    const skill = await post("/skills", {
      title: "file-skill",
      instructions: "Read references/source.txt",
      whenToUse: "always",
      visibility: "workspace",
    });
    await ok(
      `/skills/${skill.id}/files`,
      {
        editToken: 0,
        files: [{ path: "references/source.txt", fileId: file.id }],
      },
      "PUT",
    );
    const chat = await post("/chats", {
      title: "Files",
      visibility: "workspace",
    });
    const message = await post(`/chats/${chat.id}/messages`, {
      requestId: crypto.randomUUID(),
      body: "with attachment",
      fileIds: [file.id],
    });
    const doc = await post("/documents", {
      title: "Doc",
      body: "body",
      visibility: "workspace",
    });
    await ok(
      `/documents/${doc.id}/attachments`,
      { fileIds: [file.id], editToken: 0 },
      "PUT",
    );
    const project = await post("/projects", { title: "Linked" });
    const task = await post("/tasks", {
      projectId: project.id,
      title: "Linked task",
    });
    await ok(`/tasks/${task.id}/links`, { type: "file", reference: file.id });
    const agents: Record<"prompt" | "script", string> = {
      prompt: "",
      script: "",
    };
    const oldRuns: string[] = [];
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
              skillIds: type === "prompt" ? [skill.id] : [],
            })
          ).json(),
        ).agent;
        await ok(`/agents/${created.id}/computer`, {
          computerRef: created.id,
        });
        await ok(`/chats/${chat.id}/participants`, {
          agentId: created.id,
          role: "contributor",
        });
        agents[type] = created.id;
      }
      // Stable audience: every participant joins before any Run is accepted.
      for (const type of ["prompt", "script"] as const) {
        const started = await post("/runs", {
          chatId: chat.id,
          agentId: agents[type],
          requestId: crypto.randomUUID(),
          type,
          body: "finish",
        });
        await finish(started.id);
        oldRuns.push(started.id);
      }
    });
    const share = await post("/shares/preview", {
      selection: { type: "file", targetId: file.id, includeFile: true },
    });
    await ok(`/shares/${share.id}/publish`, { editToken: share.editToken });
    const legacyShare = await post("/shares/preview", {
      selection: { type: "file", targetId: file.id, includeFile: true },
    });
    await ok(`/shares/${legacyShare.id}/publish`, {
      editToken: legacyShare.editToken,
    });
    const legacySkill = await post("/skills", {
      title: "legacy-skill",
      instructions: "Older",
      whenToUse: "sometimes",
      visibility: "workspace",
    });
    await ok(
      `/skills/${legacySkill.id}/files`,
      {
        editToken: 0,
        files: [{ path: "references/older.txt", fileId: file.id }],
      },
      "PUT",
    );
    const scopes = async () =>
      (
        await database.pool.query(
          'select "agentId","executionScope" from environments where "agentId"=any($1) order by "agentId"',
          [Object.values(agents)],
        )
      ).rows;
    const originalScopes = await scopes();
    // The Skill's accepted file reference keeps its historical private key inside the retained scope.
    expect(
      originalScopes.some((s) => s.executionScope.includes("artifactId")),
    ).toBe(true);
    // Reconstruct the captured Resources-era state: names, discriminators and historical stored JSON forms only.
    await database.pool.query(`
      DO $$ DECLARE e record; BEGIN
        FOR e IN SELECT conname FROM pg_constraint WHERE conrelid='files'::regclass AND conname LIKE 'files\\_%' LOOP
          EXECUTE format('ALTER TABLE files RENAME CONSTRAINT %I TO %I',e.conname,'resources_'||substring(e.conname FROM 7)); END LOOP;
        FOR e IN SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='files' AND indexname LIKE 'files\\_%' LOOP
          EXECUTE format('ALTER INDEX %I RENAME TO %I',e.indexname,'resources_'||substring(e.indexname FROM 7)); END LOOP;
        FOR e IN SELECT c.conname,t.relname FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid WHERE t.relname IN ('documents','messages') AND c.conname LIKE '%\\_fileIds\\_%' LOOP
          EXECUTE format('ALTER TABLE %I RENAME CONSTRAINT %I TO %I',e.relname,e.conname,replace(e.conname,'fileIds','resourceIds')); END LOOP;
      END $$;
      ALTER TABLE files RENAME TO resources;
      ALTER TABLE documents RENAME COLUMN "fileIds" TO "resourceIds";
      ALTER TABLE messages RENAME COLUMN "fileIds" TO "resourceIds";
      UPDATE task_links SET type='resource' WHERE type='file';
      UPDATE skills SET "supportingFiles"=(SELECT jsonb_agg((f-'fileId')||jsonb_build_object('resourceId',f->'fileId')) FROM jsonb_array_elements("supportingFiles") f) WHERE jsonb_array_length("supportingFiles")>0;
      UPDATE skills SET "supportingFiles"=(SELECT jsonb_agg((f-'resourceId')||jsonb_build_object('artifactId',f->'resourceId')) FROM jsonb_array_elements("supportingFiles") f) WHERE id='${legacySkill.id}';
      UPDATE content_shares SET selection=jsonb_set(selection,'{type}','"resource"'),
        preview=(preview-'fileType')||jsonb_build_object('type','resource','resourceType',preview->'fileType'),
        snapshot=(snapshot-'fileType')||jsonb_build_object('type','resource','resourceType',snapshot->'fileType');
      UPDATE content_shares SET selection=jsonb_set(selection,'{type}','"artifact"'),
        preview=(preview-'resourceType')||jsonb_build_object('type','artifact','artifactType',preview->'resourceType'),
        snapshot=(snapshot-'resourceType')||jsonb_build_object('type','artifact','artifactType',snapshot->'resourceType') WHERE id='${legacyShare.id}';
    `);
    const names = async (db: typeof database) =>
      (
        await db.pool.query(`
          select 'constraint' as kind, t.relname||'.'||c.conname as name from pg_constraint c join pg_class t on t.oid=c.conrelid
            where c.connamespace='public'::regnamespace and t.relname in (${TABLES})
          union all select 'index', tablename||'.'||indexname from pg_indexes where schemaname='public' and tablename in (${TABLES})
          union all select 'column', table_name||'.'||column_name from information_schema.columns where table_schema='public' and table_name in (${TABLES}) and (column_name ilike '%file%' or column_name ilike '%resource%' or column_name ilike '%artifact%')
          order by 1,2`)
      ).rows;
    const proof = async () => ({
      runs: (
        await database.pool.query(
          'select id,inputs::text,"requestIdentity"::text,"requestId" from runs order by id',
        )
      ).rows,
      sessions: (
        await database.pool.query(
          'select id,scope,"contextRef","accountId" from agent_sessions order by id',
        )
      ).rows,
      scopes: await scopes(),
      shares: (
        await database.pool.query(
          'select id,selection::text,preview::text,snapshot::text,"editToken" from content_shares order by id',
        )
      ).rows,
      skills: (
        await database.pool.query(
          'select id,"supportingFiles"::text from skills order by id',
        )
      ).rows,
      jobs: (
        await database.pool.query(
          "select id,name,data::text from queue.job order by id",
        )
      ).rows,
    });
    const resourceRows = async () =>
      (
        await database.pool.query(
          'select id,"workspaceId",title,type,labels::text,"objectKey",sha256,"byteLength","mediaType",state,request::text,"requestId","ownerId","creatorAgentId","sourceRunId",visibility,archived from resources order by id',
        )
      ).rows;
    const before = await proof();
    const oldFiles = await resourceRows();
    const oldNames = await names(database);
    const sql = await Bun.file(
      new URL("../scripts/rename-files.sql", import.meta.url),
    ).text();
    const refuse = async (prep: string, undo: string, message: string) => {
      await database.pool.query(prep);
      await expect(database.pool.query(sql)).rejects.toThrow(message);
      await database.pool.query("ROLLBACK");
      await database.pool.query(undo);
      expect(await proof()).toEqual(before);
      expect(await names(database)).toEqual(oldNames);
    };
    await refuse(
      `update runs set state='queued' where id='${oldRuns[0]}'`,
      `update runs set state='finished' where id='${oldRuns[0]}'`,
      "Quiescent Runs",
    );
    await refuse(
      "create table files(id int)",
      "drop table files",
      "Expected only the old resources table",
    );
    await refuse(
      'alter table documents add column "fileIds" jsonb',
      'alter table documents drop column "fileIds"',
      "Unexpected attachment columns",
    );
    await refuse(
      `insert into task_links("taskId",type,reference) values('${task.id}','file','mixed')`,
      "delete from task_links where reference='mixed'",
      "Mixed Task-link discriminators",
    );
    await refuse(
      "alter table chats rename to conversations",
      "alter table conversations rename to chats",
      "Run the Resources and Chats renames first",
    );
    await database.pool.query(sql);
    expect(await names(database)).toEqual(await names(fresh));
    expect(await proof()).toEqual(before);
    expect(
      (
        await database.pool.query(
          'select id,"workspaceId",title,type,labels::text,"objectKey",sha256,"byteLength","mediaType",state,request::text,"requestId","ownerId","creatorAgentId","sourceRunId",visibility,archived from files order by id',
        )
      ).rows,
    ).toEqual(oldFiles);
    expect(
      (
        await database.pool.query(
          "select reference from task_links where type='file'",
        )
      ).rows,
    ).toEqual([{ reference: file.id }]);
    await expect(database.pool.query(sql)).rejects.toThrow(
      "Expected only the old resources table",
    );
    await database.pool.query("ROLLBACK");
    expect(await proof()).toEqual(before);
    // Retired surface and fields.
    expect((await request(`/files/${file.id}`)).status).toBe(200);
    for (const path of ["/resources", `/resources/${file.id}`])
      expect((await request(path)).status).toBe(404);
    expect(
      (
        await request(`/chats/${chat.id}/messages`, "POST", {
          requestId: crypto.randomUUID(),
          body: "x",
          resourceIds: [file.id],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(`/skills/${skill.id}/files`, "PUT", {
          editToken: 99,
          files: [{ path: "references/source.txt", resourceId: file.id }],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request("/shares/preview", "POST", {
          selection: { type: "resource", targetId: file.id, includeFile: true },
        })
      ).status,
    ).toBe(400);
    // Immutable upload retry: same file, one storage put; changed retries conflict.
    const putsBefore = puts;
    expect((await post("/files", upload)).id).toBe(file.id);
    expect(puts).toBe(putsBefore);
    expect(
      (await request("/files", "POST", { ...upload, title: "Changed" })).status,
    ).toBe(409);
    expect(
      (
        await request("/files", "POST", {
          ...upload,
          bytes: Buffer.from("other").toString("base64"),
        })
      ).status,
    ).toBe(409);
    // Attachments, links, stored historical Skill/share forms projected at their owning read boundaries.
    expect(
      (await (await request(`/documents/${doc.id}`)).json()).fileIds,
    ).toEqual([file.id]);
    const messages = z
      .array(z.object({ id: z.string(), fileIds: z.array(z.string()) }))
      .parse(await (await request(`/chats/${chat.id}/messages`)).json());
    expect(messages.find((m) => m.id === message.id)?.fileIds).toEqual([
      file.id,
    ]);
    for (const id of [skill.id, legacySkill.id]) {
      const exported = await (await request(`/skills/${id}/export`)).json();
      expect(exported.files[0]).toMatchObject({ fileId: file.id });
      expect(exported.files[0]).not.toHaveProperty("resourceId");
      expect(exported.files[0]).not.toHaveProperty("artifactId");
    }
    expect(
      new Uint8Array(
        await readRunSkillFile(database.db, storage, {
          workspaceId,
          sponsorId: userId,
          runId: oldRuns[0] ?? "",
          skillId: skill.id,
          path: "references/source.txt",
        }),
      ),
    ).toEqual(bytes);
    for (const id of [share.id, legacyShare.id]) {
      const frozen = await (await fetch(`${origin}/api/shares/${id}`)).json();
      expect(frozen).toMatchObject({ type: "file", fileType: "text" });
      expect(frozen).not.toHaveProperty("resourceType");
      expect(frozen).not.toHaveProperty("artifactType");
      expect(
        await (await fetch(`${origin}/api/shares/${id}/file`)).bytes(),
      ).toEqual(bytes);
    }
    expect(await proof()).toEqual(before);
    // NEW prompt and script Runs reuse the real retained scopes; a changed source set is still refused.
    expect(await scopes()).toEqual(originalScopes);
    await withRuntime(async () => {
      for (const type of ["prompt", "script"] as const) {
        const started = await post("/runs", {
          chatId: chat.id,
          agentId: agents[type],
          requestId: crypto.randomUUID(),
          type,
          body: "finish",
        });
        await finish(started.id);
      }
      const created = await post("/runs", {
        chatId: chat.id,
        agentId: agents.prompt,
        requestId: crypto.randomUUID(),
        type: "prompt",
        body: `_tool=${JSON.stringify({ name: "file.create", requestId: crypto.randomUUID(), title: "Agent result", type: "text", visibility: "workspace", mediaType: "text/plain", text: "saved agent output" })}`,
      });
      await finish(created.id);
      const agentFile = (
        await database.pool.query(
          `select "creatorAgentId","sourceRunId","ownerId" from files where title='Agent result'`,
        )
      ).rows[0];
      expect(agentFile).toEqual({
        creatorAgentId: agents.prompt,
        sourceRunId: created.id,
        ownerId: userId,
      });
      const changed = await post("/runs", {
        chatId: chat.id,
        agentId: agents.prompt,
        requestId: crypto.randomUUID(),
        type: "prompt",
        body: "finish",
        documentIds: [doc.id],
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
    expect(await scopes()).toEqual(originalScopes);
    // Native push after the rename keeps the data and constraint/index definitions of a fresh push.
    const definitions = async (db: typeof database) =>
      (
        await db.pool.query(`
          select 'c' k, conrelid::regclass::text||'.'||conname||' '||pg_get_constraintdef(oid) d from pg_constraint where connamespace='public'::regnamespace
          union all select 'i', indexdef from pg_indexes where schemaname='public' order by 1,2`)
      ).rows;
    const beforePush = await proof();
    const defsBefore = await definitions(database);
    const uri = `postgresql://otto_test@localhost/postgres?host=${encodeURIComponent(database.directory)}`;
    await pushDatabase(uri);
    await pushDatabase(uri);
    expect(await proof()).toEqual(beforePush);
    expect(await definitions(database)).toEqual(defsBefore);
    expect(await definitions(database)).toEqual(await definitions(fresh));
    expect(await names(database)).toEqual(await names(fresh));
  } finally {
    await server.stop(true);
    await boss.stop();
    await fresh.stop();
    await database.stop();
  }
}, 120000);
