import { timingSafeEqual } from "node:crypto";
import { DomainError } from "@otto/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { ApiOptions } from "./http";
import { ACCOUNT_CREDENTIAL } from "./subscription-secrets";
import { id, validate } from "./validation";

/** Private managed gateway callbacks; this capability does not authorize an upstream account. */
export function createGatewayStoreApi(options: ApiOptions) {
  return new Hono()
    .use("*", async (c, next) => {
      const key = options.gatewayStoreKey;
      const provided = c.req.header("authorization");
      if (!key || !options.subscriptionLogin)
        throw new DomainError("unavailable");
      const expected = Buffer.from(`Bearer ${key}`);
      const actual = Buffer.from(provided ?? "");
      if (
        actual.length !== expected.length ||
        !timingSafeEqual(actual, expected)
      )
        throw new DomainError("forbidden");
      c.header("Cache-Control", "no-store");
      await next();
    })
    .get("/accounts/:id", async (c) => {
      const service = options.subscriptionLogin;
      if (!service) throw new DomainError("unavailable");
      return c.json(
        await service.read(id.parse(c.req.param("id")), c.req.raw.signal),
      );
    })
    .put(
      "/accounts/:id",
      validate(
        "json",
        z
          .object({
            expectedFingerprint: z
              .string()
              .regex(/^[a-f0-9]{64}$/)
              .nullable(),
            expectedAuthenticatedAt: z.iso.datetime({ offset: true }),
            credential: ACCOUNT_CREDENTIAL,
          })
          .strict(),
      ),
      async (c) => {
        const service = options.subscriptionLogin;
        if (!service) throw new DomainError("unavailable");
        const body = c.req.valid("json");
        return c.json(
          await service.refresh(
            id.parse(c.req.param("id")),
            body.expectedFingerprint,
            body.expectedAuthenticatedAt,
            body.credential,
            c.req.raw.signal,
          ),
        );
      },
    );
}
