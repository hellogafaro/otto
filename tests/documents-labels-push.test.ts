import { expect, it } from "vitest";
import { startQueue } from "../apps/server/src/queue";
import { pushDatabase } from "../scripts/push";
import { startPostgres } from "./postgres";

/** The one schema change of the lists work: an additive Document `labels` column through native push. */
it("adds Document labels by native push: old rows read [], every other byte, definition and queue object is unchanged", async () => {
  const old = await startPostgres();
  const fresh = await startPostgres();
  const boss = await startQueue(old.db, old.pool, {
    workers: false,
    install: true,
  });
  const uri = (database: typeof old) =>
    `postgresql://otto_test@localhost/postgres?host=${encodeURIComponent(database.directory)}`;
  try {
    // A populated database from before labels: the column does not exist yet.
    await old.pool.query("alter table documents drop column labels");
    expect(
      (
        await old.pool.query(
          `select 1 from information_schema.columns where table_name='documents' and column_name='labels'`,
        )
      ).rowCount,
    ).toBe(0);
    await old.pool.query(
      "insert into auth_users(id,name,email) values('labels-owner','Owner','labels@example.test')",
    );
    const workspaceId = crypto.randomUUID();
    await old.pool.query(
      "insert into workspaces(id,name,cursor) values($1,'Legacy',7)",
      [workspaceId],
    );
    await old.pool.query(
      "insert into workspace_members(\"workspaceId\",\"userId\",role) values($1,'labels-owner','owner')",
      [workspaceId],
    );
    const ids = [crypto.randomUUID(), crypto.randomUUID()];
    for (const [i, id] of ids.entries())
      await old.pool.query(
        `insert into documents(id,"workspaceId",title,body,"createdBy",visibility,"editToken","fileIds",properties)
         values($1,$2,$3,'body','labels-owner','workspace',$4,'[]','{"k":"v"}')`,
        [id, workspaceId, `Legacy ${i}`, i + 3],
      );
    const snapshot = async (database: typeof old) => ({
      documents: (
        await database.pool.query(
          `select (row_to_json(d)::jsonb - 'labels')::text as row from documents d order by id`,
        )
      ).rows,
      workspaces: (
        await database.pool.query(
          "select row_to_json(w)::text as row from workspaces w order by id",
        )
      ).rows,
      members: (
        await database.pool.query(
          `select row_to_json(m)::text as row from workspace_members m order by 1`,
        )
      ).rows,
      queue: (
        await database.pool.query(
          `select (select count(*)::int from queue.job) as jobs, (select array_agg(name order by name) from queue.queue) as queues,
            (select array_agg(tablename order by tablename) from pg_tables where schemaname='queue') as tables`,
        )
      ).rows,
    });
    const columns = async (database: typeof old) =>
      (
        await database.pool.query(
          `select column_name, data_type, is_nullable, column_default from information_schema.columns where table_name='documents' order by column_name`,
        )
      ).rows;
    const definitions = async (database: typeof old) =>
      (
        await database.pool.query(`
          select 'c' k, conrelid::regclass::text||'.'||conname||' '||pg_get_constraintdef(oid) d from pg_constraint where connamespace='public'::regnamespace
          union all select 'i', indexdef from pg_indexes where schemaname='public' order by 1,2`)
      ).rows;
    const before = await snapshot(old);
    expect(before.documents).toHaveLength(2);
    const first = await pushDatabase(uri(old));
    // Native push restores the declared column without any destructive approval.
    expect(first.changed).toBe(true);
    await pushDatabase(uri(old));
    expect(await snapshot(old)).toEqual(before);
    expect(
      (
        await old.pool.query(
          `select labels::text as labels from documents order by id`,
        )
      ).rows.map((row) => row.labels),
    ).toEqual(["[]", "[]"]);
    expect(await columns(old)).toEqual(await columns(fresh));
    expect(await definitions(old)).toEqual(await definitions(fresh));
    expect(
      (await columns(fresh)).find((column) => column.column_name === "labels"),
    ).toMatchObject({
      is_nullable: "NO",
      column_default: "'[]'::jsonb",
      data_type: "jsonb",
    });
  } finally {
    await boss.stop();
    await old.stop();
    await fresh.stop();
  }
}, 180000);
