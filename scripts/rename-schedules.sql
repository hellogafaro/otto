-- Explicit pre-MVP offline metadata rename; never invoked by startup/db:push.
-- Stop Otto, inspect/backup the database and execute with ON_ERROR_STOP.
-- Native queue tables/names/payloads and accepted JSON are deliberately untouched.
BEGIN;
DO $$ BEGIN
  IF to_regclass('public.automations') IS NULL OR to_regclass('public.automation_history') IS NULL
     OR to_regclass('public.schedules') IS NOT NULL OR to_regclass('public.schedule_history') IS NOT NULL THEN
    RAISE EXCEPTION 'Expected only old Automation tables; inspect rename state';
  END IF;
END $$;
LOCK TABLE automations, automation_history, runs, agent_sessions, environments IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM runs WHERE state IN ('queued','launching','running','uncertain'))
     OR EXISTS (SELECT 1 FROM environments WHERE "activeRunId" IS NOT NULL) THEN
    RAISE EXCEPTION 'Quiescent Runs and confirmed released leases required';
  END IF;
END $$;
ALTER TABLE automations RENAME TO schedules;
ALTER TABLE automation_history RENAME TO schedule_history;
ALTER TABLE schedule_history RENAME COLUMN "automationId" TO "scheduleId";
ALTER TABLE runs RENAME COLUMN "automationId" TO "scheduleId";
ALTER TABLE runs RENAME COLUMN "automationEditToken" TO "scheduleEditToken";
DO $$ DECLARE entry record; target text; BEGIN
  FOR entry IN SELECT c.conname,t.relname FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
    WHERE c.conrelid IN ('public.schedules'::regclass,'public.schedule_history'::regclass,'public.runs'::regclass)
      AND c.conname LIKE '%automation%' LOOP
    target := replace(entry.conname,'automation','schedule');
    EXECUTE format('ALTER TABLE %I RENAME CONSTRAINT %I TO %I',entry.relname,entry.conname,target);
  END LOOP;
  FOR entry IN SELECT tablename,indexname FROM pg_indexes WHERE schemaname='public'
    AND tablename IN ('schedules','schedule_history','runs') AND indexname LIKE '%automation%' LOOP
    EXECUTE format('ALTER INDEX %I RENAME TO %I',entry.indexname,replace(entry.indexname,'automation','schedule'));
  END LOOP;
END $$;
COMMIT;
