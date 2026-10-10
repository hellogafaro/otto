import {
  archiveChat,
  CHAT_SORTS,
  createChat,
  createParticipant,
  deleteParticipant,
  getChat,
  getChatAudience,
  getChats,
  getMessages,
  getParticipants,
  markChatRead,
  PARTICIPANT_SORTS,
  updateChat,
  updateParticipant,
} from "@otto/chats";
import { getDocument, getFile, requireFileAudience } from "@otto/library";
import {
  archiveProject,
  createProject,
  deleteProjectMember,
  getProject,
  getProjectMembers,
  getProjects,
  PROJECT_MEMBER_SORTS,
  PROJECT_SORTS,
  updateProject,
  updateProjectMember,
  upsertProjectMember,
} from "@otto/projects";
import { getSessions, SESSION_SORTS } from "@otto/sessions";
import { DomainError } from "@otto/shared";
import {
  archiveTask,
  assertNoOpenOwnedTasks,
  createTask,
  createTaskLink,
  createTimesheet,
  deleteTaskLink,
  deleteTimesheet,
  getTask,
  getTaskLinks,
  getTasks,
  getTimesheet,
  getTimesheets,
  setTaskStatus,
  TASK_LINK_SORTS,
  TASK_SORTS,
  TIMESHEET_SORTS,
  updateTask,
  updateTimesheet,
} from "@otto/tasks";
import type { Context } from "@otto/workspaces";
import { Hono } from "hono";
import { z } from "zod";
import { createChatMessage } from "./chat-replies";
import { type ApiEnv, recordId, transact, workspaceId } from "./http";
import { captureTask } from "./task-capture";
import {
  body,
  editToken,
  flag,
  id,
  listQuery,
  title,
  validate,
} from "./validation";

const archive = z.object({ archived: z.boolean(), editToken });
const taskSchedule = {
  dueAt: z.iso
    .datetime({ offset: true })
    .transform((value) => new Date(value))
    .nullable()
    .optional(),
  recurrence: z.string().max(400).nullable().optional(),
};
const assignees = {
  assigneeUserIds: z.array(z.string().min(1).max(128)).max(20).optional(),
  assigneeAgentIds: z.array(id).max(20).optional(),
};
const search = z.string().max(200).optional();
const dateTime = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value))
  .optional();
