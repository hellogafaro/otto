import { zValidator } from "@hono/zod-validator";
import { DomainError } from "@otto/shared";
import type { ValidationTargets } from "hono";
import { z } from "zod";

/** Keep inferred RPC inputs while routing invalid input through the server error boundary. */
export function validate<
  T extends z.ZodType,
  Target extends keyof ValidationTargets,
>(target: Target, schema: T) {
  return zValidator(target, schema, (result) => {
    if (!result.success) throw new DomainError("invalid");
  });
}

export const id = z.uuid();
export const title = z.string().trim().min(1).max(200);
export const body = z
  .string()
  .max(100000)
  .refine(
    (value) => Buffer.byteLength(value) <= 100000,
    "Body exceeds byte limit",
  );
export const editToken = z.number().int().nonnegative();
export const ids = z.array(id).max(50);

/** Domains validate UUID or human cursors before querying. Replay uses a numeric cursor. */
export const pageQuery = z.object({
  after: z.string().min(1).max(128).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
