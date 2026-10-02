import { zValidator } from "@hono/zod-validator";
import { createAgent } from "@otto/agents";
import {
  type ArtifactStorage,
  archiveArtifact,
  getArtifact,
  getArtifacts,
  readArtifact,
  saveArtifact,
} from "@otto/artifacts";
import {
  assertNoOwnedAutomations,
  createAutomation,
  getAutomation,
  runAutomation,
  saveAutomation,
} from "@otto/automations";
import {
  createConnection,
  disconnectConnection,
  grantConnection,
} from "@otto/connections";
import {
  addParticipant,
  createConversation,
  createMessage,
  getMessages,
  removeParticipant,
} from "@otto/conversations";
import { type Database, DomainError } from "@otto/db";
import {
  createCollection,
  createDocument,
  getDocument,
  putDocumentInCollection,
  saveDocument,
} from "@otto/documents";
import { createEnvironment } from "@otto/environments";
import { addProjectMember, createProject, getProjects } from "@otto/projects";
import { admitRun, getRun, stopRun } from "@otto/runs";
import {
  assertNoOpenOwnedTasks,
  assignTask,
  createTask,
  getTask,
  getTasks,
  setTaskStatus,
  transferTask,
} from "@otto/tasks";
import {
  acceptInvitation,
  type Context,
  createInvitation,
  getWorkspaces,
  inWorkspace,
  removeMember,
  revokeInvitation,
} from "@otto/workspaces";
import { Hono, type Context as HonoContext } from "hono";
import type { PgBoss } from "pg-boss";
import { z } from "zod";
import type { Auth } from "./auth";
export interface ApiOptions {
  db: Database;
  auth: Auth;
  boss: PgBoss;
  origin: string;
  storage?: ArtifactStorage;
}
interface Variables {
  userId: string;
}
const id = z.uuid();
const title = z.string().trim().min(1).max(200);
const body = z
  .string()
  .max(100000)
  .refine(
    (value) => new TextEncoder().encode(value).length <= 100000,
    "Body exceeds byte limit",
  );
