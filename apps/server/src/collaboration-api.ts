import { getArtifact, requireArtifactAudience } from "@otto/artifacts";
import {
  archiveConversation,
  createConversation,
  createMessage,
  createParticipant,
  deleteParticipant,
  getConversation,
  getConversationAudience,
  getConversations,
  getMessage,
  getMessages,
  getParticipants,
  markConversationRead,
  updateConversation,
  updateParticipant,
} from "@otto/conversations";
import { getDocument } from "@otto/documents";
import {
  archiveProject,
  createProject,
  deleteProjectMember,
  getProject,
  getProjectAudience,
  getProjectMembers,
  getProjects,
  updateProject,
  updateProjectMember,
  upsertProjectMember,
} from "@otto/projects";
import { getSessions } from "@otto/sessions";
import { DomainError } from "@otto/shared";
import {
  archiveTask,
  assertNoOpenProjectTasks,
  assignTask,
  createTask,
  createTaskLink,
  deleteTaskLink,
  getTask,
  getTaskLinks,
  getTasks,
  setTaskStatus,
  updateTask,
} from "@otto/tasks";
import type { Context } from "@otto/workspaces";
import { Hono } from "hono";
import { z } from "zod";
import { type ApiEnv, recordId, transact } from "./http";
import { body, editToken, id, pageQuery, title, validate } from "./validation";

