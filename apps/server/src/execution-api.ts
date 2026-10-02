import {
  archiveAgent,
  createAgent,
  getAgent,
  getAgents,
  updateAgent,
} from "@otto/agents";
import {
  createAutomation,
  getAutomation,
  getAutomationHistory,
  getAutomations,
  runAutomation,
  updateAutomation,
} from "@otto/automations";
import { getDocument } from "@otto/documents";
import { createEnvironment, getEnvironment } from "@otto/environments";
import { admitRun, getRun, getRunActivity, getRuns, stopRun } from "@otto/runs";
import { DomainError } from "@otto/shared";
import type { Context } from "@otto/workspaces";
import { Hono } from "hono";
import { z } from "zod";
import { type ApiEnv, transact } from "./http";
import {
  body,
  editToken,
  id,
  ids,
  pageQuery,
  title,
  validate,
} from "./validation";

const automationInput = z
  .object({
    title,
    agentId: id,
    conversationId: id,
    type: z.enum(["prompt", "script"]),
    body,
    taskId: id.optional(),
    cron: z.string().max(100).optional(),
    timezone: z.string().max(100).default("UTC"),
    status: z.enum(["enabled", "disabled", "archived"]).default("disabled"),
  })
  .strict();

async function validateSkills(c: Context, selected: string[] = []) {
  for (const id of selected) {
    const document = await getDocument(c, id);
    if (!document.skill || document.archived)
      throw new DomainError("invalid", "Skill unavailable");
  }
}

