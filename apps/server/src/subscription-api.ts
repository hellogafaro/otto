import { DomainError } from "@otto/shared";
import {
  createSubscription,
  disconnectSubscription,
  getSubscription,
  getSubscriptions,
  SUBSCRIPTION_INPUT,
  SUBSCRIPTION_SORTS,
  SUBSCRIPTION_UPDATE,
  updateSubscription,
} from "@otto/subscriptions";
import { Hono } from "hono";
import { z } from "zod";
import { type ApiEnv, recordId, transact } from "./http";
import { listQuery, validate, visibility } from "./validation";

export const subscriptionApi = new Hono<ApiEnv>()
  .get("/workspaces/:workspaceId/subscriptions/:id/models", async (c) => {
    const gateway = c.get("options").modelGateway;
    if (!gateway)
      throw new DomainError("unavailable", "Account models unavailable");
    const subscriptionId = recordId(c);
    await transact(c, (ctx) => getSubscription(ctx, subscriptionId), false);
    const items = await gateway.getModels(subscriptionId, c.req.raw.signal);
    await transact(c, (ctx) => getSubscription(ctx, subscriptionId), false);
    return c.json({ items, next: null });
  })
  .post("/workspaces/:workspaceId/subscriptions/:id/login", async (c) => {
    const service = c.get("options").subscriptionLogin;
    if (!service)
      throw new DomainError("unavailable", "Account login unavailable");
    const workspaceId = z.uuid().parse(c.req.param("workspaceId"));
    const id = recordId(c);
    const actor = { userId: c.get("userId") };
    const account = await service.authorize(workspaceId, actor, id);
    if (account.status === "disabled" || account.status === "disconnected")
      throw new DomainError("forbidden");
    const controller = new AbortController();
    const abort = () => controller.abort();
    c.req.raw.signal.addEventListener("abort", abort, { once: true });
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(stream) {
        let eventCount = 0;
        void service
          .login(
            workspaceId,
            actor,
            id,
            (event) => {
              if (controller.signal.aborted) return;
              if (++eventCount > 8) {
                controller.abort();
                return;
              }
              stream.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
            },
            controller.signal,
          )
          .catch(() => {
            if (!controller.signal.aborted)
              stream.enqueue(
                encoder.encode('{"type":"error","code":"login_failed"}\n'),
              );
          })
          .finally(() => {
            c.req.raw.signal.removeEventListener("abort", abort);
            if (!controller.signal.aborted) stream.close();
          });
      },
      cancel() {
        controller.abort();
      },
    });
    return new Response(body, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  })
  .post("/workspaces/:workspaceId/subscriptions/:id/disconnect", async (c) => {
    const service = c.get("options").subscriptionLogin;
    // Without account storage there is no credential to remove, only the status.
    if (!service)
      return c.json(
        await transact(c, (ctx) => disconnectSubscription(ctx, recordId(c))),
      );
    return c.json(
      await service.disconnect(
        z.uuid().parse(c.req.param("workspaceId")),
        { userId: c.get("userId") },
        recordId(c),
        c.req.raw.signal,
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
        provider: z.enum(["codex"]).optional(),
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
