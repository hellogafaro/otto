import { DomainError } from "@otto/shared";
import {
  createSubscription,
  getSubscription,
  getSubscriptions,
  SUBSCRIPTION_INPUT,
  SUBSCRIPTION_SORTS,
  SUBSCRIPTION_UPDATE,
  updateSubscription,
} from "@otto/subscriptions";
import {
  disconnectNativeSubscription,
  SUBSCRIPTION_API_KEY,
  setSubscriptionApiKey,
} from "@otto/subscriptions/server";
import { Hono } from "hono";
import { z } from "zod";
import { type ApiEnv, recordId, transact } from "./http";
import { listQuery, validate, visibility } from "./validation";

export const subscriptionApi = new Hono<ApiEnv>()
  .get("/workspaces/:workspaceId/subscriptions/:id/models", async (c) => {
    const subscription = await transact(
      c,
      (ctx) => getSubscription(ctx, recordId(c)),
      false,
    );
    return c.json({
      items: subscription.models.map((id) => ({ id })),
      next: null,
    });
  })
  .put(
    "/workspaces/:workspaceId/subscriptions/:id/api-key",
    validate("json", SUBSCRIPTION_API_KEY),
    async (c) => {
      const key = c.get("options").encryptionKey;
      if (!key)
        throw new DomainError("unavailable", "Provider storage unavailable");
      return c.json(
        await transact(c, (ctx) =>
          setSubscriptionApiKey(ctx, recordId(c), c.req.valid("json"), key),
        ),
      );
    },
  )
  .post("/workspaces/:workspaceId/subscriptions/:id/disconnect", async (c) => {
    return c.json(
      await transact(c, (ctx) =>
        disconnectNativeSubscription(ctx, recordId(c)),
      ),
    );
  })
  .get(
    "/workspaces/:workspaceId/subscriptions",
    validate(
      "query",
      listQuery(SUBSCRIPTION_SORTS, {
        status: z
          .enum(["needs_auth", "enabled", "disabled", "disconnected"])
          .optional(),
        provider: z
          .enum(["codex", "openai", "anthropic", "openai-compatible"])
          .optional(),
        visibility: visibility.optional(),
        createdBy: z.string().min(1).max(128).optional(),
        query: z.string().max(200).optional(),
      }),
    ),
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
