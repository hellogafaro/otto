import {
  AGENT_SORTS,
  archiveAgent,
  createAgent,
  getAgent,
  getAgents,
  getDefaultAgent,
  updateAgent,
} from "@otto/agents";
import { createEnvironment, getEnvironment } from "@otto/environments";
import { snapshotRunDocuments } from "@otto/library";
import {
  admitRun,
  getRun,
  getRunActivity,
  getRuns,
  getRunUsage,
  prepareRunModel,
  RUN_SORTS,
  stopRun,
} from "@otto/runs";
import {
  createSchedule,
  getSchedule,
  getScheduleHistory,
  getSchedules,
  runSchedule,
  SCHEDULE_HISTORY_SORTS,
  SCHEDULE_SORTS,
  updateSchedule,
} from "@otto/schedules";
import { DomainError } from "@otto/shared";
import { getSkill } from "@otto/skills";
import type { Context } from "@otto/workspaces";
import { Hono } from "hono";
import { z } from "zod";
import { type ApiEnv, transact } from "./http";
import {
  body,
  editToken,
  flag,
  id,
  ids,
  listQuery,
  title,
  validate,
  visibility,
} from "./validation";

const scheduleInput = z
  .object({
    title,
    agentId: id,
    chatId: id,
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
    const skill = await getSkill(c, id);
    if (skill.archived) throw new DomainError("invalid", "Skill unavailable");
  }
}

export const executionApi = new Hono<ApiEnv>()
  .get("/workspaces/:workspaceId/agents/default", async (c) =>
    c.json(await transact(c, getDefaultAgent, false)),
  )
  .get(
    "/workspaces/:workspaceId/agents",
    validate(
      "query",
      listQuery(AGENT_SORTS, {
        projectId: id.optional(),
        archived: flag,
        query: z.string().max(200).optional(),
        visibility: visibility.optional(),
        createdBy: z.string().min(1).max(128).optional(),
        agentIds: z
          .string()
          .max(4000)
          .transform((value, ctx) => {
            try {
              return JSON.parse(value) as unknown;
            } catch {
              ctx.addIssue({ code: "custom", message: "Invalid Agent IDs" });
              return z.NEVER;
            }
          })
          .pipe(z.array(id).max(100))
          .optional(),
      }),
    ),
    async (c) =>
      c.json(
        await transact(c, (ctx) => getAgents(ctx, c.req.valid("query")), false),
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
    validate(
      "query",
      listQuery(RUN_SORTS, {
        chatId: id.optional(),
        state: z
          .enum([
            "queued",
            "launching",
            "running",
            "finished",
            "failed",
            "interrupted",
            "uncertain",
          ])
          .optional(),
        agentId: id.optional(),
        sponsorId: z.string().min(1).max(128).optional(),
        type: z.enum(["prompt", "script"]).optional(),
      }),
    ),
    async (c) =>
      c.json(
        await transact(c, (ctx) => getRuns(ctx, c.req.valid("query")), false),
      ),
  )
  .get(
    "/workspaces/:workspaceId/schedules",
    validate(
      "query",
      listQuery(SCHEDULE_SORTS, {
        status: z.enum(["enabled", "disabled", "archived"]).optional(),
        ownerId: z.string().min(1).max(128).optional(),
        agentId: id.optional(),
        type: z.enum(["prompt", "script"]).optional(),
        query: z.string().max(200).optional(),
      }),
    ),
    async (c) =>
      c.json(
        await transact(
          c,
          (ctx) => getSchedules(ctx, c.req.valid("query")),
          false,
        ),
      ),
  )
  .get(
    "/workspaces/:workspaceId/schedules/:id/history",
    validate(
      "query",
      listQuery(SCHEDULE_HISTORY_SORTS, {
        outcome: z.string().min(1).max(200).optional(),
        runId: id.optional(),
      }),
    ),
    async (c) =>
      c.json(
        await transact(
          c,
          (ctx) =>
            getScheduleHistory(
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
          chatId: id,
          agentId: id,
          requestId: id,
          type: z.enum(["prompt", "script"]),
          body,
          taskId: id.optional(),
          sessionId: id.optional(),
          sessionMode: z.enum(["auto", "fresh"]).optional(),
          documentIds: z.array(id).max(20).optional(),
          messageIds: z.array(id).max(100).optional(),
        })
        .strict()
        .refine((input) => !(input.sessionId && input.sessionMode), {
          message: "Choose an explicit Session or a Session mode",
          path: ["sessionMode"],
        }),
    ),
    async (c) => {
      const options = c.get("options");
      const modelAuthorization = await prepareRunModel(
        options.db,
        id.parse(c.req.param("workspaceId")),
        { userId: c.get("userId") },
        c.req.valid("json"),
        options.modelAuthorization,
      );
      return c.json(
        await transact(c, (ctx) =>
          admitRun(
            ctx,
            options.boss,
            c.req.valid("json"),
            modelAuthorization,
            options.nativeStorage,
            snapshotRunDocuments,
          ),
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
      z
        .object({ after: z.coerce.number().int().nonnegative().default(0) })
        .strict(),
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
  .get("/workspaces/:workspaceId/runs/:id/usage", async (c) =>
    c.json(
      await transact(
        c,
        (ctx) => getRunUsage(ctx, id.parse(c.req.param("id"))),
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
    "/workspaces/:workspaceId/schedules",
    validate("json", scheduleInput),
    async (c) => {
      const options = c.get("options");
      return c.json(
        await transact(c, (ctx) =>
          createSchedule(ctx, options.boss, c.req.valid("json")),
        ),
      );
    },
  )
  .get("/workspaces/:workspaceId/schedules/:id", async (c) =>
    c.json(
      await transact(
        c,
        (ctx) => getSchedule(ctx, id.parse(c.req.param("id"))),
        false,
      ),
    ),
  )
  .patch(
    "/workspaces/:workspaceId/schedules/:id",
    validate(
      "json",
      scheduleInput
        .partial()
        .extend({ editToken, ownerId: z.string().min(1).max(128).optional() }),
    ),
    async (c) => {
      const options = c.get("options");
      return c.json(
        await transact(c, (ctx) =>
          updateSchedule(
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
    "/workspaces/:workspaceId/schedules/:id/run",
    validate("json", z.object({ requestId: id })),
    async (c) => {
      const options = c.get("options");
      const schedule = await transact(
        c,
        (ctx) => getSchedule(ctx, id.parse(c.req.param("id"))),
        false,
      );
      const modelAuthorization = await prepareRunModel(
        options.db,
        id.parse(c.req.param("workspaceId")),
        { userId: c.get("userId") },
        { ...schedule, requestId: c.req.valid("json").requestId },
        options.modelAuthorization,
      );
      return c.json(
        await transact(c, (ctx) =>
          runSchedule(
            ctx,
            options.boss,
            id.parse(c.req.param("id")),
            c.req.valid("json").requestId,
            modelAuthorization,
            options.nativeStorage,
          ),
        ),
      );
    },
  );
