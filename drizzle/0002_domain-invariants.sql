-- Cross-domain referential invariants are composed here, without importing another domain private tables.
--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id");
--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_identity_workspace" UNIQUE ("id", "workspaceId");
--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id");
--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_identity_workspace" UNIQUE ("id", "workspaceId");
--> statement-breakpoint
ALTER TABLE "agent" ADD CONSTRAINT "agent_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id");
--> statement-breakpoint
ALTER TABLE "agent" ADD CONSTRAINT "agent_identity_workspace" UNIQUE ("id", "workspaceId");
--> statement-breakpoint
ALTER TABLE "environment" ADD CONSTRAINT "environment_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id");
--> statement-breakpoint
ALTER TABLE "environment" ADD CONSTRAINT "environment_identity_workspace" UNIQUE ("id", "workspaceId");
--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id");
--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_identity_workspace" UNIQUE ("id", "workspaceId");
--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id");
--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_identity_workspace" UNIQUE ("id", "workspaceId");
--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id");
--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_identity_workspace" UNIQUE ("id", "workspaceId");
--> statement-breakpoint
ALTER TABLE "collection" ADD CONSTRAINT "collection_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id");
--> statement-breakpoint
ALTER TABLE "collection" ADD CONSTRAINT "collection_identity_workspace" UNIQUE ("id", "workspaceId");
--> statement-breakpoint
ALTER TABLE "artifact" ADD CONSTRAINT "artifact_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id");
--> statement-breakpoint
ALTER TABLE "artifact" ADD CONSTRAINT "artifact_identity_workspace" UNIQUE ("id", "workspaceId");
--> statement-breakpoint
ALTER TABLE "connection" ADD CONSTRAINT "connection_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id");
--> statement-breakpoint
ALTER TABLE "connection" ADD CONSTRAINT "connection_identity_workspace" UNIQUE ("id", "workspaceId");
--> statement-breakpoint
ALTER TABLE "connection_operation" ADD CONSTRAINT "connection_operation_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id");
--> statement-breakpoint
ALTER TABLE "connection_operation" ADD CONSTRAINT "connection_operation_identity_workspace" UNIQUE ("id", "workspaceId");
--> statement-breakpoint
ALTER TABLE "agent_session" ADD CONSTRAINT "agent_session_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id");
--> statement-breakpoint
ALTER TABLE "agent_session" ADD CONSTRAINT "agent_session_identity_workspace" UNIQUE ("id", "workspaceId");
--> statement-breakpoint
ALTER TABLE "run" ADD CONSTRAINT "run_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id");
--> statement-breakpoint
ALTER TABLE "run" ADD CONSTRAINT "run_identity_workspace" UNIQUE ("id", "workspaceId");
--> statement-breakpoint
ALTER TABLE "automation" ADD CONSTRAINT "automation_workspace_fk" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id");
--> statement-breakpoint
ALTER TABLE "automation" ADD CONSTRAINT "automation_identity_workspace" UNIQUE ("id", "workspaceId");
--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_projectId_workspace_fk" FOREIGN KEY ("projectId","workspaceId") REFERENCES "project"("id","workspaceId");
--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_assigneeAgentId_workspace_fk" FOREIGN KEY ("assigneeAgentId","workspaceId") REFERENCES "agent"("id","workspaceId");
--> statement-breakpoint
ALTER TABLE "agent" ADD CONSTRAINT "agent_projectId_workspace_fk" FOREIGN KEY ("projectId","workspaceId") REFERENCES "project"("id","workspaceId");
--> statement-breakpoint
ALTER TABLE "agent" ADD CONSTRAINT "agent_accountConnectionId_workspace_fk" FOREIGN KEY ("accountConnectionId","workspaceId") REFERENCES "connection"("id","workspaceId");
--> statement-breakpoint
ALTER TABLE "environment" ADD CONSTRAINT "environment_agentId_workspace_fk" FOREIGN KEY ("agentId","workspaceId") REFERENCES "agent"("id","workspaceId");
--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_projectId_workspace_fk" FOREIGN KEY ("projectId","workspaceId") REFERENCES "project"("id","workspaceId");
--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_conversationId_workspace_fk" FOREIGN KEY ("conversationId","workspaceId") REFERENCES "conversation"("id","workspaceId");
--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_authorAgentId_workspace_fk" FOREIGN KEY ("authorAgentId","workspaceId") REFERENCES "agent"("id","workspaceId");
--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_projectId_workspace_fk" FOREIGN KEY ("projectId","workspaceId") REFERENCES "project"("id","workspaceId");
--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_collectionId_workspace_fk" FOREIGN KEY ("collectionId","workspaceId") REFERENCES "collection"("id","workspaceId");
--> statement-breakpoint
ALTER TABLE "collection" ADD CONSTRAINT "collection_projectId_workspace_fk" FOREIGN KEY ("projectId","workspaceId") REFERENCES "project"("id","workspaceId");
--> statement-breakpoint
ALTER TABLE "artifact" ADD CONSTRAINT "artifact_projectId_workspace_fk" FOREIGN KEY ("projectId","workspaceId") REFERENCES "project"("id","workspaceId");
--> statement-breakpoint
ALTER TABLE "artifact" ADD CONSTRAINT "artifact_sourceRunId_workspace_fk" FOREIGN KEY ("sourceRunId","workspaceId") REFERENCES "run"("id","workspaceId");
--> statement-breakpoint
ALTER TABLE "agent_session" ADD CONSTRAINT "agent_session_conversationId_workspace_fk" FOREIGN KEY ("conversationId","workspaceId") REFERENCES "conversation"("id","workspaceId");
--> statement-breakpoint
ALTER TABLE "agent_session" ADD CONSTRAINT "agent_session_agentId_workspace_fk" FOREIGN KEY ("agentId","workspaceId") REFERENCES "agent"("id","workspaceId");
--> statement-breakpoint
ALTER TABLE "agent_session" ADD CONSTRAINT "agent_session_environmentId_workspace_fk" FOREIGN KEY ("environmentId","workspaceId") REFERENCES "environment"("id","workspaceId");
--> statement-breakpoint
ALTER TABLE "agent_session" ADD CONSTRAINT "agent_session_accountConnectionId_workspace_fk" FOREIGN KEY ("accountConnectionId","workspaceId") REFERENCES "connection"("id","workspaceId");
--> statement-breakpoint
ALTER TABLE "run" ADD CONSTRAINT "run_conversationId_workspace_fk" FOREIGN KEY ("conversationId","workspaceId") REFERENCES "conversation"("id","workspaceId");
--> statement-breakpoint
ALTER TABLE "run" ADD CONSTRAINT "run_agentId_workspace_fk" FOREIGN KEY ("agentId","workspaceId") REFERENCES "agent"("id","workspaceId");
--> statement-breakpoint
ALTER TABLE "run" ADD CONSTRAINT "run_taskId_workspace_fk" FOREIGN KEY ("taskId","workspaceId") REFERENCES "task"("id","workspaceId");
--> statement-breakpoint
ALTER TABLE "run" ADD CONSTRAINT "run_automationId_workspace_fk" FOREIGN KEY ("automationId","workspaceId") REFERENCES "automation"("id","workspaceId");
--> statement-breakpoint
ALTER TABLE "run" ADD CONSTRAINT "run_sessionId_workspace_fk" FOREIGN KEY ("sessionId","workspaceId") REFERENCES "agent_session"("id","workspaceId");
--> statement-breakpoint
ALTER TABLE "run" ADD CONSTRAINT "run_environmentId_workspace_fk" FOREIGN KEY ("environmentId","workspaceId") REFERENCES "environment"("id","workspaceId");
--> statement-breakpoint
ALTER TABLE "automation" ADD CONSTRAINT "automation_agentId_workspace_fk" FOREIGN KEY ("agentId","workspaceId") REFERENCES "agent"("id","workspaceId");
--> statement-breakpoint
ALTER TABLE "automation" ADD CONSTRAINT "automation_conversationId_workspace_fk" FOREIGN KEY ("conversationId","workspaceId") REFERENCES "conversation"("id","workspaceId");
--> statement-breakpoint
ALTER TABLE "automation" ADD CONSTRAINT "automation_projectId_workspace_fk" FOREIGN KEY ("projectId","workspaceId") REFERENCES "project"("id","workspaceId");
--> statement-breakpoint
ALTER TABLE "connection_operation" ADD CONSTRAINT "connection_operation_connectionId_workspace_fk" FOREIGN KEY ("connectionId","workspaceId") REFERENCES "connection"("id","workspaceId");
--> statement-breakpoint
ALTER TABLE "connection_operation" ADD CONSTRAINT "connection_operation_agentId_workspace_fk" FOREIGN KEY ("agentId","workspaceId") REFERENCES "agent"("id","workspaceId");
--> statement-breakpoint
ALTER TABLE "connection_operation" ADD CONSTRAINT "connection_operation_runId_workspace_fk" FOREIGN KEY ("runId","workspaceId") REFERENCES "run"("id","workspaceId");
--> statement-breakpoint
ALTER TABLE "project_member" ADD CONSTRAINT "project_member_userId_fk" FOREIGN KEY ("userId") REFERENCES "auth_user"("id");
--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_ownerId_fk" FOREIGN KEY ("ownerId") REFERENCES "auth_user"("id");
--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_assigneeUserId_fk" FOREIGN KEY ("assigneeUserId") REFERENCES "auth_user"("id");
--> statement-breakpoint
ALTER TABLE "agent" ADD CONSTRAINT "agent_ownerId_fk" FOREIGN KEY ("ownerId") REFERENCES "auth_user"("id");
--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_authorUserId_fk" FOREIGN KEY ("authorUserId") REFERENCES "auth_user"("id");
--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_ownerId_fk" FOREIGN KEY ("ownerId") REFERENCES "auth_user"("id");
--> statement-breakpoint
ALTER TABLE "artifact" ADD CONSTRAINT "artifact_ownerId_fk" FOREIGN KEY ("ownerId") REFERENCES "auth_user"("id");
--> statement-breakpoint
ALTER TABLE "connection" ADD CONSTRAINT "connection_ownerId_fk" FOREIGN KEY ("ownerId") REFERENCES "auth_user"("id");
--> statement-breakpoint
ALTER TABLE "connection_grant" ADD CONSTRAINT "connection_grant_sponsorId_fk" FOREIGN KEY ("sponsorId") REFERENCES "auth_user"("id");
--> statement-breakpoint
ALTER TABLE "connection_operation" ADD CONSTRAINT "connection_operation_sponsorId_fk" FOREIGN KEY ("sponsorId") REFERENCES "auth_user"("id");
--> statement-breakpoint
ALTER TABLE "connection_operation" ADD CONSTRAINT "connection_operation_approvedBy_fk" FOREIGN KEY ("approvedBy") REFERENCES "auth_user"("id");
--> statement-breakpoint
ALTER TABLE "run" ADD CONSTRAINT "run_sponsorId_fk" FOREIGN KEY ("sponsorId") REFERENCES "auth_user"("id");
--> statement-breakpoint
ALTER TABLE "automation" ADD CONSTRAINT "automation_ownerId_fk" FOREIGN KEY ("ownerId") REFERENCES "auth_user"("id");
--> statement-breakpoint
ALTER TABLE "conversation_participant" ADD CONSTRAINT "conversation_participant_userId_fk" FOREIGN KEY ("userId") REFERENCES "auth_user"("id");
--> statement-breakpoint
ALTER TABLE "conversation_participant" ADD CONSTRAINT "participant_agent_fk" FOREIGN KEY ("agentId") REFERENCES "agent"("id");
--> statement-breakpoint
ALTER TABLE "connection_grant" ADD CONSTRAINT "grant_agent_fk" FOREIGN KEY ("agentId") REFERENCES "agent"("id");
--> statement-breakpoint
ALTER TABLE "workspace_member" ADD CONSTRAINT "workspace_member_role_values" CHECK ("role" IN ('owner','admin','contributor','viewer'));
--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_role_values" CHECK ("role" IN ('admin','contributor','viewer'));
--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_status_values" CHECK ("status" IN ('todo','doing','done'));
--> statement-breakpoint
ALTER TABLE "run" ADD CONSTRAINT "run_state_values" CHECK ("state" IN ('queued','launching','running','finished','failed','interrupted','uncertain'));
--> statement-breakpoint
ALTER TABLE "environment" ADD CONSTRAINT "environment_state_values" CHECK ("state" IN ('unavailable','ready','uncertain'));
--> statement-breakpoint
ALTER TABLE "installation_setup" ADD CONSTRAINT "single_setup" CHECK ("id"=1);
--> statement-breakpoint
ALTER TABLE "artifact" ADD CONSTRAINT "artifact_size" CHECK ("byteLength">=0 AND "byteLength"<=8388608);
--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_size" CHECK (octet_length("body")<=100000);
--> statement-breakpoint
ALTER TABLE "run" ADD CONSTRAINT "run_input_size" CHECK (octet_length("inputs"::text)<=1048576);
--> statement-breakpoint
CREATE INDEX project_workspace_page ON project ("workspaceId",id);
--> statement-breakpoint
CREATE INDEX project_member_user ON project_member ("userId","projectId");
--> statement-breakpoint
CREATE INDEX artifact_library ON artifact ("workspaceId","projectId",state,archived,id);
--> statement-breakpoint
CREATE INDEX run_environment_queue ON run ("environmentId",state);
--> statement-breakpoint
CREATE INDEX automation_workspace ON automation ("workspaceId",id);
