-- Explicit pre-MVP offline metadata rename; never invoked by startup/db:push.
-- Stop Otto, inspect/backup the database and execute with ON_ERROR_STOP, after the Resources and Schedules renames.
-- Accepted Run request identities, frozen share JSON, native queue tables/names/payloads and all IDs are deliberately untouched.
BEGIN;
DO $$ BEGIN
  IF to_regclass('public.conversations') IS NULL OR to_regclass('public.conversation_participants') IS NULL
     OR to_regclass('public.conversation_reads') IS NULL OR to_regclass('public.chats') IS NOT NULL
     OR to_regclass('public.chat_participants') IS NOT NULL OR to_regclass('public.chat_reads') IS NOT NULL THEN
    RAISE EXCEPTION 'Expected only old Conversation tables; inspect rename state';
  END IF;
  IF to_regclass('public.schedules') IS NULL OR to_regclass('public.automations') IS NOT NULL THEN
    RAISE EXCEPTION 'Run rename-schedules.sql first; inspect rename state';
  END IF;
END $$;
LOCK TABLE conversations, conversation_participants, conversation_reads, messages, runs,
  agent_sessions, schedules, environments, task_links IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM runs WHERE state IN ('queued','launching','running','uncertain'))
     OR EXISTS (SELECT 1 FROM environments WHERE "activeRunId" IS NOT NULL) THEN
    RAISE EXCEPTION 'Quiescent Runs and confirmed released leases required';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND column_name='conversationId'
      AND table_name IN ('conversation_participants','conversation_reads','messages','runs','agent_sessions','schedules')) <> 6
     OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND column_name='chatId')
     OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND column_name='conversationId'
      AND table_name NOT IN ('conversation_participants','conversation_reads','messages','runs','agent_sessions','schedules')) THEN
    RAISE EXCEPTION 'Unexpected Conversation columns; operator disposition required';
  END IF;
  IF EXISTS (SELECT 1 FROM task_links WHERE type='chat') THEN
    RAISE EXCEPTION 'Mixed Task-link discriminators; operator disposition required';
  END IF;
END $$;
ALTER TABLE conversations RENAME TO chats;
ALTER TABLE conversation_participants RENAME TO chat_participants;
ALTER TABLE conversation_reads RENAME TO chat_reads;
ALTER TABLE chat_participants RENAME COLUMN "conversationId" TO "chatId";
ALTER TABLE chat_reads RENAME COLUMN "conversationId" TO "chatId";
ALTER TABLE messages RENAME COLUMN "conversationId" TO "chatId";
ALTER TABLE runs RENAME COLUMN "conversationId" TO "chatId";
ALTER TABLE agent_sessions RENAME COLUMN "conversationId" TO "chatId";
ALTER TABLE schedules RENAME COLUMN "conversationId" TO "chatId";
-- Constraint-backed indexes rename with their constraint; remaining indexes are renamed once.
DO $$ DECLARE entry record; BEGIN
  FOR entry IN SELECT c.conname,t.relname FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
    WHERE c.conrelid IN ('public.chats'::regclass,'public.chat_participants'::regclass,'public.chat_reads'::regclass,
      'public.messages'::regclass,'public.runs'::regclass,'public.agent_sessions'::regclass,'public.schedules'::regclass)
      AND c.conname LIKE '%conversation%' LOOP
    EXECUTE format('ALTER TABLE %I RENAME CONSTRAINT %I TO %I',entry.relname,entry.conname,replace(entry.conname,'conversation','chat'));
  END LOOP;
  FOR entry IN SELECT indexname FROM pg_indexes WHERE schemaname='public'
    AND tablename IN ('chats','chat_participants','chat_reads','messages','runs','agent_sessions','schedules')
    AND indexname LIKE '%conversation%' LOOP
    EXECUTE format('ALTER INDEX %I RENAME TO %I',entry.indexname,replace(entry.indexname,'conversation','chat'));
  END LOOP;
END $$;
UPDATE task_links SET type='chat' WHERE type='conversation';
COMMIT;
