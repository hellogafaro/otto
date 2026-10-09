import { expect, it } from "vitest";
import { startQueue } from "../apps/server/src/queue";
import { createAgent } from "../packages/agents/src";
import { createProject, upsertProjectMember } from "../packages/projects/src";
import { createTask, getTask } from "../packages/tasks/src";
import { claimInstallation, inWorkspace } from "../packages/workspaces/src";
import { members, users } from "../packages/workspaces/src/schema";
import { pushDatabase } from "../scripts/push";
import { controlledSubscription } from "./fixtures/native-model";
import { startPostgres } from "./postgres";

it("explicit offline move copies single assignments into the junctions exactly, drops the old columns and refuses a repeat", async () => {
  const database = await startPostgres();
  const boss = await startQueue(database.db, database.pool, {
    workers: false,
    install: true,
  });
  try {
    await database.db.insert(users).values(
      ["owner", "member"].map((id) => ({
        id,
        name: id,
        email: `${id}@example.test`,
        emailVerified: true,
      })),
    );
    const workspaceId = (await claimInstallation(database.db, "owner", "Move"))
      .id;
    await database.db
      .insert(members)
      .values({ workspaceId, userId: "member", role: "contributor" });
    const scope = <T>(work: Parameters<typeof inWorkspace<T>>[3]) =>
      inWorkspace(database.db, workspaceId, { userId: "owner" }, work);
    const { humanId, agentTaskId, plainId } = await scope(async (c) => {
      const project = await createProject(c, { title: "Project" });
      await upsertProjectMember(c, project.id, "member", "contributor");
      const agent = await createAgent(c, {
        title: "Worker",
        instructions: "Work",
        model: "selected",
        subscriptionId: await controlledSubscription(c),
        visibility: "workspace",
      });
      const human = await createTask(c, {
        projectId: project.id,
        title: "Human",
        assigneeUserIds: ["member"],
      });
      const byAgent = await createTask(c, {
        projectId: project.id,
        title: "Agent",
        assigneeAgentIds: [agent.id],
      });
      const plain = await createTask(c, {
        projectId: project.id,
        title: "Plain",
      });
      return {
        humanId: human.id,
        agentTaskId: byAgent.id,
        plainId: plain.id,
        agentId: agent.id,
      };
    });
    const definitions = async () =>
      (
        await database.pool.query(`
          select 'column' kind, table_name || '.' || column_name || ':' || data_type || ':' || is_nullable as def
            from information_schema.columns where table_name in ('tasks_users','tasks_agents')
          union all select 'index', indexdef from pg_indexes where tablename in ('tasks_users','tasks_agents')
          union all select 'constraint', conrelid::regclass || ' ' || conname || ' ' || pg_get_constraintdef(oid)
            from pg_constraint where conrelid in ('tasks_users'::regclass,'tasks_agents'::regclass)
          order by 1,2`)
      ).rows;
    const taskRows = async () =>
      (
        await database.pool.query(
          `select row_to_json(t)::jsonb - 'assigneeUserId' - 'assigneeAgentId' as row from tasks t order by id`,
        )
      ).rows;
    const junctions = async () =>
      (
        await database.pool.query(
          `select 'u' k, "taskId", "userId" v from tasks_users union all select 'a', "taskId", "agentId"::text from tasks_agents order by 1,2`,
        )
      ).rows;
    const expectedDefinitions = await definitions();
    const expectedJunctions = await junctions();
    const expectedTasks = await taskRows();
    expect(expectedJunctions).toHaveLength(2);
    // Reconstruct only the captured single-assignee storage shape on this disposable DB.
    await database.pool.query(`
      alter table tasks add column "assigneeUserId" text, add column "assigneeAgentId" uuid;
      update tasks t set "assigneeUserId"=u."userId" from tasks_users u where u."taskId"=t.id;
      update tasks t set "assigneeAgentId"=a."agentId" from tasks_agents a where a."taskId"=t.id;
      alter table tasks add constraint "tasks_assigneeAgentId_workspace_fk" foreign key ("assigneeAgentId","workspaceId") references agents(id,"workspaceId");
      alter table tasks add constraint "tasks_assigneeUserId_fk" foreign key ("assigneeUserId") references auth_users(id);
      alter table tasks add constraint tasks_one_assignee check ("assigneeUserId" is null or "assigneeAgentId" is null);
      drop table tasks_users; drop table tasks_agents;
    `);
    const sql = await Bun.file(
      new URL("../scripts/move-task-assignees.sql", import.meta.url),
    ).text();
    const client = await database.pool.connect();
    try {
      await client.query(sql);
      expect(await junctions()).toEqual(expectedJunctions);
      expect(await definitions()).toEqual(expectedDefinitions);
      expect(await taskRows()).toEqual(expectedTasks);
      expect(
        (
          await client.query(
            `select column_name from information_schema.columns where table_name='tasks' and column_name like 'assignee%'`,
          )
        ).rowCount,
      ).toBe(0);
      // A repeat or partial state refuses before changing anything.
      await expect(client.query(sql)).rejects.toThrow(
        "Task assignee tables already exist",
      );
      await client.query("rollback");
      expect(await junctions()).toEqual(expectedJunctions);
    } finally {
      client.release();
    }
    const url = `postgresql://otto_test@localhost/postgres?host=${encodeURIComponent(database.directory)}`;
    await pushDatabase(url);
    await pushDatabase(url);
    expect(await definitions()).toEqual(expectedDefinitions);
    expect(await junctions()).toEqual(expectedJunctions);
    const read = await scope((c) => getTask(c, humanId));
    expect(read.assigneeUserIds).toEqual(["member"]);
    expect(
      (await scope((c) => getTask(c, agentTaskId))).assigneeAgentIds,
    ).toHaveLength(1);
    expect((await scope((c) => getTask(c, plainId))).assigneeUserIds).toEqual(
      [],
    );
  } finally {
    await boss.stop();
    await database.stop();
  }
});
