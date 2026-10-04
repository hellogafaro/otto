import { zValidator } from "@hono/zod-validator";
import { MAX_CURSOR_LENGTH } from "@otto/db";
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
/** Plain exact-match tags on Documents and Files: trimmed, case-sensitive, duplicates kept as sent. */
export const labels = z.array(title).max(30);

/** Domains validate UUID, human or sealed cursors before querying. Replay uses a numeric cursor. */
export const pageQuery = z.object({
  after: z.string().min(1).max(MAX_CURSOR_LENGTH).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
/** Query booleans arrive as text. */
export const flag = z
  .enum(["true", "false"])
  .transform((value) => value === "true")
  .optional();
export const visibility = z.enum(["user", "workspace"]);
/**
 * A strict list query: paging (default and maximum 100), the owning domain's `sort` allowlist with `order`,
 * and its typed filters. Unknown keys are refused rather than ignored.
 */
export function listQuery<
  Sorts extends readonly [string, ...string[]],
  Filters extends z.ZodRawShape = Record<never, never>,
>(sorts: Sorts, filters?: Filters) {
  return pageQuery
    .extend({
      sort: z.enum(sorts).optional(),
      order: z.enum(["asc", "desc"]).optional(),
      ...(filters ?? ({} as Filters)),
    })
    .strict()
    .refine(
      (query) => {
        const { sort, order } = query as { sort?: unknown; order?: unknown };
        return order === undefined || sort !== undefined;
      },
      { message: "order needs a sort" },
    );
}
