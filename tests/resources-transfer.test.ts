import { expect, it } from "vitest";
import { createApp } from "../apps/server/src/app";
import { createAuth } from "../apps/server/src/auth";
import { startQueue } from "../apps/server/src/queue";
import { readRunSkillFile } from "../apps/server/src/skill-files";
import { createFile, readFile } from "../packages/files/src";
import { claimInstallation } from "../packages/workspaces/src";
import { pushDatabase } from "../scripts/push";
import { pi } from "./fixtures/pi";
import { fixtureStorage, testSpool } from "./fixtures/storage";
import { startPostgres } from "./postgres";

const transfers = await testSpool();

it("offline Artifact→Resource→File rename sequence preserves populated file/retry/reference/share and accepted scope bytes through real HTTP/PG", async () => {
  const database = await startPostgres();
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
      if (!bytes) throw new Error("Missing controlled bytes");
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
      storage,
      spool: transfers.spool,
      pi,
    });
    const signup = await fetch(`${origin}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({
        name: "Resource Owner",
        email: "resource-transfer@example.test",
        password: crypto.randomUUID() + crypto.randomUUID(),
      }),
    });
    expect(signup.status).toBe(200);
    const cookie = signup.headers.get("set-cookie") ?? "";
    const session = await auth.api.getSession({
      headers: new Headers({ cookie }),
    });
    if (!session) throw new Error("Missing authenticated fixture");
    const owner = session.user.id;
    const workspaceId = (
      await claimInstallation(database.db, owner, "Resources")
    ).id;
    const request = (path: string, method = "GET", body?: unknown) =>
      fetch(`${origin}/api/workspaces/${workspaceId}${path}`, {
        method,
        headers: { cookie, origin, "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    const saved = async (
      response: Response,
    ): Promise<{ id: string; editToken: number }> => {
      expect(response.status, await response.clone().text()).toBe(200);
      const body = await response.json();
      // Actual endpoint shapes are inspected below; this fixture extracts only identity/fence.
      return body;
    };
    const input = {
      requestId: crypto.randomUUID(),
      title: "Exact original file",
      type: "text",
      visibility: "workspace" as const,
      mediaType: "text/plain",
    };
    const bytes = new TextEncoder().encode("immutable supporting bytes");
    const file = await createFile(
      database.db,
      storage,
      workspaceId,
      { userId: owner },
      input,
      bytes,
    );
    const skill = await saved(
      await request("/skills", "POST", {
        title: "resource-source",
        instructions: "Read references/source.txt",
        whenToUse: "Read exact source bytes",
        visibility: "workspace",
      }),
    );
    expect(
      (
        await request(`/skills/${skill.id}/files`, "PUT", {
          editToken: 0,
          files: [{ path: "references/source.txt", fileId: file.id }],
        })
      ).status,
    ).toBe(200);
    const project = await saved(
      await request("/projects", "POST", { title: "Project" }),
    );
    const task = await saved(
      await request("/tasks", "POST", { title: "Task", projectId: project.id }),
    );
    await saved(
      await request("/timesheets", "POST", {
        taskId: task.id,
        duration: 15,
        notes: "Manual work",
      }),
    );
    expect(
      (
        await request(`/tasks/${task.id}/links`, "POST", {
          type: "file",
          reference: file.id,
        })
      ).status,
    ).toBe(200);
    const chat = await saved(
      await request("/chats", "POST", {
        title: "Output",
        visibility: "workspace",
      }),
    );
    const message = await saved(
      await request(`/chats/${chat.id}/messages`, "POST", {
        requestId: crypto.randomUUID(),
        body: "Saved reference",
        fileIds: [file.id],
      }),
    );
    const doc = await saved(
      await request("/documents", "POST", {
        title: "Document",
        body: "Source",
        visibility: "workspace",
      }),
    );
    expect(
      (
        await request(`/documents/${doc.id}/attachments`, "PUT", {
          editToken: 0,
          fileIds: [file.id],
        })
      ).status,
    ).toBe(200);
    const agentResponse = await request("/agents", "POST", {
      title: "Worker",
      instructions: "Work",
      model: "none",
      visibility: "workspace",
      skillIds: [skill.id],
    });
    expect(agentResponse.status).toBe(200);
    const agent = (await agentResponse.json()).agent;
    expect(
      (
        await request(`/chats/${chat.id}/participants`, "POST", {
          agentId: agent.id,
          role: "contributor",
        })
      ).status,
    ).toBe(200);
    const run = await saved(
      await request("/runs", "POST", {
        chatId: chat.id,
        agentId: agent.id,
        type: "script",
        body: "No process in transfer fixture",
        requestId: crypto.randomUUID(),
      }),
    );
    const share = await saved(
      await request("/shares/preview", "POST", {
        selection: { type: "file", targetId: file.id, includeFile: true },
      }),
    );
    expect(
      (
        await request(`/shares/${share.id}/publish`, "POST", {
          editToken: share.editToken,
        })
      ).status,
    ).toBe(200);
    const privateScope = JSON.stringify({
      sources: {
        skills: [
          {
            documentId: skill.id,
            files: [
              {
                path: "references/source.txt",
                artifactId: file.id,
                sha256: new Bun.CryptoHasher("sha256")
                  .update(bytes)
                  .digest("hex"),
                byteLength: bytes.length,
              },
            ],
          },
        ],
      },
    });
    await database.pool.query(
      'update environments set "executionScope"=$1 where "agentId"=$2',
      [privateScope, agent.id],
    );
    // Reconstruct the oldest physical names/JSON (Artifacts) on this same disposable populated database.
    await database.pool.query(`
      DO $$ DECLARE e record; BEGIN
        FOR e IN SELECT conname FROM pg_constraint WHERE conrelid='files'::regclass AND conname LIKE 'files_%' LOOP
          EXECUTE format('ALTER TABLE files RENAME CONSTRAINT %I TO %I',e.conname,'artifacts_'||substring(e.conname FROM 7)); END LOOP;
        FOR e IN SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='files' AND indexname LIKE 'files_%' LOOP
          EXECUTE format('ALTER INDEX %I RENAME TO %I',e.indexname,'artifacts_'||substring(e.indexname FROM 7)); END LOOP;
      END $$;
      ALTER TABLE files RENAME TO artifacts;
      ALTER TABLE documents RENAME COLUMN "fileIds" TO "artifactIds";
      ALTER TABLE messages RENAME COLUMN "fileIds" TO "artifactIds";
      UPDATE task_links SET type='artifact' WHERE type='file';
      UPDATE skills SET "supportingFiles"=(SELECT jsonb_agg((f-'fileId')||jsonb_build_object('artifactId',f->'fileId')) FROM jsonb_array_elements("supportingFiles") f) WHERE jsonb_array_length("supportingFiles")>0;
      UPDATE content_shares SET selection=jsonb_set(selection,'{type}','"artifact"'),
        preview=(preview-'fileType')||jsonb_build_object('type','artifact','artifactType',preview->'fileType'),
        snapshot=(snapshot-'fileType')||jsonb_build_object('type','artifact','artifactType',snapshot->'fileType') WHERE selection->>'type'='file';
    `);
    const evidence = async () => ({
      runs: (
        await database.pool.query(
          'select inputs::text,"requestIdentity"::text from runs order by id',
        )
      ).rows,
      sessions: (
        await database.pool.query(
          "select row_to_json(s)::text from agent_sessions s order by id",
        )
      ).rows,
      environments: (
        await database.pool.query(
          'select "executionScope" from environments order by id',
        )
      ).rows,
      shares: (
        await database.pool.query(
          "select selection::text,preview::text,snapshot::text from content_shares order by id",
        )
      ).rows,
      skills: (
        await database.pool.query(
          'select "supportingFiles"::text from skills order by id',
        )
      ).rows,
      queue: (
        await database.pool.query(
          "select id,name,data::text from queue.job order by id",
        )
      ).rows,
      time: (
        await database.pool.query(
          "select row_to_json(t)::text from timesheets t order by id",
        )
      ).rows,
    });
    const before = await evidence();
    const sql = await Bun.file(
      new URL("../scripts/rename-resources.sql", import.meta.url),
    ).text();
    const filesSql = await Bun.file(
      new URL("../scripts/rename-files.sql", import.meta.url),
    ).text();
    await expect(database.pool.query(sql)).rejects.toThrow("Quiescent Runs");
    await database.pool.query("ROLLBACK");
    expect(await evidence()).toEqual(before);
    expect(
      (
        await database.pool.query(
          "select to_regclass('artifacts') as old,to_regclass('resources') as current",
        )
      ).rows[0],
    ).toEqual({ old: "artifacts", current: null });
    expect((await request(`/runs/${run.id}/stop`, "POST", {})).status).toBe(
      200,
    );
    const quiescent = await evidence();
    const intent = (
      await database.pool.query(
        "select row_to_json(a)::text as value from artifacts a",
      )
    ).rows;
    await database.pool.query(sql);
    expect(await evidence()).toEqual(quiescent);
    expect(
      (
        await database.pool.query(
          "select row_to_json(a)::text as value from resources a",
        )
      ).rows,
    ).toEqual(intent);
    // The Files rename follows the Resources rename in the documented order and is also atomic and byte-preserving.
    await database.pool.query(filesSql);
    expect(await evidence()).toEqual(quiescent);
    expect(
      (
        await database.pool.query(
          "select row_to_json(a)::text as value from files a",
        )
      ).rows,
    ).toEqual(intent);
    expect(
      (await database.pool.query("select to_regclass('artifacts') as old"))
        .rows[0]?.old,
    ).toBeNull();
    expect((await request(`/files/${file.id}`)).status).toBe(200);
    expect((await request(`/resources/${file.id}`)).status).toBe(404);
    expect(
      (
        await request("/shares/preview", "POST", {
          selection: { type: "resource", targetId: file.id, includeFile: true },
        })
      ).status,
    ).toBe(400);
    expect((await request(`/artifacts/${file.id}`)).status).toBe(404);
    expect((await request(`/assets/${file.id}`)).status).toBe(404);
    expect(
      (
        await request("/shares/preview", "POST", {
          selection: { type: "artifact", targetId: file.id, includeFile: true },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(`/skills/${skill.id}/files`, "PUT", {
          editToken: 1,
          files: [{ path: "references/source.txt", artifactId: file.id }],
        })
      ).status,
    ).toBe(400);
    expect(await (await request(`/files/${file.id}/file`)).bytes()).toEqual(
      bytes,
    );
    expect(
      (
        await createFile(
          database.db,
          storage,
          workspaceId,
          { userId: owner },
          input,
          bytes,
        )
      ).id,
    ).toBe(file.id);
    expect(puts).toBe(1);
    await expect(
      createFile(
        database.db,
        storage,
        workspaceId,
        { userId: owner },
        { ...input, title: "Changed retry" },
        bytes,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    const document = await (await request(`/documents/${doc.id}`)).json();
    expect(document.fileIds).toEqual([file.id]);
    expect(document).not.toHaveProperty("resourceIds");
    expect(document).not.toHaveProperty("artifactIds");
    const messages = await (await request(`/chats/${chat.id}/messages`)).json();
    expect(
      messages.find((item: { id: string }) => item.id === message.id)?.fileIds,
    ).toEqual([file.id]);
    const links = await (await request(`/tasks/${task.id}/links`)).json();
    expect(
      links.items.find(
        (item: { reference: string }) => item.reference === file.id,
      )?.type,
    ).toBe("file");
    const skillOutput = await (
      await request(`/skills/${skill.id}/export`)
    ).json();
    expect(skillOutput.files[0].fileId).toBe(file.id);
    expect(skillOutput.files[0]).not.toHaveProperty("resourceId");
    expect(skillOutput.files[0]).not.toHaveProperty("artifactId");
    expect(
      await readRunSkillFile(database.db, storage, {
        workspaceId,
        sponsorId: owner,
        runId: run.id,
        skillId: skill.id,
        path: "references/source.txt",
      }),
    ).toEqual(bytes);
    const publicContent = await (
      await fetch(`${origin}/api/shares/${share.id}`)
    ).json();
    expect(publicContent).toMatchObject({
      type: "file",
      fileType: "text",
    });
    expect(publicContent).not.toHaveProperty("artifactType");
    expect(publicContent).not.toHaveProperty("resourceType");
    expect(
      await (await fetch(`${origin}/api/shares/${share.id}/file`)).bytes(),
    ).toEqual(bytes);
    expect(await evidence()).toEqual(quiescent);
    await database.pool.query(
      `UPDATE skills SET "supportingFiles"=(SELECT jsonb_agg(f||jsonb_build_object('fileId',f->'artifactId')) FROM jsonb_array_elements("supportingFiles") f) WHERE id=$1`,
      [skill.id],
    );
    expect((await request(`/skills/${skill.id}`)).status).toBe(409);
    await database.pool.query(
      `UPDATE skills SET "supportingFiles"=(SELECT jsonb_agg(f-'fileId') FROM jsonb_array_elements("supportingFiles") f) WHERE id=$1`,
      [skill.id],
    );
    expect(await evidence()).toEqual(quiescent);
    await pushDatabase(
      `postgresql://otto_test@localhost/postgres?host=${encodeURIComponent(database.directory)}`,
    );
    expect(await evidence()).toEqual(quiescent);
    await expect(database.pool.query(sql)).rejects.toThrow(
      "Expected only the old artifacts table",
    );
    await database.pool.query("ROLLBACK");
    await expect(database.pool.query(filesSql)).rejects.toThrow(
      "Expected only the old resources table",
    );
    await database.pool.query("ROLLBACK");
    expect(
      (await request(`/shares/${share.id}/revoke`, "POST", {})).status,
    ).toBe(200);
    expect((await fetch(`${origin}/api/shares/${share.id}`)).status).toBe(404);
    expect(
      await readFile(
        database.db,
        storage,
        workspaceId,
        { userId: owner },
        file.id,
      ),
    ).toEqual(bytes);
  } finally {
    await server.stop(true);
    await boss.stop();
    await database.stop();
  }
}, 60000);