const timeEntry = z.object({
  duration: z.number().int().min(1).max(2147483647),
  notes: z
    .string()
    .max(4000)
    .refine((value) => Buffer.byteLength(value) <= 4000)
    .nullable()
    .optional(),
});
const authorizeLink = async (
  ctx: Context,
  link: {
    type: "document" | "chat" | "file" | "url";
    reference: string;
  },
) => {
  if (link.type === "document")
    await getDocument(ctx, id.parse(link.reference));
  else if (link.type === "chat") await getChat(ctx, id.parse(link.reference));
  else if (link.type === "file") await getFile(ctx, id.parse(link.reference));
  else {
    const url = z.url().max(2048).parse(link.reference);
    if (!["https:", "http:"].includes(new URL(url).protocol))
      throw new DomainError("invalid");
  }
};
export const collaborationApi = new Hono<ApiEnv>()
  .post(
    "/workspaces/:workspaceId/projects",
    validate(
      "json",
      z.object({ title, repositoryUrl: z.url().max(2048).optional() }),
    ),
    async (c) =>
      c.json(
        await transact(c, (ctx) => createProject(ctx, c.req.valid("json"))),
      ),
  )
  .post(
    "/workspaces/:workspaceId/projects/:id/members",
    validate(
      "json",
      z.object({
        userId: z.string().max(128),
        role: z.enum(["contributor", "viewer"]),
      }),
    ),
    async (c) => {
      await transact(c, (ctx) =>
        upsertProjectMember(
          ctx,
          id.parse(c.req.param("id")),
          c.req.valid("json").userId,
          c.req.valid("json").role,
        ),
      );
      return c.json({ saved: true });
    },
  )
  .post(
    "/workspaces/:workspaceId/tasks",
    validate(
      "json",
      z.object({
        projectId: id,
        title,
        notes: body.optional(),
        ownerId: z.string().max(128).optional(),
        ...taskSchedule,
        ...assignees,
      }),
    ),
    async (c) =>
      c.json(await transact(c, (ctx) => createTask(ctx, c.req.valid("json")))),
  )
  .get("/workspaces/:workspaceId/tasks/:id", async (c) =>
    c.json(
      await transact(
        c,
        (ctx) => getTask(ctx, id.parse(c.req.param("id"))),
        false,
      ),
    ),
  )
  .post(
    "/workspaces/:workspaceId/timesheets",
    validate("json", timeEntry.extend({ taskId: id }).strict()),
    async (c) =>
      c.json(
        await transact(c, (ctx) => createTimesheet(ctx, c.req.valid("json"))),
      ),
  )
  .get(
    "/workspaces/:workspaceId/timesheets",
    validate(
      "query",
      listQuery(TIMESHEET_SORTS, {
        taskId: id,
        createdBy: z.string().min(1).max(128).optional(),
        from: dateTime,
        to: dateTime,
      }),
    ),
    async (c) =>
      c.json(
        await transact(
          c,
          (ctx) => getTimesheets(ctx, c.req.valid("query")),
          false,
        ),
      ),
  )
  .get("/workspaces/:workspaceId/timesheets/:id", async (c) =>
    c.json(await transact(c, (ctx) => getTimesheet(ctx, recordId(c)), false)),
  )
  .patch(
    "/workspaces/:workspaceId/timesheets/:id",
    validate("json", timeEntry.partial().strict()),
    async (c) =>
      c.json(
        await transact(c, (ctx) =>
          updateTimesheet(ctx, recordId(c), c.req.valid("json")),
        ),
      ),
  )
  .delete("/workspaces/:workspaceId/timesheets/:id", async (c) => {
    await transact(c, (ctx) => deleteTimesheet(ctx, recordId(c)));
    return c.json({ removed: true });
  })
  .post(
    "/workspaces/:workspaceId/tasks/:id/status",
    validate(
      "json",
      z.object({ status: z.enum(["todo", "doing", "done"]), editToken }),
    ),
    async (c) =>
      c.json(
        await transact(c, (ctx) =>
          setTaskStatus(ctx, id.parse(c.req.param("id")), c.req.valid("json")),
        ),
      ),
  )
  .post(
    "/workspaces/:workspaceId/chats",
    validate(
      "json",
      z
        .object({
          title,
          projectId: id.optional(),
          visibility: z.enum(["workspace", "participants"]),
        })
        .strict(),
    ),
    async (c) =>
      c.json(await transact(c, (ctx) => createChat(ctx, c.req.valid("json")))),
  )
  .post(
    "/workspaces/:workspaceId/chats/:id/participants",
    validate(
      "json",
      z.object({
        userId: z.string().max(128).optional(),
        agentId: id.optional(),
        role: z.enum(["contributor", "viewer"]),
      }),
    ),
    async (c) => {
      await transact(c, (ctx) =>
        createParticipant(
          ctx,
          id.parse(c.req.param("id")),
          c.req.valid("json"),
        ),
      );
      return c.json({ saved: true });
    },
  )
  .delete(
    "/workspaces/:workspaceId/chats/:id/participants/:participantId",
    async (c) => {
      await transact(c, (ctx) =>
        deleteParticipant(
          ctx,
          id.parse(c.req.param("id")),
          id.parse(c.req.param("participantId")),
        ),
      );
      return c.json({ removed: true });
    },
  )
  .get(
    "/workspaces/:workspaceId/chats/:id/messages",
    validate(
      "query",
      z
        .object({ after: z.coerce.number().int().nonnegative().default(0) })
        .strict(),
    ),
    async (c) =>
      c.json(
        await transact(
          c,
          (ctx) =>
            getMessages(
              ctx,
              id.parse(c.req.param("id")),
              c.req.valid("query").after,
              c.get("options").nativeStorage,
            ),
          false,
        ),
      ),
  )
  .get(
    "/workspaces/:workspaceId/chats/:id/sessions",
    validate("query", listQuery(SESSION_SORTS, { agentId: id.optional() })),
    async (c) =>
      c.json(
        await transact(
          c,
          async (ctx) => {
            const chatId = id.parse(c.req.param("id"));
            await getChat(ctx, chatId);
            return getSessions(ctx, chatId, c.req.valid("query"));
          },
          false,
        ),
      ),
  )
  .put(
    "/workspaces/:workspaceId/chats/:id/presence",
    validate("json", z.object({ typing: z.boolean() })),
    async (c) => {
      await transact(
        c,
        (ctx) =>
          c
            .get("presence")
            .update(ctx, recordId(c), c.req.valid("json").typing),
        false,
      );
      return c.json({ ok: true });
    },
  )
  .get("/workspaces/:workspaceId/chats/:id/presence", async (c) =>
    c.json(
      await transact(
        c,
        (ctx) => c.get("presence").get(ctx, recordId(c)),
        false,
      ),
    ),
  )
  .get(
    "/workspaces/:workspaceId/projects/:id/members",
    validate(
      "query",
      listQuery(PROJECT_MEMBER_SORTS, {
        role: z.enum(["contributor", "viewer"]).optional(),
        query: search,
      }),
    ),
    async (c) =>
      c.json(
        await transact(
          c,
          (ctx) => getProjectMembers(ctx, recordId(c), c.req.valid("query")),
          false,
        ),
      ),
  )
  .delete(
    "/workspaces/:workspaceId/projects/:id/members/:userId",
    async (c) => {
      await transact(c, async (ctx) => {
        const userId = z.string().max(128).parse(c.req.param("userId"));
        await assertNoOpenOwnedTasks(ctx, userId, recordId(c));
        await deleteProjectMember(ctx, recordId(c), userId);
      });
      return c.json({ ok: true });
    },
  )
  .patch(
    "/workspaces/:workspaceId/projects/:id/members/:userId",
    validate("json", z.object({ role: z.enum(["viewer", "contributor"]) })),
    async (c) => {
      await transact(c, async (ctx) => {
        const userId = z.string().max(128).parse(c.req.param("userId"));
        if (c.req.valid("json").role !== "contributor")
          await assertNoOpenOwnedTasks(ctx, userId, recordId(c));
        await updateProjectMember(
          ctx,
          recordId(c),
          userId,
          c.req.valid("json").role,
        );
      });
      return c.json({ ok: true });
    },
  )
  .post(
    "/workspaces/:workspaceId/tasks/capture",
    validate(
      "json",
      z.object({
        projectId: id,
        title,
        chatId: id,
        messageId: id,
        ownerId: z.string().max(128).optional(),
      }),
    ),
    async (c) =>
      c.json(
        await transact(c, (ctx) =>
          captureTask(ctx, c.get("options").nativeStorage, c.req.valid("json")),
        ),
      ),
  )
  .post(
    "/workspaces/:workspaceId/tasks/:id/links",
    validate(
      "json",
      z.object({
        type: z.enum(["document", "chat", "file", "url"]),
        reference: z.string().max(2048),
      }),
    ),
    async (c) => {
      await transact(c, async (ctx) => {
        const link = c.req.valid("json");
        await authorizeLink(ctx, link);
        await createTaskLink(ctx, recordId(c), link);
      });
      return c.json({ ok: true });
    },
  )
  .get(
    "/workspaces/:workspaceId/tasks/:id/links",
    validate(
      "query",
      listQuery(TASK_LINK_SORTS, {
        type: z.enum(["document", "chat", "file", "url"]).optional(),
      }),
    ),
    async (c) =>
      c.json(
        await transact(
          c,
          async (ctx) => {
            const links = await getTaskLinks(
              ctx,
              recordId(c),
              c.req.valid("query"),
            );
            const items = [];
            for (const link of links.items) {
              try {
                await authorizeLink(ctx, link);
                items.push(link);
              } catch (error) {
                if (
                  !(error instanceof DomainError) ||
                  !["forbidden", "not_found"].includes(error.code)
                )
                  throw error;
              }
            }
            return { items, next: links.next };
          },
          false,
        ),
      ),
  )
  .delete("/workspaces/:workspaceId/tasks/:id/links/:linkId", async (c) => {
    await transact(c, (ctx) =>
      deleteTaskLink(ctx, recordId(c), id.parse(c.req.param("linkId"))),
    );
    return c.json({ ok: true });
  })
  .patch(
    "/workspaces/:workspaceId/chats/:id/participants/:participantId",
    validate("json", z.object({ role: z.enum(["viewer", "contributor"]) })),
    async (c) => {
      await transact(c, (ctx) =>
        updateParticipant(
          ctx,
          recordId(c),
          id.parse(c.req.param("participantId")),
          c.req.valid("json").role,
        ),
      );
      return c.json({ ok: true });
    },
  )
  .get(
    "/workspaces/:workspaceId/projects",
    validate(
      "query",
      listQuery(PROJECT_SORTS, { archived: flag, query: search }),
    ),
    async (c) =>
      c.json(
        await transact(
          c,
          (ctx) => getProjects(ctx, c.req.valid("query")),
          false,
        ),
      ),
  )
  .get("/workspaces/:workspaceId/projects/:id", async (c) =>
    c.json(await transact(c, (ctx) => getProject(ctx, recordId(c)), false)),
  )
  .patch(
    "/workspaces/:workspaceId/projects/:id",
    validate(
      "json",
      z
        .object({
          title: title.optional(),
          repositoryUrl: z.url().max(2048).nullable().optional(),
        })
        .strict(),
    ),
    async (c) =>
      c.json(
        await transact(c, async (ctx) => {
          return updateProject(ctx, recordId(c), c.req.valid("json"));
        }),
      ),
  )
  .post(
    "/workspaces/:workspaceId/projects/:id/archive",
    validate("json", z.object({ archived: z.boolean() })),
    async (c) => {
      await transact(c, (ctx) =>
        archiveProject(ctx, recordId(c), c.req.valid("json").archived),
      );
      return c.json({ ok: true });
    },
  )
  .get(
    "/workspaces/:workspaceId/tasks",
    validate(
      "query",
      listQuery(TASK_SORTS, {
        projectId: id,
        archived: flag,
        query: search,
        status: z.enum(["todo", "doing", "done"]).optional(),
        ownerId: z.string().max(128).optional(),
        assigneeUserId: z.string().max(128).optional(),
        assigneeAgentId: id.optional(),
        dueFrom: dateTime,
        dueTo: dateTime,
      }),
    ),
    async (c) =>
      c.json(
        await transact(c, (ctx) => getTasks(ctx, c.req.valid("query")), false),
      ),
  )
  .patch(
    "/workspaces/:workspaceId/tasks/:id",
    validate(
      "json",
      z
        .object({
          title: title.optional(),
          notes: body.optional(),
          ownerId: z.string().min(1).max(128).optional(),
          ...taskSchedule,
          ...assignees,
          editToken,
        })
        .strict(),
    ),
    async (c) =>
      c.json(
        await transact(c, (ctx) =>
          updateTask(ctx, recordId(c), c.req.valid("json")),
        ),
      ),
  )
  .post(
    "/workspaces/:workspaceId/tasks/:id/archive",
    validate("json", archive),
    async (c) =>
      c.json(
        await transact(c, (ctx) =>
          archiveTask(
            ctx,
            recordId(c),
            c.req.valid("json").archived,
            c.req.valid("json").editToken,
          ),
        ),
      ),
  )
  .get(
    "/workspaces/:workspaceId/chats",
    validate(
      "query",
      listQuery(CHAT_SORTS, {
        projectId: id.optional(),
        archived: flag,
        query: search,
        visibility: z.enum(["workspace", "participants"]).optional(),
        createdBy: z.string().min(1).max(128).optional(),
      }),
    ),
    async (c) =>
      c.json(
        await transact(c, (ctx) => getChats(ctx, c.req.valid("query")), false),
      ),
  )
  .get("/workspaces/:workspaceId/chats/:id", async (c) =>
    c.json(await transact(c, (ctx) => getChat(ctx, recordId(c)), false)),
  )
  .get(
    "/workspaces/:workspaceId/chats/:id/participants",
    validate(
      "query",
      listQuery(PARTICIPANT_SORTS, {
        role: z.enum(["contributor", "viewer"]).optional(),
        type: z.enum(["human", "agent"]).optional(),
      }),
    ),
    async (c) =>
      c.json(
        await transact(
          c,
          (ctx) => getParticipants(ctx, recordId(c), c.req.valid("query")),
          false,
        ),
      ),
  )
  .patch(
    "/workspaces/:workspaceId/chats/:id",
    validate("json", z.object({ title }).strict()),
    async (c) =>
      c.json(
        await transact(c, (ctx) =>
          updateChat(ctx, recordId(c), c.req.valid("json")),
        ),
      ),
  )
  .post(
    "/workspaces/:workspaceId/chats/:id/archive",
    validate("json", z.object({ archived: z.boolean() })),
    async (c) =>
      c.json(
        await transact(c, (ctx) =>
          archiveChat(ctx, recordId(c), c.req.valid("json").archived),
        ),
      ),
  )
  .post(
    "/workspaces/:workspaceId/chats/:id/messages",
    validate(
      "json",
      z
        .object({
          body: body.min(1),
          requestId: id,
          replyTo: id.optional(),
          mentionUserIds: z.array(z.string().max(128)).max(50).optional(),
          fileIds: z.array(id).max(30).optional(),
        })
        .strict(),
    ),
    async (c) =>
      c.json(
        await createChatMessage(
          c.get("options"),
          workspaceId(c),
          { userId: c.get("userId") },
          recordId(c),
          c.req.valid("json"),
          async (ctx) => {
            const input = c.req.valid("json");
            // Participants read what is attached to the Chat; only the custodian attaches a private File.
            if (input.fileIds?.length) {
              const audience = await getChatAudience(ctx, recordId(c));
              for (const fileId of input.fileIds) {
                const file = await requireFileAudience(
                  ctx,
                  fileId,
                  audience.humans,
                  true,
                );
                if (
                  file.ownerId !== ctx.actor.userId &&
                  file.visibility === "user"
                )
                  throw new DomainError("forbidden");
              }
            }
          },
        ),
      ),
  )
  .post(
    "/workspaces/:workspaceId/chats/:id/read",
    validate("json", z.object({ cursor: editToken })),
    async (c) => {
      await transact(c, (ctx) =>
        markChatRead(ctx, recordId(c), c.req.valid("json").cursor),
      );
      return c.json({ ok: true });
    },
  );
