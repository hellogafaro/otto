CREATE TABLE "agent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspaceId" uuid NOT NULL,
	"projectId" uuid,
	"ownerId" text NOT NULL,
	"name" text NOT NULL,
	"instructions" text NOT NULL,
	"harness" text NOT NULL,
	"harnessRelease" text NOT NULL,
	"model" text NOT NULL,
	"accountConnectionId" uuid,
	"skillIds" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"configToken" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artifact" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspaceId" uuid NOT NULL,
	"projectId" uuid,
	"ownerId" text NOT NULL,
	"requestId" uuid NOT NULL,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"access" text NOT NULL,
	"sourceRunId" uuid,
	"objectKey" text NOT NULL,
	"sha256" text NOT NULL,
	"byteLength" integer NOT NULL,
	"mediaType" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	CONSTRAINT "artifact_objectKey_unique" UNIQUE("objectKey")
);
--> statement-breakpoint
CREATE TABLE "automation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspaceId" uuid NOT NULL,
	"ownerId" text NOT NULL,
	"agentId" uuid NOT NULL,
	"conversationId" uuid NOT NULL,
	"projectId" uuid,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"body" text NOT NULL,
	"skillIds" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cron" text,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"configToken" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_occurrence" (
	"jobId" uuid PRIMARY KEY NOT NULL,
	"automationId" uuid NOT NULL,
	"runId" uuid,
	"outcome" text NOT NULL,
	"receivedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspaceId" uuid NOT NULL,
	"ownerId" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"accountRef" text NOT NULL,
	"credentialRef" text,
	"mode" text NOT NULL,
	"connected" boolean DEFAULT false NOT NULL,
	"configToken" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connection_grant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connectionId" uuid NOT NULL,
	"agentId" uuid NOT NULL,
	"sponsorId" text NOT NULL,
	"resources" jsonb NOT NULL,
	"operations" jsonb NOT NULL,
	"revokedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "connection_operation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspaceId" uuid NOT NULL,
	"connectionId" uuid NOT NULL,
	"agentId" uuid NOT NULL,
	"sponsorId" text NOT NULL,
	"runId" uuid NOT NULL,
	"requestId" uuid NOT NULL,
	"action" text NOT NULL,
	"target" text NOT NULL,
	"accountRef" text NOT NULL,
	"state" text NOT NULL,
	"approvedBy" text,
	"expiresAt" timestamp with time zone,
	"externalRef" text
);
--> statement-breakpoint
CREATE TABLE "conversation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspaceId" uuid NOT NULL,
	"projectId" uuid,
	"title" text NOT NULL,
	"access" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspaceId" uuid NOT NULL,
	"conversationId" uuid NOT NULL,
	"authorUserId" text,
	"authorAgentId" uuid,
	"body" text NOT NULL,
	"replyTo" uuid,
	"requestId" uuid NOT NULL,
	"revision" integer NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_exactly_one_author" CHECK (num_nonnulls("message"."authorUserId","message"."authorAgentId")=1)
);
--> statement-breakpoint
CREATE TABLE "conversation_participant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversationId" uuid NOT NULL,
	"userId" text,
	"agentId" uuid,
	"role" text NOT NULL,
	CONSTRAINT "participant_exactly_one" CHECK (num_nonnulls("conversation_participant"."userId","conversation_participant"."agentId")=1)
);
--> statement-breakpoint
CREATE TABLE "collection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspaceId" uuid NOT NULL,
	"projectId" uuid,
	"title" text NOT NULL,
	"fields" jsonb NOT NULL,
	"editToken" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspaceId" uuid NOT NULL,
	"projectId" uuid,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"ownerId" text NOT NULL,
	"access" text NOT NULL,
	"readerIds" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"skill" boolean DEFAULT false NOT NULL,
	"whenToUse" text,
	"editToken" integer DEFAULT 0 NOT NULL,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"collectionId" uuid
);
--> statement-breakpoint
CREATE TABLE "environment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspaceId" uuid NOT NULL,
	"agentId" uuid NOT NULL,
	"scope" text NOT NULL,
	"generation" integer DEFAULT 0 NOT NULL,
	"state" text DEFAULT 'unavailable' NOT NULL,
	"provider" text,
	"computerRef" text,
	"activeRunId" uuid,
	CONSTRAINT "environment_agentId_unique" UNIQUE("agentId")
);
--> statement-breakpoint
CREATE TABLE "run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspaceId" uuid NOT NULL,
	"conversationId" uuid NOT NULL,
	"agentId" uuid NOT NULL,
	"sponsorId" text NOT NULL,
	"taskId" uuid,
	"automationId" uuid,
	"automationToken" integer,
	"sessionId" uuid,
	"environmentId" uuid NOT NULL,
	"environmentGeneration" integer NOT NULL,
	"requestId" text NOT NULL,
	"kind" text NOT NULL,
	"inputs" jsonb NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"launchKey" uuid DEFAULT gen_random_uuid() NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"executionRef" text,
	"outcome" text,
	"revision" integer NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_prompt_session" CHECK (("run"."kind"='prompt' and "run"."sessionId" is not null) or ("run"."kind"='script' and "run"."sessionId" is null))
);
--> statement-breakpoint
CREATE TABLE "agent_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspaceId" uuid NOT NULL,
	"conversationId" uuid NOT NULL,
	"agentId" uuid NOT NULL,
	"environmentId" uuid NOT NULL,
	"environmentGeneration" integer NOT NULL,
	"scope" text NOT NULL,
	"harness" text NOT NULL,
	"harnessRelease" text NOT NULL,
	"accountConnectionId" uuid,
	"contextRef" text
);
--> statement-breakpoint
ALTER TABLE "automation_occurrence" ADD CONSTRAINT "automation_occurrence_automationId_automation_id_fk" FOREIGN KEY ("automationId") REFERENCES "public"."automation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_grant" ADD CONSTRAINT "connection_grant_connectionId_connection_id_fk" FOREIGN KEY ("connectionId") REFERENCES "public"."connection"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connection_operation" ADD CONSTRAINT "connection_operation_connectionId_connection_id_fk" FOREIGN KEY ("connectionId") REFERENCES "public"."connection"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_conversationId_conversation_id_fk" FOREIGN KEY ("conversationId") REFERENCES "public"."conversation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_participant" ADD CONSTRAINT "conversation_participant_conversationId_conversation_id_fk" FOREIGN KEY ("conversationId") REFERENCES "public"."conversation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_idempotency" ON "artifact" USING btree ("workspaceId","ownerId","requestId");--> statement-breakpoint
CREATE UNIQUE INDEX "connection_agent_grant" ON "connection_grant" USING btree ("connectionId","agentId");--> statement-breakpoint
CREATE UNIQUE INDEX "connection_operation_request" ON "connection_operation" USING btree ("runId","requestId");--> statement-breakpoint
CREATE UNIQUE INDEX "message_request_unique" ON "message" USING btree ("conversationId","requestId");--> statement-breakpoint
CREATE INDEX "message_replay_idx" ON "message" USING btree ("conversationId","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "participant_human_unique" ON "conversation_participant" USING btree ("conversationId","userId");--> statement-breakpoint
CREATE UNIQUE INDEX "participant_agent_unique" ON "conversation_participant" USING btree ("conversationId","agentId");--> statement-breakpoint
CREATE UNIQUE INDEX "run_request_unique" ON "run" USING btree ("workspaceId","sponsorId","requestId");--> statement-breakpoint
CREATE UNIQUE INDEX "run_automation_active" ON "run" USING btree ("automationId") WHERE "run"."state" in ('queued','launching','running','uncertain');--> statement-breakpoint
CREATE INDEX "run_conversation_replay" ON "run" USING btree ("conversationId","revision");