const archive = z.object({ archived: z.boolean(), editToken });
const query = pageQuery.extend({
  projectId: id.optional(),
  archived: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  query: z.string().max(200).optional(),
});
const authorizeLink = async (
  ctx: Context,
  link: {
    type: "document" | "conversation" | "artifact" | "url";
    reference: string;
  },
) => {
  if (link.type === "document")
    await getDocument(ctx, id.parse(link.reference));
  else if (link.type === "conversation")
    await getConversation(ctx, id.parse(link.reference));
  else if (link.type === "artifact")
    await getArtifact(ctx, id.parse(link.reference));
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
      z.object({ name: title, repositoryUrl: z.url().max(2048).optional() }),
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
    "/workspaces/:workspaceId/tasks/:id/assignee",
    validate(
      "json",
      z.object({
        userId: z.string().max(128).optional(),
        agentId: id.optional(),
      }),
    ),
    async (c) =>
      c.json(
        await transact(c, (ctx) =>
          assignTask(ctx, id.parse(c.req.param("id")), c.req.valid("json")),
        ),
      ),
  )
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
    "/workspaces/:workspaceId/conversations",
    validate(
      "json",
      z.object({
        title,
        projectId: id.optional(),
        access: z.enum(["inherited", "restricted"]),
      }),
    ),
    async (c) =>
      c.json(
        await transact(c, (ctx) =>
          createConversation(ctx, c.req.valid("json")),
        ),
      ),
  )
  .post(
    "/workspaces/:workspaceId/conversations/:id/participants",
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
    "/workspaces/:workspaceId/conversations/:id/participants/:participantId",
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
    "/workspaces/:workspaceId/conversations/:id/messages",
    validate(
      "query",
      z.object({ after: z.coerce.number().int().nonnegative().default(0) }),
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
            ),
          false,
        ),
      ),
  )
  .get(
    "/workspaces/:workspaceId/conversations/:id/sessions",
    validate("query", pageQuery),
    async (c) =>
      c.json(
        await transact(
          c,
          async (ctx) => {
            const conversationId = id.parse(c.req.param("id"));
            await getConversation(ctx, conversationId);
            return getSessions(ctx, conversationId, c.req.valid("query"));
          },
          false,
        ),
      ),
  )
  .put(
    "/workspaces/:workspaceId/conversations/:id/presence",
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
  .get("/workspaces/:workspaceId/conversations/:id/presence", async (c) =>
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
    validate("query", pageQuery),
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
        await assertNoOpenProjectTasks(ctx, recordId(c), userId);
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
          await assertNoOpenProjectTasks(ctx, recordId(c), userId);
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
        conversationId: id,
        messageId: id,
        ownerId: z.string().max(128).optional(),
      }),
    ),
    async (c) =>
      c.json(
        await transact(c, async (ctx) => {
          const input = c.req.valid("json");
          const message = await getMessage(
            ctx,
            input.conversationId,
            input.messageId,
          );
          const audience = await getConversationAudience(
            ctx,
            input.conversationId,
          );
          const destination = await getProjectAudience(ctx, input.projectId);
          if (destination.some((userId) => !audience.humans.includes(userId)))
            throw new DomainError(
              "forbidden",
              "Capture would widen the source audience",
            );
          const task = await createTask(ctx, {
            projectId: input.projectId,
            title: input.title,
            notes: message.body,
            ownerId: input.ownerId,
          });
          await createTaskLink(ctx, task.id, {
            type: "conversation",
            reference: input.conversationId,
          });
          return task;
        }),
      ),
  )
  .post(
    "/workspaces/:workspaceId/tasks/:id/links",
    validate(
      "json",
      z.object({
        type: z.enum(["document", "conversation", "artifact", "url"]),
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
    validate("query", pageQuery),
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
    "/workspaces/:workspaceId/conversations/:id/participants/:participantId",
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
    validate("query", query),
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
          name: title.optional(),
          repositoryUrl: z.url().max(2048).nullable().optional(),
          editToken,
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
      query.extend({
        projectId: id,
        status: z.enum(["todo", "doing", "done"]).optional(),
        ownerId: z.string().max(128).optional(),
        assigneeUserId: z.string().max(128).optional(),
        assigneeAgentId: id.optional(),
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
    "/workspaces/:workspaceId/conversations",
    validate("query", query),
    async (c) =>
      c.json(
        await transact(
          c,
          (ctx) => getConversations(ctx, c.req.valid("query")),
          false,
        ),
      ),
  )
  .get("/workspaces/:workspaceId/conversations/:id", async (c) =>
    c.json(
      await transact(c, (ctx) => getConversation(ctx, recordId(c)), false),
    ),
  )
  .get(
    "/workspaces/:workspaceId/conversations/:id/participants",
    validate("query", pageQuery),
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
    "/workspaces/:workspaceId/conversations/:id",
    validate("json", z.object({ title, editToken })),
    async (c) =>
      c.json(
        await transact(c, (ctx) =>
          updateConversation(ctx, recordId(c), c.req.valid("json")),
        ),
      ),
  )
  .post(
    "/workspaces/:workspaceId/conversations/:id/archive",
    validate("json", archive),
    async (c) =>
      c.json(
        await transact(c, (ctx) =>
          archiveConversation(
            ctx,
            recordId(c),
            c.req.valid("json").archived,
            c.req.valid("json").editToken,
          ),
        ),
      ),
  )
  .post(
    "/workspaces/:workspaceId/conversations/:id/messages",
    validate(
      "json",
      z.object({
        body: body.min(1),
        requestId: id,
        replyTo: id.optional(),
        mentionUserIds: z.array(z.string().max(128)).max(50).optional(),
        artifactIds: z.array(id).max(30).optional(),
      }),
    ),
    async (c) =>
      c.json(
        await transact(c, async (ctx) => {
          const input = c.req.valid("json");
          if (input.artifactIds?.length) {
            const audience = await getConversationAudience(ctx, recordId(c));
            for (const artifactId of input.artifactIds)
              await requireArtifactAudience(ctx, artifactId, audience.humans);
          }
          return createMessage(ctx, recordId(c), input);
        }),
      ),
  )
  .post(
    "/workspaces/:workspaceId/conversations/:id/read",
    validate("json", z.object({ cursor: editToken })),
    async (c) => {
      await transact(c, (ctx) =>
        markConversationRead(ctx, recordId(c), c.req.valid("json").cursor),
      );
      return c.json({ ok: true });
    },
  );
