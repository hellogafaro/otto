import { z } from "zod";

const httpUrl = z.url().refine((value) => {
  try {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
});
const schema = z
  .object({
    DATABASE_URL: z.string().min(1),
    BETTER_AUTH_SECRET: z.string().min(32),
    OTTO_ORIGIN: httpUrl.refine((value) => {
      try {
        return new URL(value).origin === value;
      } catch {
        return false;
      }
    }),
    HOST: z.enum(["127.0.0.1", "0.0.0.0", "::1", "::"]).default("127.0.0.1"),
    PORT: z.coerce.number().int().min(0).max(65535).default(43001),
    S3_ENDPOINT: httpUrl.optional(),
    S3_REGION: z.string().min(1).default("garage"),
    S3_BUCKET: z.string().min(1).optional(),
    S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    MAIL_FROM: z.email().optional(),
    RESEND_API_KEY: z.string().min(1).optional(),
  })
  .superRefine((config, ctx) => {
    for (const group of [
      ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"],
      ["MAIL_FROM", "RESEND_API_KEY"],
    ] as const) {
      const present = group.filter((key) => config[key] !== undefined);
      if (present.length > 0 && present.length < group.length) {
        for (const key of group)
          if (config[key] === undefined)
            ctx.addIssue({
              code: "custom",
              path: [key],
              message: "Required together",
            });
      }
    }
  });
/** Returns field names only on failure: environment values must never reach logs. */
export function readConfig(env: NodeJS.ProcessEnv) {
  const result = schema.safeParse(env);
  if (!result.success)
    throw new Error(
      `Invalid configuration fields: ${[...new Set(result.error.issues.map((issue) => issue.path.join(".")))].join(", ")}`,
    );
  return result.data;
}
export type ServerConfig = ReturnType<typeof readConfig>;