export const executionApi = new Hono<ApiEnv>()
  .get(
    "/workspaces/:workspaceId/agents",
    validate(
      "query",
      pageQuery.extend({
        projectId: id.optional(),
        archived: z.enum(["true", "false"]).optional(),
      }),
    ),
    async (c) =>
      c.json(
        await transact(
          c,
          (ctx) =>
            getAgents(ctx, {
              ...c.req.valid("query"),
              archived: c.req.valid("query").archived === "true",
            }),
          false,
        ),
      ),
  )
  .get("/workspaces/:workspaceId/agents/:id", async (c) =>
    c.json(
      await transact(
        c,
        (ctx) => getAgent(ctx, id.parse(c.req.param("id"))),
        false,
      ),
    ),
  )
  .patch(
    "/workspaces/:workspaceId/agents/:id",
    validate(
      "json",
      z
        .object({
          visibility: z.enum(["user", "workspace"]).optional(),
          title: title.optional(),
          instructions: body.optional(),
          harness: title.optional(),
          model: title.optional(),
          subscriptionId: id.nullable().optional(),
          skillIds: ids.optional(),
          editToken,
        })
        .strict(),
    ),
    async (c) =>
      c.json(
        await transact(c, async (ctx) => {
          await validateSkills(ctx, c.req.valid("json").skillIds);
          return updateAgent(
            ctx,
            id.parse(c.req.param("id")),
            c.req.valid("json"),
          );
        }),
      ),
  )
  .post(
    "/workspaces/:workspaceId/agents/:id/archive",
    validate("json", z.object({ archived: z.boolean() })),
    async (c) => {
      await transact(c, (ctx) =>
        archiveAgent(
          ctx,
          id.parse(c.req.param("id")),
          c.req.valid("json").archived,
        ),
      );
      return c.json({ archived: c.req.valid("json").archived });
    },
  )
  .get("/workspaces/:workspaceId/agents/:id/environment", async (c) =>
    c.json(
      await transact(
        c,
        async (ctx) => {
          const env = await getEnvironment(ctx, id.parse(c.req.param("id")));
          return {
            id: env.id,
            state: env.state,
            generation: env.generation,
            activeRunId: env.activeRunId,
          };
        },
        false,
      ),
    ),
  )
  .get(
    "/workspaces/:workspaceId/runs",
    validate("query", pageQuery.extend({ conversationId: id.optional() })),
    async (c) =>
      c.json(
        await transact(c, (ctx) => getRuns(ctx, c.req.valid("query")), false),
      ),
  )
  .get(
    "/workspaces/:workspaceId/automations",
    validate(
      "query",
      pageQuery.extend({
        status: z.enum(["enabled", "disabled", "archived"]).optional(),
      }),
    ),
    async (c) =>
      c.json(
        await transact(
          c,
          (ctx) => getAutomations(ctx, c.req.valid("query")),
          false,
        ),
      ),
  )
  .get(
    "/workspaces/:workspaceId/automations/:id/history",
    validate("query", pageQuery),
    async (c) =>
      c.json(
        await transact(
          c,
          (ctx) =>
            getAutomationHistory(
              ctx,
              id.parse(c.req.param("id")),
              c.req.valid("query"),
            ),
          false,
        ),
      ),
  )
  .post(
    "/workspaces/:workspaceId/agents",
    validate(
      "json",
      z
        .object({
          visibility: z.enum(["user", "workspace"]).optional(),
          title,
          instructions: body,
          harness: title,
          model: title,
          projectId: id.optional(),
          subscriptionId: id.optional(),
          skillIds: ids.optional(),
        })
        .strict(),
    ),
    async (c) =>
      c.json(
        await transact(c, async (ctx) => {
          await validateSkills(ctx, c.req.valid("json").skillIds);
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
    "/workspaces/:workspaceId/runs",
    validate(
      "json",
      z
        .object({
          conversationId: id,
          agentId: id,
          requestId: id,
          type: z.enum(["prompt", "script"]),
          body,
          taskId: id.optional(),
          sessionId: id.optional(),
          documentIds: z.array(id).max(20).optional(),
          messageIds: z.array(id).max(100).optional(),
        })
        .strict(),
    ),
    async (c) => {
      const options = c.get("options");
      return c.json(
        await transact(c, (ctx) =>
          admitRun(ctx, options.boss, c.req.valid("json"), options.harnesses),
        ),
      );
    },
  )
  .get("/workspaces/:workspaceId/runs/:id", async (c) =>
    c.json(
      await transact(
        c,
        (ctx) => getRun(ctx, id.parse(c.req.param("id"))),
        false,
      ),
    ),
  )
  .post("/workspaces/:workspaceId/runs/:id/stop", async (c) => {
    const options = c.get("options");
    if (options.runtime)
      return c.json(
        await options.runtime.stop(
          id.parse(c.req.param("workspaceId")),
          { userId: c.get("userId") },
          id.parse(c.req.param("id")),
        ),
      );
    return c.json(
      await transact(c, (ctx) => stopRun(ctx, id.parse(c.req.param("id")))),
    );
  })
  .get(
    "/workspaces/:workspaceId/runs/:id/activity",
    validate(
      "query",
      z.object({ after: z.coerce.number().int().nonnegative().default(0) }),
    ),
    async (c) =>
      c.json(
        await transact(
          c,
          (ctx) =>
            getRunActivity(
              ctx,
              id.parse(c.req.param("id")),
              c.req.valid("query").after,
            ),
          false,
        ),
      ),
  )
  .post(
    "/workspaces/:workspaceId/runs/:id/steer",
    validate("json", z.object({ requestId: id, body })),
    async (c) => {
      const options = c.get("options");
      if (!options.runtime) throw new DomainError("unavailable");
      const input = c.req.valid("json");
      return c.json(
        await options.runtime.steer(
          id.parse(c.req.param("workspaceId")),
          { userId: c.get("userId") },
          id.parse(c.req.param("id")),
          input.requestId,
          input.body,
        ),
      );
    },
  )
  .post(
    "/workspaces/:workspaceId/agents/:id/computer",
    validate("json", z.object({ computerRef: title })),
    async (c) => {
      const options = c.get("options");
      if (!options.runtime) throw new DomainError("unavailable");
      return c.json(
        await options.runtime.bind(
          id.parse(c.req.param("workspaceId")),
          { userId: c.get("userId") },
          id.parse(c.req.param("id")),
          c.req.valid("json").computerRef,
        ),
      );
    },
  )
  .post(
    "/workspaces/:workspaceId/automations",
    validate("json", automationInput),
    async (c) => {
      const options = c.get("options");
      return c.json(
        await transact(c, (ctx) =>
          createAutomation(ctx, options.boss, c.req.valid("json")),
        ),
      );
    },
  )
  .get("/workspaces/:workspaceId/automations/:id", async (c) =>
    c.json(
      await transact(
        c,
        (ctx) => getAutomation(ctx, id.parse(c.req.param("id"))),
        false,
      ),
    ),
  )
  .patch(
    "/workspaces/:workspaceId/automations/:id",
    validate(
      "json",
      automationInput
        .partial()
        .extend({ editToken, ownerId: z.string().min(1).max(128).optional() }),
    ),
    async (c) => {
      const options = c.get("options");
      return c.json(
        await transact(c, (ctx) =>
          updateAutomation(
            ctx,
            options.boss,
            id.parse(c.req.param("id")),
            c.req.valid("json"),
          ),
        ),
      );
    },
  )
  .post(
    "/workspaces/:workspaceId/automations/:id/run",
    validate("json", z.object({ requestId: id })),
    async (c) => {
      const options = c.get("options");
      return c.json(
        await transact(c, (ctx) =>
          runAutomation(
            ctx,
            options.boss,
            id.parse(c.req.param("id")),
            c.req.valid("json").requestId,
            options.harnesses,
          ),
        ),
      );
    },
  );
