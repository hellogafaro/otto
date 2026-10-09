-- Explicit pre-MVP offline move from one nullable Task assignee per kind to multiple assignee junctions.
-- Stop Otto first, inspect/back up the database, then execute with ON_ERROR_STOP.
-- Not invoked by startup or db:push. Existing assignments are copied exactly; IDs, owners, tokens, Timesheets and Runs are untouched.
BEGIN;
LOCK TABLE tasks IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
  IF to_regclass('public.tasks_users') IS NOT NULL OR to_regclass('public.tasks_agents') IS NOT NULL THEN
    RAISE EXCEPTION 'Task assignee tables already exist; inspect transfer state';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='tasks'
      AND column_name IN ('assigneeUserId','assigneeAgentId')) <> 2 THEN
    RAISE EXCEPTION 'Single-assignee Task columns not found; inspect schema state';
  END IF;
END $$;
CREATE TABLE tasks_users (
  "workspaceId" uuid NOT NULL, "taskId" uuid NOT NULL, "userId" text NOT NULL,
  CONSTRAINT "tasks_users_taskId_userId_pk" PRIMARY KEY ("taskId","userId"),
  CONSTRAINT tasks_users_task_workspace_fk FOREIGN KEY ("taskId","workspaceId") REFERENCES tasks(id,"workspaceId"),
  CONSTRAINT tasks_users_user_fk FOREIGN KEY ("userId") REFERENCES auth_users(id)
);
CREATE INDEX tasks_users_user_idx ON tasks_users ("userId","taskId");
CREATE TABLE tasks_agents (
  "workspaceId" uuid NOT NULL, "taskId" uuid NOT NULL, "agentId" uuid NOT NULL,
  CONSTRAINT "tasks_agents_taskId_agentId_pk" PRIMARY KEY ("taskId","agentId"),
  CONSTRAINT tasks_agents_task_workspace_fk FOREIGN KEY ("taskId","workspaceId") REFERENCES tasks(id,"workspaceId"),
  CONSTRAINT tasks_agents_agent_workspace_fk FOREIGN KEY ("agentId","workspaceId") REFERENCES agents(id,"workspaceId")
);
CREATE INDEX tasks_agents_agent_idx ON tasks_agents ("agentId","taskId");
INSERT INTO tasks_users ("workspaceId","taskId","userId")
  SELECT "workspaceId", id, "assigneeUserId" FROM tasks WHERE "assigneeUserId" IS NOT NULL;
INSERT INTO tasks_agents ("workspaceId","taskId","agentId")
  SELECT "workspaceId", id, "assigneeAgentId" FROM tasks WHERE "assigneeAgentId" IS NOT NULL;
ALTER TABLE tasks DROP CONSTRAINT tasks_one_assignee,
  DROP CONSTRAINT "tasks_assigneeAgentId_workspace_fk",
  DROP CONSTRAINT "tasks_assigneeUserId_fk";
ALTER TABLE tasks DROP COLUMN "assigneeUserId", DROP COLUMN "assigneeAgentId";
COMMIT;
