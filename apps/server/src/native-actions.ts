import { archiveAgent, createAgent, getAgent, updateAgent } from "@otto/agents";
import {
  archiveChat,
  createChat,
  createParticipant,
  deleteParticipant,
  updateChat,
  updateParticipant,
} from "@otto/chats";
import {
  createConnection,
  disconnectConnection,
  getConnection,
  grantConnectionAccess,
  revokeConnectionAccess,
  updateConnection,
} from "@otto/connections";
import { createConnectionService } from "@otto/connections/server";
import type { Database } from "@otto/db";
import { createEnvironment } from "@otto/environments";
import {
  archiveCollection,
  archiveDocument,
  archiveFile,
  archiveFolder,
  createCollection,
  createDocument,
  createFolder,
  getDocument,
  getDocumentAudience,
  getDocumentFolderUse,
  getSkillFileReference,
  requireFileAudience,
  requireFolderPlacement,
  resolveDocumentProposal,
  setDocumentAttachments,
  snapshotRunDocuments,
  updateCollection,
  updateDocument,
  updateDocumentCollection,
  updateFile,
  updateFolder,
} from "@otto/library";
import {
  archiveProject,
  createProject,
  deleteProjectMember,
  updateProject,
  updateProjectMember,
  upsertProjectMember,
} from "@otto/projects";
import type { ModelAuthorization } from "@otto/runs";
import {
  createRunAction,
  getRunAction,
  type NativeActionInput,
  type NativeActionResult,
} from "@otto/runs/actions";
import {
  type Attempt,
  withRunAttempt,
  withRunEffect,
} from "@otto/runs/runtime";
import {
  createSchedule,
  getSchedule,
  runSchedule,
  updateSchedule,
  validateSchedule,
} from "@otto/schedules";
import type { NativeSessionStorage } from "@otto/sessions/native";
import { DomainError } from "@otto/shared";
import {
  archiveSkill,
  createSkill,
  getSkill,
  getSkillAudience,
  importSkill,
  resolveSkillProposal,
  setSkillFiles,
  updateSkill,
} from "@otto/skills";
import {
  archiveTask,
  assertNoOpenOwnedTasks,
  createTimesheet,
  deleteTimesheet,
  setTaskStatus,
  updateTask,
  updateTimesheet,
} from "@otto/tasks";
import { reviewTask } from "@otto/tasks/review";
import { type Context, requireHuman } from "@otto/workspaces";
import type { PgBoss } from "pg-boss";
import type { ConnectionOptions } from "./connections";
import { authorizeRunSources } from "./run-sources";

function reference(row: {
  id: string;
  editToken?: number;
}): NativeActionResult {
  return {
    id: row.id,
    ...(row.editToken === undefined ? {} : { editToken: row.editToken }),
  };
}

