import { answerRunQuestion } from "@otto/runs";
import { assertNoOwnedSchedules } from "@otto/schedules";
import { DomainError } from "@otto/shared";
import { assertNoOpenOwnedTasks } from "@otto/tasks";
import {
  acceptInvitation,
  createInvitation,
  deleteMember,
  getInvitation,
  getMembers,
  getWorkspaces,
  MEMBER_SORTS,
  updateInvitation,
  updateMemberRole,
  WORKSPACE_SORTS,
} from "@otto/workspaces";
import { Hono } from "hono";
import { z } from "zod";
import { getAttention } from "./attention";
import { collaborationApi } from "./collaboration-api";
import { connectionApi } from "./connection-api";
import { contentApi, publicSharesApi } from "./content-api";
import { createContentPresence } from "./content-presence";
import { executionApi } from "./execution-api";
import { foldersApi } from "./folders-api";
import type { ApiOptions } from "./http";
import { type ApiEnv, transact } from "./http";
import { sendInvitation } from "./invitations";
import { nativeActionsApi } from "./native-actions-api";
import { skillsApi } from "./skills-api";
import { subscriptionApi } from "./subscription-api";
import { taskCommentsApi } from "./task-comments-api";
import { transcriptionApi } from "./transcription-api";
import { flag, id, listQuery, pageQuery, validate } from "./validation";
/** One authentication/origin boundary. Public shares expose frozen selections before it. */
export function createApi(options: ApiOptions) {
  const presence = createContentPresence();
  return new Hono<ApiEnv>()
    .use("*", async (c, next) => {
      c.set("options", options);
      c.set("presence", presence);
      c.header("Cache-Control", "no-store");
      c.header("X-Content-Type-Options", "nosniff");
      c.header("Referrer-Policy", "no-referrer");
      await next();
    })
    .route("/", publicSharesApi)
    .use("*", async (c, next) => {
      if (
        !["GET", "HEAD", "OPTIONS"].includes(c.req.method) &&
        c.req.header("origin") !== options.origin
      )
        throw new DomainError("forbidden");
      const session = await options.auth.api.getSession({
        headers: c.req.raw.headers,
      });
      if (!session) return c.json({ error: "unauthenticated" }, 401);
      c.set("userId", session.user.id);
      await next();
    })
    .route("/", collaborationApi)
    .route("/", taskCommentsApi)
    .route("/", nativeActionsApi)
    .route("/", contentApi)
    .route("/", foldersApi)
    .route("/", skillsApi)
    .route("/", executionApi)
    .route("/", connectionApi)
    .route("/", subscriptionApi)
    .route("/", transcriptionApi)
    .get(
      "/workspaces",
      validate(
        "query",
        listQuery(WORKSPACE_SORTS, {
          role: z.enum(["owner", "admin", "contributor", "viewer"]).optional(),
          query: z.string().max(200).optional(),
        }),
      ),
      async (c) =>
        c.json(
          await getWorkspaces(
            options.db,
            c.get("userId"),
            c.req.valid("query"),
            options.cursors,
          ),
        ),
    )
    .post("/invitations/:id/accept", async (c) =>
      c.json(
        await acceptInvitation(
          options.db,
          c.get("userId"),
          id.parse(c.req.param("id")),
        ),
      ),
    )
    .post(
      "/workspaces/:workspaceId/invitations",
      validate(
        "json",
        z.object({
          email: z.email().max(254),
          role: z.enum(["admin", "contributor", "viewer"]),
        }),
      ),
      async (c) => {
        const invitation = await transact(c, (ctx) =>
          createInvitation(ctx, c.req.valid("json")),
        );
        const delivery = await sendInvitation({
          mail: options.mail,
          origin: options.origin,
          invitation,
        });
        return c.json({ ...invitation, delivery });
      },
    )
    .post("/workspaces/:workspaceId/invitations/:id/send", async (c) => {
      const invitation = await transact(
        c,
        (ctx) => getInvitation(ctx, id.parse(c.req.param("id"))),
        false,
      );
      return c.json({
        delivery: await sendInvitation({
          mail: options.mail,
          origin: options.origin,
          invitation,
        }),
      });
    })
    .patch(
      "/workspaces/:workspaceId/invitations/:id",
      validate("json", z.object({ status: z.literal("revoked") }).strict()),
      async (c) =>
        c.json(
          await transact(c, (ctx) =>
            updateInvitation(
              ctx,
              id.parse(c.req.param("id")),
              c.req.valid("json"),
            ),
          ),
        ),
    )
    .get(
      "/workspaces/:workspaceId/members",
      validate(
        "query",
        listQuery(MEMBER_SORTS, {
          role: z.enum(["owner", "admin", "contributor", "viewer"]).optional(),
          query: z.string().max(200).optional(),
        }),
      ),
      async (c) =>
        c.json(
          await transact(
            c,
            (ctx) => getMembers(ctx, c.req.valid("query")),
            false,
          ),
        ),
    )
    .post(
      "/workspaces/:workspaceId/members/:userId/role",
      validate(
        "json",
        z.object({ role: z.enum(["admin", "contributor", "viewer"]) }),
      ),
      async (c) => {
        const result = await transact(c, async (ctx) => {
          const userId = c.req.param("userId");
          const { role } = c.req.valid("json");
          if (role === "viewer") {
            await assertNoOpenOwnedTasks(ctx, userId);
            await assertNoOwnedSchedules(ctx, userId);
          }
          return updateMemberRole(ctx, userId, role);
        });
        return c.json(result);
      },
    )
    .delete("/workspaces/:workspaceId/members/:userId", async (c) => {
      await transact(c, async (ctx) => {
        const userId = c.req.param("userId");
        await assertNoOpenOwnedTasks(ctx, userId);
        await assertNoOwnedSchedules(ctx, userId);
        await deleteMember(ctx, userId);
      });
      return c.json({ deleted: true });
    })
    .post(
      "/workspaces/:workspaceId/questions/:id/answer",
      validate("json", z.object({ body: z.string().min(1).max(16000) })),
      async (c) =>
        c.json(
          await transact(c, (ctx) =>
            answerRunQuestion(
              ctx,
              id.parse(c.req.param("id")),
              c.req.valid("json").body,
            ),
          ),
        ),
    )
    .get(
      "/workspaces/:workspaceId/attention",
      validate(
        "query",
        pageQuery
          .extend({
            runAfter: id.optional(),
            questionAfter: id.optional(),
            operationAfter: id.optional(),
            mentionsOnly: flag,
          })
          .strict(),
      ),
      async (c) =>
        c.json(
          await transact(
            c,
            (ctx) =>
              getAttention(ctx, c.req.valid("query"), options.nativeStorage),
            false,
          ),
        ),
    );
}
export type RpcApp = ReturnType<typeof createApi>;
