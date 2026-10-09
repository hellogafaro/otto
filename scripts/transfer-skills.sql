-- Explicit pre-MVP offline transfer from the reviewed skill-as-Document schema.
-- Stop Otto first, inspect/backup the database, then execute with ON_ERROR_STOP.
-- Not invoked by startup or db:push. Ambiguous ordinary Document links refuse transfer.
BEGIN;
LOCK TABLE documents, document_proposals, agent_skills, runs, agent_sessions,
  environments, collections, content_shares, task_links IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
  IF to_regclass('public.skills') IS NOT NULL OR to_regclass('public.skill_proposals') IS NOT NULL THEN
    RAISE EXCEPTION 'Skills tables already exist; inspect transfer state';
  END IF;
  IF EXISTS (SELECT 1 FROM runs WHERE state IN ('queued','launching','running','uncertain'))
     OR EXISTS (SELECT 1 FROM environments WHERE "activeRunId" IS NOT NULL) THEN
    RAISE EXCEPTION 'Quiescent Runs and confirmed released leases required';
  END IF;
  IF EXISTS (SELECT 1 FROM documents WHERE NOT skill AND ("skillMetadata" <> '{}'::jsonb OR "supportingFiles" <> '[]'::jsonb OR "whenToUse" IS NOT NULL)) THEN
    RAISE EXCEPTION 'Ordinary Document has skill data; operator disposition required';
  END IF;
  IF EXISTS (SELECT 1 FROM documents WHERE skill AND
    ("collectionId" IS NOT NULL OR properties <> '{}'::jsonb OR "resourceIds" <> '[]'::jsonb)) THEN
    RAISE EXCEPTION 'Skill has ordinary Document data; operator disposition required';
  END IF;
  IF EXISTS (SELECT 1 FROM content_shares s JOIN documents d ON lower(s.selection->>'targetId')=d.id::text
    WHERE d.skill AND s.selection->>'type'='document')
    OR EXISTS (SELECT 1 FROM task_links l JOIN documents d ON lower(l.reference)=d.id::text
      WHERE d.skill AND l.type='document')
    OR EXISTS (SELECT 1 FROM runs r JOIN documents d ON d.skill
      WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(r.inputs->'context'->'documents','[]'::jsonb)) v WHERE lower(v->>'id')=d.id::text))
    OR EXISTS (SELECT 1 FROM environments e JOIN documents d ON d.skill
      WHERE e."executionScope" IS NOT NULL AND
        EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(e."executionScope"::jsonb->'sources'->'documentIds','[]'::jsonb)) source(id)
          WHERE lower(source.id)=d.id::text))
    OR EXISTS (SELECT 1 FROM documents source JOIN documents d ON d.skill
      WHERE EXISTS (SELECT 1 FROM jsonb_each_text(source.properties) p WHERE lower(p.value)=d.id::text)) THEN
    RAISE EXCEPTION 'Skill also referenced as ordinary Document; operator disposition required';
  END IF;
END $$;
CREATE TABLE skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "workspaceId" uuid NOT NULL,
  "createdAt" timestamptz, "updatedAt" timestamptz, archived boolean NOT NULL DEFAULT false,
  "projectId" uuid, title text NOT NULL, instructions text NOT NULL, "createdBy" text NOT NULL,
  visibility text NOT NULL DEFAULT 'user', metadata jsonb NOT NULL DEFAULT '{}',
  "whenToUse" text, "editToken" integer NOT NULL DEFAULT 0, "supportingFiles" jsonb NOT NULL DEFAULT '[]',
  CONSTRAINT skills_visibility CHECK (visibility IN ('user','workspace')),
  CONSTRAINT skills_workspace_fk FOREIGN KEY ("workspaceId") REFERENCES workspaces(id),
  CONSTRAINT "skills_projectId_workspace_fk" FOREIGN KEY ("projectId","workspaceId") REFERENCES projects(id,"workspaceId"),
  CONSTRAINT "skills_createdBy_fk" FOREIGN KEY ("createdBy") REFERENCES auth_users(id),
  CONSTRAINT skills_identity_workspace UNIQUE (id,"workspaceId")
);
CREATE TABLE skill_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "skillId" uuid NOT NULL REFERENCES skills(id),
  "proposerId" text NOT NULL REFERENCES auth_users(id), "agentId" uuid,
  title text NOT NULL, instructions text NOT NULL, "editToken" integer NOT NULL
);
INSERT INTO skills SELECT id,"workspaceId","createdAt","updatedAt",archived,"projectId",title,body,"createdBy",
  visibility,"skillMetadata","whenToUse","editToken","supportingFiles" FROM documents WHERE skill;
INSERT INTO skill_proposals SELECT p.id,p."documentId",p."proposerId",p."agentId",p.title,p.body,p."editToken"
  FROM document_proposals p JOIN documents d ON d.id=p."documentId" WHERE d.skill;
-- Accepted Run JSON, Session bindings and retained scope strings are deliberately untouched.
ALTER TABLE agent_skills DROP CONSTRAINT agent_skills_document_workspace_fk;
ALTER TABLE agent_skills ADD CONSTRAINT agents_skills_skill_workspace_fk
  FOREIGN KEY ("skillId","workspaceId") REFERENCES skills(id,"workspaceId");
ALTER TABLE agent_skills RENAME CONSTRAINT agent_skills_agent_workspace_fk TO agents_skills_agent_workspace_fk;
ALTER TABLE agent_skills RENAME CONSTRAINT "agent_skills_agentId_skillId_pk" TO "agents_skills_agentId_skillId_pk";
ALTER TABLE agent_skills RENAME TO agents_skills;
DELETE FROM document_proposals p USING documents d WHERE d.skill AND p."documentId"=d.id;
DELETE FROM documents WHERE skill;
ALTER TABLE documents DROP COLUMN skill, DROP COLUMN "skillMetadata", DROP COLUMN "whenToUse", DROP COLUMN "supportingFiles";
COMMIT;
