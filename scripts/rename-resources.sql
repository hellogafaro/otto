-- Explicit pre-MVP offline metadata rename, never invoked by startup/db:push.
-- Stop Otto, inspect/backup the database, then run with ON_ERROR_STOP.
-- Files, upload identities and accepted/frozen JSON are deliberately untouched.
BEGIN;
DO $$
BEGIN
  IF to_regclass('public.artifacts') IS NULL OR to_regclass('public.resources') IS NOT NULL THEN
    RAISE EXCEPTION 'Expected only the old artifacts table; inspect rename state';
  END IF;
END $$;
LOCK TABLE artifacts, documents, messages, task_links, runs, agent_sessions,
  environments, skills, content_shares IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM runs WHERE state IN ('queued','launching','running','uncertain'))
     OR EXISTS (SELECT 1 FROM environments WHERE "activeRunId" IS NOT NULL) THEN
    RAISE EXCEPTION 'Quiescent Runs and confirmed released leases required';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
      AND table_name IN ('documents','messages') AND column_name='resourceIds')
     OR (SELECT count(*) FROM information_schema.columns WHERE table_schema='public'
      AND table_name IN ('documents','messages') AND column_name='artifactIds') <> 2 THEN
    RAISE EXCEPTION 'Unexpected attachment columns; operator disposition required';
  END IF;
END $$;
ALTER TABLE artifacts RENAME TO resources;
-- Constraint-backed indexes rename with their constraint; remaining indexes are renamed once.
DO $$
DECLARE entry record;
BEGIN
  FOR entry IN SELECT conname FROM pg_constraint WHERE conrelid='public.resources'::regclass
    AND conname LIKE 'artifacts_%' LOOP
    EXECUTE format('ALTER TABLE resources RENAME CONSTRAINT %I TO %I', entry.conname,
      'resources_' || substring(entry.conname FROM 11));
  END LOOP;
  FOR entry IN SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='resources'
    AND indexname LIKE 'artifacts_%' LOOP
    EXECUTE format('ALTER INDEX %I RENAME TO %I', entry.indexname,
      'resources_' || substring(entry.indexname FROM 11));
  END LOOP;
END $$;
ALTER TABLE documents RENAME COLUMN "artifactIds" TO "resourceIds";
ALTER TABLE messages RENAME COLUMN "artifactIds" TO "resourceIds";
UPDATE task_links SET type='resource' WHERE type='artifact';
COMMIT;