export async function executeNativeAction(
  c: Context,
  action: NativeActionInput,
  boss: PgBoss,
  options: {
    actionId: string;
    native: NativeSessionStorage;
    modelAuthorization?: ModelAuthorization;
    connections?: ConnectionOptions;
    revalidate?: () => Promise<void>;
  },
): Promise<NativeActionResult> {
  requireHuman(c);
  switch (action.type) {
    case "document.proposal.resolve": {
      if (
        (await getDocument(c, action.id, true)).editToken !== action.editToken
      )
        throw new DomainError("conflict", "Document changed");
      await resolveDocumentProposal(
        c,
        action.id,
        action.proposalId,
        action.accept,
      );
      return reference(await getDocument(c, action.id, true));
    }
    case "skill.proposal.resolve": {
      if ((await getSkill(c, action.id, true)).editToken !== action.editToken)
        throw new DomainError("conflict", "Skill changed");
      await resolveSkillProposal(
        c,
        action.id,
        action.proposalId,
        action.accept,
      );
      return reference(await getSkill(c, action.id, true));
    }
    case "schedule.run": {
      const schedule = await getSchedule(c, action.id);
      if (schedule.editToken !== action.editToken)
        throw new DomainError("conflict", "Schedule changed");
      if (schedule.type !== "prompt")
        throw new DomainError(
          "unavailable",
          "Computer execution is unavailable",
        );
      return reference(
        await runSchedule(
          c,
          boss,
          action.id,
          options.actionId,
          options.modelAuthorization,
          options.native,
        ),
      );
    }
    case "project.create": {
      const { type: _, ...input } = action;
      return reference(await createProject(c, input));
    }
    case "project.update": {
      const { type: _, id, ...input } = action;
      return reference(await updateProject(c, id, input));
    }
    case "project.archive":
      await archiveProject(c, action.id, action.archived);
      return { id: action.id, ok: true };
    case "project.member.upsert":
      await upsertProjectMember(c, action.id, action.userId, action.role);
      return { id: action.id, ok: true };
    case "project.member.update":
      if (action.role === "viewer")
        await assertNoOpenOwnedTasks(c, action.userId, action.id);
      await updateProjectMember(c, action.id, action.userId, action.role);
      return { id: action.id, ok: true };
    case "project.member.delete":
      await assertNoOpenOwnedTasks(c, action.userId, action.id);
      await deleteProjectMember(c, action.id, action.userId);
      return { id: action.id, removed: true };
    case "document.create": {
      const { type: _, ...input } = action;
      await requireFolderPlacement(c, input.folderId, {
        projectId: input.projectId ?? null,
        visibility: input.visibility,
        ownerId: c.actor.userId,
      });
      return reference(await createDocument(c, input));
    }
    case "document.update": {
      const { type: _, id, ...input } = action;
      const current = await getDocument(c, id, true);
      await requireFolderPlacement(
        c,
        input.folderId === undefined ? current.folderId : input.folderId,
        {
          projectId: current.projectId,
          visibility: input.visibility ?? current.visibility,
          ownerId: current.createdBy,
        },
      );
      const doc = await updateDocument(c, id, input);
      if (input.visibility !== undefined) {
        const audience = await getDocumentAudience(c, id);
        for (const fileId of doc.fileIds)
          await requireFileAudience(c, fileId, audience);
      }
      return reference(doc);
    }
    case "document.archive":
      return reference(
        await archiveDocument(c, action.id, action.archived, action.editToken),
      );
    case "document.collection": {
      const { type: _, id, ...input } = action;
      return reference(await updateDocumentCollection(c, id, input));
    }
    case "document.attachments": {
      const audience = await getDocumentAudience(c, action.id);
      for (const fileId of action.fileIds)
        await requireFileAudience(c, fileId, audience);
      return reference(
        await setDocumentAttachments(
          c,
          action.id,
          action.fileIds,
          action.editToken,
        ),
      );
    }
    case "collection.create": {
      const { type: _, ...input } = action;
      return reference(await createCollection(c, input));
    }
    case "collection.update": {
      const { type: _, id, ...input } = action;
      return reference(await updateCollection(c, id, input));
    }
    case "collection.archive":
      return reference(
        await archiveCollection(
          c,
          action.id,
          action.archived,
          action.editToken,
        ),
      );
    case "folder.create": {
      const { type: _, ...input } = action;
      return reference(await createFolder(c, input));
    }
    case "folder.update": {
      const { type: _, id, ...input } = action;
      return reference(await updateFolder(c, id, input, getDocumentFolderUse));
    }
    case "folder.archive":
      return reference(
        await archiveFolder(
          c,
          action.id,
          action.archived,
          getDocumentFolderUse,
        ),
      );
    case "task.status":
      return reference(
        await setTaskStatus(c, action.id, {
          status: action.status,
          editToken: action.editToken,
        }),
      );
    case "task.review": {
      const result = await reviewTask(c, action.id, action);
      return {
        ...reference(result.task),
        commentId: result.comment.id,
        decision: action.decision,
        requestId: action.requestId,
      };
    }
    case "task.update": {
      const { type: _, id, ...input } = action;
      return reference(
        await updateTask(c, id, {
          ...input,
          dueAt: input.dueAt == null ? input.dueAt : new Date(input.dueAt),
        }),
      );
    }
    case "task.archive":
      return reference(
        await archiveTask(c, action.id, action.archived, action.editToken),
      );
    case "timesheet.create": {
      const { type: _, ...input } = action;
      return reference(await createTimesheet(c, input));
    }
    case "timesheet.update": {
      const { type: _, id, ...input } = action;
      return reference(await updateTimesheet(c, id, input));
    }
    case "timesheet.delete":
      await deleteTimesheet(c, action.id);
      return { id: action.id, removed: true };
    case "file.update": {
      const { type: _, id, ...input } = action;
      return reference(await updateFile(c, id, input));
    }
    case "file.archive":
      await archiveFile(c, action.id, action.archived);
      return { id: action.id, ok: true };
    case "agent.create": {
      const { type: _, ...input } = action;
      for (const id of input.skillIds ?? [])
        if ((await getSkill(c, id)).archived)
          throw new DomainError("invalid", "Skill unavailable");
      const agent = await createAgent(c, input);
      await createEnvironment(c, agent.id);
      return reference(agent);
    }
    case "agent.update": {
      const { type: _, id, ...input } = action;
      for (const id of input.skillIds ?? [])
        if ((await getSkill(c, id)).archived)
          throw new DomainError("invalid", "Skill unavailable");
      return reference(await updateAgent(c, id, input));
    }
    case "agent.archive": {
      if ((await getAgent(c, action.id)).editToken !== action.editToken)
        throw new DomainError("conflict", "Agent changed");
      await archiveAgent(c, action.id, action.archived);
      return { id: action.id, ok: true };
    }
    case "skill.create": {
      const { type: _, ...input } = action;
      return reference(await createSkill(c, input));
    }
    case "skill.update": {
      const { type: _, id, ...input } = action;
      const skill = await updateSkill(c, id, input);
      if (input.visibility !== undefined) {
        const audience = await getSkillAudience(c, id);
        for (const file of skill.supportingFiles)
          await requireFileAudience(c, file.fileId, audience);
      }
      return reference(skill);
    }
    case "skill.import": {
      const { type: _, ...input } = action;
      return reference(await importSkill(c, input));
    }
    case "skill.files": {
      const skill = await getSkill(c, action.id, true);
      const audience = await getSkillAudience(c, action.id);
      const files = [];
      for (const file of action.files)
        files.push({
          path: file.path,
          ...(await getSkillFileReference(
            c,
            file.fileId,
            skill.projectId,
            audience,
          )),
        });
      return reference(
        await setSkillFiles(c, action.id, files, action.editToken),
      );
    }
    case "skill.archive":
      return reference(
        await archiveSkill(c, action.id, action.archived, action.editToken),
      );
    case "chat.create": {
      const { type: _, ...input } = action;
      return reference(await createChat(c, input));
    }
    case "chat.update":
      return reference(await updateChat(c, action.id, { title: action.title }));
    case "chat.archive":
      return reference(await archiveChat(c, action.id, action.archived));
    case "chat.participant.create": {
      const { type: _, id, ...input } = action;
      await createParticipant(c, id, input);
      return { id, ok: true };
    }
    case "chat.participant.update":
      await updateParticipant(c, action.id, action.participantId, action.role);
      return { id: action.id, ok: true };
    case "chat.participant.delete":
      await deleteParticipant(c, action.id, action.participantId);
      return { id: action.id, removed: true };
    case "connection.create": {
      const { type: _, connectionType, ...input } = action;
      return reference(
        await createConnection(c, { ...input, type: connectionType }),
      );
    }
    case "connection.update": {
      const { type: _, id, ...input } = action;
      return reference(await updateConnection(c, id, input));
    }
    case "connection.activate": {
      if (!options.connections || !options.revalidate)
        throw new DomainError(
          "unavailable",
          "Connection activation unavailable",
        );
      const revalidate = options.revalidate;
      const connection = await getConnection(c, action.id);
      if (connection.createdBy !== c.actor.userId)
        throw new DomainError("forbidden");
      if (connection.editToken !== action.editToken)
        throw new DomainError("conflict", "Connection changed");
      if (connection.type !== "mcp")
        throw new DomainError(
          "unavailable",
          "Native activation supports MCP only; GitHub requires human credential completion",
        );
      const service = createConnectionService({
        ...options.connections,
        boundary: {
          transact: async (work) => {
            await revalidate();
            return work(c);
          },
          validateRun: () => {
            throw new DomainError("forbidden");
          },
        },
      });
      const connected = await service.connectConnection(
        action.id,
        action.editToken,
      );
      await revalidate();
      return reference(connected);
    }
    case "connection.disconnect":
    case "connection.grant":
    case "connection.revoke": {
      if ((await getConnection(c, action.id)).editToken !== action.editToken)
        throw new DomainError("conflict", "Connection changed");
      if (action.type === "connection.disconnect")
        await disconnectConnection(c, action.id);
      else if (action.type === "connection.revoke")
        await revokeConnectionAccess(c, action.id, action.agentId);
      else {
        const { type: _, id, editToken: _token, ...input } = action;
        await grantConnectionAccess(c, id, input);
      }
      return { id: action.id, ok: true };
    }
    case "schedule.create": {
      const { type: _, runType, ...input } = action;
      return reference(
        await createSchedule(c, boss, { ...input, type: runType }),
      );
    }
    case "schedule.update": {
      const { type: _, id, runType, ...input } = action;
      return reference(
        await updateSchedule(c, boss, id, { ...input, type: runType }),
      );
    }
  }
}

