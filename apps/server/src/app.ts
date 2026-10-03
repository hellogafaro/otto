import { DomainError } from "@otto/shared";

import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";
import { createApi } from "./api";
import { createGatewayStoreApi } from "./gateway-store-api";
import type { ApiOptions } from "./http";
import { createLogger } from "./logger";
/** Composes transport boundaries; domain operations remain in their owning packages. */
export function createApp(
  options?: ApiOptions,
  runtime?: { isReady(): Promise<boolean> },
) {
  const logger = createLogger();
  let inFlight = 0;
  const app = new Hono()
    .use("*", async (c, next) => {
      if (inFlight >= 128) return c.json({ error: "busy" }, 503);
      inFlight++;
      try {
        await next();
      } finally {
        inFlight--;
      }
    })
    .use("*", bodyLimit({ maxSize: 1024 * 1024 }))
    .use("*", async (c, next) => {
      const requestId = crypto.randomUUID();
      c.header("X-Request-Id", requestId);
      const start = performance.now();
      await next();
      logger.info(
        {
          requestId,
          method: c.req.method,
          status: c.res.status,
          durationMs: Math.round(performance.now() - start),
        },
        "request",
      );
    })
    .get("/health", (c) =>
      c.json({
        status: "ok",
        execution: {
          available: false,
          reason: "compute_provider_not_selected",
        },
      }),
    );
  app.get("/ready", async (c) => {
    let ready = false;
    try {
      ready = (await runtime?.isReady()) ?? false;
    } catch {
      /* Dependency unavailable. */
    }
    return c.json(
      { status: ready ? "ready" : "unavailable" },
      ready ? 200 : 503,
    );
  });
  if (options) {
    app.route("/internal/gateway", createGatewayStoreApi(options));
    app.all("/model/*", (c) => {
      if (!options.modelGateway) throw new DomainError("unavailable");
      return options.modelGateway.handle(c.req.raw);
    });
    app.on(["GET", "POST"], "/api/auth/*", (c) =>
      options.auth.handler(c.req.raw),
    );
    app.route("/api", createApi(options));
  }
  app.onError((error, c) => {
    if (error instanceof ZodError) return c.json({ error: "invalid" }, 400);
    if (error instanceof HTTPException) return error.getResponse();
    if (error instanceof DomainError)
      return c.json(
        { error: error.code },
        error.code === "forbidden"
          ? 403
          : error.code === "not_found"
            ? 404
            : error.code === "conflict"
              ? 409
              : error.code === "unavailable"
                ? 503
                : 400,
      );
    logger.error({ errorType: error.name }, "request failed");
    return c.json({ error: "internal" }, 500);
  });
  return app;
}
