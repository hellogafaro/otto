import { getRunActions, resolveRunAction } from "@otto/runs/actions";
import { Hono } from "hono";
import { z } from "zod";
import { type ApiEnv, transact } from "./http";
import { executeNativeAction } from "./native-actions";
import { authorizeRunSources } from "./run-sources";
import { id, validate } from "./validation";

export const nativeActionsApi = new Hono<ApiEnv>()
  .get(
    "/workspaces/:workspaceId/runs/:runId/actions",
    validate(
      "query",
      z
        .object({
          after: id.optional(),
          status: z.enum(["pending", "approved", "denied"]).optional(),
        })
        .strict(),
    ),
    async (c) =>
      c.json(
        await transact(
          c,
          (ctx) =>
            getRunActions(
              ctx,
              id.parse(c.req.param("runId")),
              c.req.valid("query"),
            ),
          false,
        ),
      ),
  )
  .post(
    "/workspaces/:workspaceId/runs/:runId/actions/:actionId/resolve",
    validate(
      "json",
      z
        .object({
          decision: z.enum(["approve", "deny"]),
          digest: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .strict(),
    ),
    async (c) =>
      c.json(
        await transact(c, (ctx) =>
          resolveRunAction(
            ctx,
            id.parse(c.req.param("runId")),
            id.parse(c.req.param("actionId")),
            c.req.valid("json"),
            (human, input, actionId, revalidate) =>
              executeNativeAction(human, input, c.get("options").boss, {
                actionId,
                native: c.get("options").nativeStorage,
                modelAuthorization: c.get("options").modelAuthorization,
                connections: c.get("options").connections,
                revalidate,
              }),
            c.get("options").nativeStorage,
            authorizeRunSources,
          ),
        ),
      ),
  );
