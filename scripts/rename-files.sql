-- Explicit pre-MVP offline metadata rename, never invoked by startup/db:push.
-- Stop Otto, inspect/back up the database, then run with ON_ERROR_STOP after the Resources, Schedules and Chats renames.
-- Object keys, bytes, upload request JSON, accepted Run/Skill/Session/share JSON and native queue tables are deliberately untouched.
BEGIN;
DO $$
BEGIN
  IF to_regclass('public.resources') IS NULL OR to_regclass('public.files') IS NOT NULL THEN
    RAISE EXCEPTION 'Expected only the old resources table; inspect rename state';
  END IF;
  IF to_regclass('public.chats') IS NULL OR to_regclass('public.conversations') IS NOT NULL
     OR to_regclass('public.artifacts') IS NOT NULL THEN
    RAISE EXCEPTION 'Run the Resources and Chats renames first; inspect rename state';
  END IF;
END $$;
LOCK TABLE resources, documents, messages, task_links, runs, agent_sessions,
  environments, skills, content_shares IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM runs WHERE state IN ('queued','launching','running','uncertain'))
     OR EXISTS (SELECT 1 FROM environments WHERE "activeRunId" IS NOT NULL) THEN
    RAISE EXCEPTION 'Quiescent Runs and confirmed released leases required';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
      AND table_name IN ('documents','messages') AND column_name='fileIds')
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema='public'
      AND table_name IN ('documents','messages') AND column_name='resourceIds') <> 2 THEN
    RAISE EXCEPTION 'Unexpected attachment columns; operator disposition required';
  END IF;
  IF EXISTS (SELECT 1 FROM task_links WHERE type IN ('file','artifact')) THEN
    RAISE EXCEPTION 'Mixed Task-link discriminators; operator disposition required';
  END IF;
END $$;
ALTER TABLE resources RENAME TO files;
-- Constraint-backed indexes rename with their constraint; remaining indexes are renamed once.
DO $$
DECLARE entry record;
BEGIN
  FOR entry IN SELECT conname FROM pg_constraint WHERE conrelid='public.files'::regclass
    AND conname LIKE 'resources\_%' LOOP
    EXECUTE format('ALTER TABLE files RENAME CONSTRAINT %I TO %I', entry.conname,
      'files_' || substring(entry.conname FROM 11));
  END LOOP;
  FOR entry IN SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='files'
    AND indexname LIKE 'resources\_%' LOOP
    EXECUTE format('ALTER INDEX %I RENAME TO %I', entry.indexname,
      'files_' || substring(entry.indexname FROM 11));
  END LOOP;
END $$;
ALTER TABLE documents RENAME COLUMN "resourceIds" TO "fileIds";
ALTER TABLE messages RENAME COLUMN "resourceIds" TO "fileIds";
-- PostgreSQL 18 names NOT NULL constraints after the column; keep them equal to a fresh push.
DO $$
DECLARE entry record;
BEGIN
  FOR entry IN SELECT c.conname, t.relname FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
    WHERE t.relnamespace='public'::regnamespace AND t.relname IN ('documents','messages')
      AND (c.conname LIKE '%\_resourceIds\_%' OR c.conname LIKE '%\_artifactIds\_%') LOOP
    EXECUTE format('ALTER TABLE %I RENAME CONSTRAINT %I TO %I', entry.relname, entry.conname,
      regexp_replace(entry.conname, '(resourceIds|artifactIds)', 'fileIds'));
  END LOOP;
END $$;
UPDATE task_links SET type='file' WHERE type='resource';
COMMIT;
