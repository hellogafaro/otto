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
    ENCRYPTION_KEY: z.string().refine((value) => {
      const bytes = Buffer.from(value, "base64");
      return bytes.length === 32 && bytes.toString("base64") === value;
    }),
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
    /** Base directory for in-flight transfer spools; each instance owns a private subdirectory. */
    UPLOAD_SPOOL_DIR: z.string().min(1).optional(),
    /** Transfer deadlines: a fixed allowance plus time for the size at a minimum acceptable rate. */
    TRANSFER_BASE_MS: z.coerce
      .number()
      .int()
      .min(100)
      .max(3_600_000)
      .default(60000),
    TRANSFER_MIN_BYTES_PER_SECOND: z.coerce
      .number()
      .int()
      .min(1024)
      .max(1_000_000_000)
      .default(256 * 1024),
    /** One disk budget for uploads and verified downloads together (default: five maximum-size files). */
    UPLOAD_SPOOL_BYTES: z.coerce
      .number()
      .int()
      .min(100_000_000)
      .max(100_000_000_000)
      .default(500_000_000),
    S3_BUCKET: z.string().min(1).optional(),
    S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    MAIL_FROM: z.email().optional(),
    RESEND_API_KEY: z.string().min(1).optional(),
    /** Dictation is unavailable without a key; the model is any OpenRouter speech-to-text model. */
    OPENROUTER_API_KEY: z.string().min(1).optional(),
    TRANSCRIPTION_MODEL: z
      .string()
      .min(1)
      .default("mistralai/voxtral-mini-transcribe"),
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