const editToken = z.number().int().nonnegative();
const ids = z.array(id).max(50);
const automationInput = z.object({
  name: title,
  agentId: id,
  conversationId: id,
  kind: z.enum(["prompt", "script"]),
  body,
  skillIds: ids.default([]),
  cron: z.string().max(100).optional(),
  timezone: z.string().max(100).default("UTC"),
  enabled: z.boolean().default(false),
});
const field = z.object({
  id,
  name: title,
  type: z.enum([
    "text",
    "number",
    "date",
    "checkbox",
    "select",
    "human",
    "agent",
    "document",
  ]),
  options: z.array(title).max(100).optional(),
});
/** All browser writes enter domain functions under a current authenticated workspace transaction. */
export function createApi(options: ApiOptions) {
  const { db, auth, boss } = options;
  const run = <T>(
    c: HonoContext<{ Variables: Variables }>,
    fn: (context: Context) => Promise<T>,
    write = true,
  ) =>
    inWorkspace(
      db,
      id.parse(c.req.param("workspaceId")),
      { userId: c.get("userId") },
      fn,
      write,
    );
  return new Hono<{ Variables: Variables }>()
    .use("*", async (c, next) => {
      if (
        !["GET", "HEAD", "OPTIONS"].includes(c.req.method) &&
        c.req.header("origin") !== options.origin
      )
        throw new DomainError("forbidden");
      const session = await auth.api.getSession({ headers: c.req.raw.headers });
      if (!session) return c.json({ error: "unauthenticated" }, 401);
      c.set("userId", session.user.id);
      await next();
    })
    .get("/workspaces", async (c) =>
      c.json(await getWorkspaces(db, c.get("userId"))),
    )
    .post("/invitations/:id/accept", async (c) =>
      c.json(
        await acceptInvitation(
          db,
          c.get("userId"),
          id.parse(c.req.param("id")),
        ),
      ),
    )
    .post(
      "/workspaces/:workspaceId/invitations",
      zValidator(
        "json",
        z.object({
          email: z.email().max(254),
          role: z.enum(["admin", "contributor", "viewer"]),
        }),
      ),
      async (c) =>
        c.json(
          await run(c, (ctx) => createInvitation(ctx, c.req.valid("json"))),
        ),
    )
    .post("/workspaces/:workspaceId/invitations/:id/revoke", async (c) =>
      c.json(
        await run(c, (ctx) =>
          revokeInvitation(ctx, id.parse(c.req.param("id"))),
        ),
      ),
    )
    .post("/workspaces/:workspaceId/members/:userId/remove", async (c) => {
      await run(c, async (ctx) => {
        const userId = c.req.param("userId");
        await assertNoOpenOwnedTasks(ctx, userId);
        await assertNoOwnedAutomations(ctx, userId);
        await removeMember(ctx, userId);
      });
      return c.json({ removed: true });
    })
    .get("/workspaces/:workspaceId/projects", async (c) =>
      c.json(await run(c, getProjects, false)),
    )
    .post(
      "/workspaces/:workspaceId/projects",
      zValidator(
        "json",
        z.object({ name: title, repositoryUrl: z.url().max(2048).optional() }),
      ),
      async (c) =>
        c.json(await run(c, (ctx) => createProject(ctx, c.req.valid("json")))),
    )
    .post(
      "/workspaces/:workspaceId/projects/:id/members",
      zValidator(
        "json",
        z.object({
          userId: z.string().max(128),
          role: z.enum(["contributor", "viewer"]),
        }),
      ),
      async (c) => {
        await run(c, (ctx) =>
          addProjectMember(
            ctx,
            id.parse(c.req.param("id")),
            c.req.valid("json").userId,
            c.req.valid("json").role,
          ),
        );
        return c.json({ saved: true });
      },
    )
    .get("/workspaces/:workspaceId/projects/:id/tasks", async (c) =>
      c.json(
        await run(
          c,
          (ctx) => getTasks(ctx, id.parse(c.req.param("id"))),
          false,
        ),
      ),
    )
    .post(
      "/workspaces/:workspaceId/tasks",
      zValidator(
        "json",
        z.object({
          projectId: id,
          title,
          notes: body.optional(),
          ownerId: z.string().max(128).optional(),
        }),
      ),
      async (c) =>
        c.json(await run(c, (ctx) => createTask(ctx, c.req.valid("json")))),
    )
    .get("/workspaces/:workspaceId/tasks/:id", async (c) =>
      c.json(
        await run(c, (ctx) => getTask(ctx, id.parse(c.req.param("id"))), false),
      ),
    )
    .post(
      "/workspaces/:workspaceId/tasks/:id/assignee",
      zValidator(
        "json",
        z.object({
          userId: z.string().max(128).optional(),
          agentId: id.optional(),
        }),
      ),
      async (c) =>
        c.json(
          await run(c, (ctx) =>
            assignTask(ctx, id.parse(c.req.param("id")), c.req.valid("json")),
          ),
        ),
    )
    .post(
      "/workspaces/:workspaceId/tasks/:id/status",
      zValidator(
        "json",
        z.object({ status: z.enum(["todo", "doing", "done"]), editToken }),
      ),
      async (c) =>
        c.json(
          await run(c, (ctx) =>
            setTaskStatus(
              ctx,
              id.parse(c.req.param("id")),
              c.req.valid("json"),
            ),
          ),
        ),
    )
    .post(
      "/workspaces/:workspaceId/tasks/:id/owner",
      zValidator("json", z.object({ userId: z.string().max(128) })),
      async (c) => {
        await run(c, (ctx) =>
          transferTask(
            ctx,
            id.parse(c.req.param("id")),
            c.req.valid("json").userId,
          ),
        );
        return c.json({ saved: true });
      },
    )
    .post(
      "/workspaces/:workspaceId/conversations",
      zValidator(
        "json",
        z.object({
          title,
          projectId: id.optional(),
          access: z.enum(["inherited", "restricted"]),
        }),
      ),
      async (c) =>
        c.json(
          await run(c, (ctx) => createConversation(ctx, c.req.valid("json"))),
        ),
    )
    .post(
      "/workspaces/:workspaceId/conversations/:id/participants",
      zValidator(
        "json",
        z.object({
          userId: z.string().max(128).optional(),
          agentId: id.optional(),
          role: z.enum(["contributor", "viewer"]),
        }),
      ),
      async (c) => {
        await run(c, (ctx) =>
          addParticipant(ctx, id.parse(c.req.param("id")), c.req.valid("json")),
        );
        return c.json({ saved: true });
      },
    )
    .post(
      "/workspaces/:workspaceId/conversations/:id/participants/:participantId/remove",
      async (c) => {
        await run(c, (ctx) =>
          removeParticipant(
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
      zValidator(
        "query",
        z.object({ after: z.coerce.number().int().nonnegative().default(0) }),
      ),
      async (c) =>
        c.json(
          await run(
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
    .post(
      "/workspaces/:workspaceId/conversations/:id/messages",
      zValidator(
        "json",
        z.object({ body: body.min(1), requestId: id, replyTo: id.optional() }),
      ),
      async (c) =>
        c.json(
          await run(c, (ctx) =>
            createMessage(
              ctx,
              id.parse(c.req.param("id")),
              c.req.valid("json"),
            ),
          ),
        ),
    )
    .post(
      "/workspaces/:workspaceId/agents",
      zValidator(
        "json",
        z.object({
          name: title,
          instructions: body,
          harness: title,
          harnessRelease: title,
          model: title,
          projectId: id.optional(),
          accountConnectionId: id.optional(),
          skillIds: ids.optional(),
        }),
      ),
      async (c) =>
        c.json(
          await run(c, async (ctx) => {
            const agent = await createAgent(ctx, c.req.valid("json"));
            const environment = await createEnvironment(ctx, agent.id);
            return {
              agent,
              environment: { id: environment.id, state: environment.state },
            };
          }),
        ),
    )
    .post(
      "/workspaces/:workspaceId/documents",
      zValidator(
        "json",
        z.object({
          title,
          body,
          projectId: id.optional(),
          access: z.enum(["inherited", "restricted"]),
          readerIds: z.array(z.string().max(128)).max(100).optional(),
          skill: z.boolean().optional(),
          whenToUse: title.optional(),
        }),
      ),
      async (c) =>
        c.json(await run(c, (ctx) => createDocument(ctx, c.req.valid("json")))),
    )
    .get("/workspaces/:workspaceId/documents/:id", async (c) =>
      c.json(
        await run(
          c,
          (ctx) => getDocument(ctx, id.parse(c.req.param("id"))),
          false,
        ),
      ),
    )
    .post(
      "/workspaces/:workspaceId/documents/:id",
      zValidator("json", z.object({ title, body, editToken })),
      async (c) =>
        c.json(
          await run(c, (ctx) =>
            saveDocument(ctx, id.parse(c.req.param("id")), c.req.valid("json")),
          ),
        ),
    )
    .post(
      "/workspaces/:workspaceId/collections",
      zValidator(
        "json",
        z.object({
          title,
          projectId: id.optional(),
          fields: z.array(field).max(50),
        }),
      ),
      async (c) =>
        c.json(
          await run(c, (ctx) => createCollection(ctx, c.req.valid("json"))),
        ),
    )
    .post(
      "/workspaces/:workspaceId/documents/:id/collection",
      zValidator(
        "json",
        z.object({
          collectionId: id,
          editToken,
          properties: z.record(
            z.string().max(128),
            z.union([
              z.string().max(5000),
              z.number().finite(),
              z.boolean(),
              z.null(),
            ]),
          ),
        }),
      ),
      async (c) =>
        c.json(
          await run(c, (ctx) => {
            const input = c.req.valid("json");
            return putDocumentInCollection(
              ctx,
              id.parse(c.req.param("id")),
              input.collectionId,
              input.properties,
              input.editToken,
            );
          }),
        ),
    )
    .post(
      "/workspaces/:workspaceId/runs",
      zValidator(
        "json",
        z.object({
          conversationId: id,
          agentId: id,
          requestId: id,
          kind: z.enum(["prompt", "script"]),
          body,
          taskId: id.optional(),
          sessionId: id.optional(),
          skillIds: ids.optional(),
        }),
      ),
      async (c) =>
        c.json(await run(c, (ctx) => admitRun(ctx, boss, c.req.valid("json")))),
    )
    .get("/workspaces/:workspaceId/runs/:id", async (c) =>
      c.json(
        await run(c, (ctx) => getRun(ctx, id.parse(c.req.param("id"))), false),
      ),
    )
    .post("/workspaces/:workspaceId/runs/:id/stop", async (c) =>
      c.json(await run(c, (ctx) => stopRun(ctx, id.parse(c.req.param("id"))))),
    )
    .post(
      "/workspaces/:workspaceId/automations",
      zValidator("json", automationInput),
      async (c) =>
        c.json(
          await run(c, (ctx) =>
            createAutomation(ctx, boss, c.req.valid("json")),
          ),
        ),
    )
    .get("/workspaces/:workspaceId/automations/:id", async (c) =>
      c.json(
        await run(
          c,
          (ctx) => getAutomation(ctx, id.parse(c.req.param("id"))),
          false,
        ),
      ),
    )
    .post(
      "/workspaces/:workspaceId/automations/:id",
      zValidator("json", automationInput.extend({ editToken })),
      async (c) =>
        c.json(
          await run(c, (ctx) =>
            saveAutomation(
              ctx,
              boss,
              id.parse(c.req.param("id")),
              c.req.valid("json"),
            ),
          ),
        ),
    )
    .post(
      "/workspaces/:workspaceId/automations/:id/run",
      zValidator("json", z.object({ requestId: id })),
      async (c) =>
        c.json(
          await run(c, (ctx) =>
            runAutomation(
              ctx,
              boss,
              id.parse(c.req.param("id")),
              c.req.valid("json").requestId,
            ),
          ),
        ),
    )
    .post(
      "/workspaces/:workspaceId/connections",
      zValidator(
        "json",
        z.object({
          name: title,
          kind: z.enum(["github", "mcp", "model"]),
          accountRef: title,
          mode: z.enum(["service", "native_subscription"]),
        }),
      ),
      async (c) =>
        c.json(
          await run(c, (ctx) => createConnection(ctx, c.req.valid("json"))),
        ),
    )
    .post(
      "/workspaces/:workspaceId/connections/:id/grants",
      zValidator(
        "json",
        z.object({
          agentId: id,
          resources: z.array(title).max(100),
          operations: z.record(
            z.string().max(100),
            z.enum(["allowed", "confirmation", "disabled"]),
          ),
        }),
      ),
      async (c) => {
        await run(c, (ctx) =>
          grantConnection(
            ctx,
            id.parse(c.req.param("id")),
            c.req.valid("json"),
          ),
        );
        return c.json({ saved: true });
      },
    )
    .post("/workspaces/:workspaceId/connections/:id/disconnect", async (c) => {
      await run(c, (ctx) =>
        disconnectConnection(ctx, id.parse(c.req.param("id"))),
      );
      return c.json({
        disconnected: true,
        remainingCredentialLifetime: "provider_not_connected",
      });
    })
    .get(
      "/workspaces/:workspaceId/artifacts",
      zValidator(
        "query",
        z.object({
          projectId: id.optional(),
          after: id.optional(),
          kind: title.optional(),
          label: title.optional(),
          archived: z.enum(["true", "false"]).optional(),
        }),
      ),
      async (c) => {
        const filter = c.req.valid("query");
        return c.json(
          await run(
            c,
            (ctx) =>
              getArtifacts(ctx, {
                ...filter,
                archived: filter.archived === "true",
              }),
            false,
          ),
        );
      },
    )
    .post(
      "/workspaces/:workspaceId/artifacts/:id/archive",
      zValidator("json", z.object({ archived: z.boolean() })),
      async (c) => {
        await run(c, (ctx) =>
          archiveArtifact(
            ctx,
            id.parse(c.req.param("id")),
            c.req.valid("json").archived,
          ),
        );
        return c.json({ saved: true });
      },
    )
    .get("/workspaces/:workspaceId/artifacts/:id", async (c) =>
      c.json(
        await run(
          c,
          (ctx) => getArtifact(ctx, id.parse(c.req.param("id"))),
          false,
        ),
      ),
    )
    .post(
      "/workspaces/:workspaceId/artifacts",
      zValidator(
        "json",
        z.object({
          requestId: id,
          title,
          kind: title,
          labels: z.array(title).max(20).optional(),
          projectId: id.optional(),
          access: z.enum(["inherited", "restricted"]),
          mediaType: title,
          bytes: z.string().max(700000),
        }),
      ),
      async (c) => {
        if (!options.storage)
          throw new DomainError("unavailable", "Storage not configured");
        const { bytes, ...input } = c.req.valid("json");
        return c.json(
          await saveArtifact(
            db,
            options.storage,
            id.parse(c.req.param("workspaceId")),
            { userId: c.get("userId") },
            input,
            Buffer.from(bytes, "base64"),
          ),
        );
      },
    )
    .get("/workspaces/:workspaceId/artifacts/:id/file", async (c) => {
      if (!options.storage) throw new DomainError("unavailable");
      const bytes = await readArtifact(
        db,
        options.storage,
        id.parse(c.req.param("workspaceId")),
        { userId: c.get("userId") },
        id.parse(c.req.param("id")),
      );
      return new Response(new Uint8Array(bytes), {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": "attachment",
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "private, no-store",
        },
      });
    });
}
export type RpcApp = ReturnType<typeof createApi>;