export async function requestNativeAction(
  db: Database,
  attempt: Attempt,
  request: { toolCallId: string; input: NativeActionInput },
  signal: AbortSignal,
  native: NativeSessionStorage,
) {
  signal.throwIfAborted();
  const pending = await withRunEffect(
    db,
    attempt,
    {
      toolCallId: request.toolCallId,
      toolName: `request_${request.input.type.replaceAll(".", "_")}`,
      input: request.input,
    },
    async (c, run) => ({
      id: (
        await createRunAction(
          c,
          run,
          request,
          native,
          authorizeRunSources,
          snapshotRunDocuments,
        )
      ).id,
    }),
    validateSchedule,
    native,
    authorizeRunSources,
    snapshotRunDocuments,
  );
  for (;;) {
    signal.throwIfAborted();
    const current = await withRunAttempt(
      db,
      attempt,
      (c, run) =>
        getRunAction(
          c,
          run,
          pending.id,
          native,
          authorizeRunSources,
          snapshotRunDocuments,
        ),
      validateSchedule,
      native,
      authorizeRunSources,
      snapshotRunDocuments,
    );
    signal.throwIfAborted();
    if (current.status !== "pending") return current;
    await new Promise<void>((resolve, reject) => {
      const finish = () => {
        signal.removeEventListener("abort", abort);
        resolve();
      };
      const timer = setTimeout(finish, 500);
      const abort = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        reject(signal.reason ?? new DomainError("forbidden", "Run stopped"));
      };
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
  }
}
