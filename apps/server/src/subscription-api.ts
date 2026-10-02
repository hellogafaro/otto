import {
  createSubscription,
  getSubscription,
  getSubscriptions,
  SUBSCRIPTION_INPUT,
  SUBSCRIPTION_UPDATE,
  updateSubscription,
} from "@otto/subscriptions";
import { Hono } from "hono";
import { type ApiEnv, recordId, transact } from "./http";
import { pageQuery, validate } from "./validation";

export const subscriptionApi = new Hono<ApiEnv>()
  .get(
    "/workspaces/:workspaceId/subscriptions",
    validate("query", pageQuery),
    async (c) =>
      c.json(
        await transact(
          c,
          (ctx) => getSubscriptions(ctx, c.req.valid("query")),
          false,
        ),
      ),
  )
  .get("/workspaces/:workspaceId/subscriptions/:id", async (c) =>
    c.json(
      await transact(c, (ctx) => getSubscription(ctx, recordId(c)), false),
    ),
  )
  .post(
    "/workspaces/:workspaceId/subscriptions",
    validate("json", SUBSCRIPTION_INPUT),
    async (c) =>
      c.json(
        await transact(c, (ctx) =>
          createSubscription(ctx, c.req.valid("json")),
        ),
      ),
  )
  .patch(
    "/workspaces/:workspaceId/subscriptions/:id",
    validate("json", SUBSCRIPTION_UPDATE),
    async (c) =>
      c.json(
        await transact(c, (ctx) =>
          updateSubscription(ctx, recordId(c), c.req.valid("json")),
        ),
      ),
  );
