import { DomainError } from "@otto/db";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import type { Auth } from "./auth";
import { createLogger } from "./logger";
/** Composes transport boundaries; domain operations remain in their owning packages. */
export function createApp(auth?: Auth) {
  const logger = createLogger();
  const app = new Hono()
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
  if (auth)
    app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));
  app.onError((error, c) => {
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
export type App = ReturnType<typeof createApp>;
