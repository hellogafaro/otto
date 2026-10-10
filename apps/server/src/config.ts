import { z } from "zod";

const mcpBinding = z
  .object({
    workspaceId: z.uuid(),
    connectionId: z.uuid(),
    credentialRef: z.string().min(1).max(200),
    tokenEnv: z
      .string()
      .regex(/^OTTO_MCP_TOKEN_[A-Z0-9_]+$/)
      .max(200),
  })
  .strict();
export type McpCredentialBinding = z.infer<typeof mcpBinding>;

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
    COMPUTER_DOCKER_IMAGE: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/)
      .optional(),
    COMPUTER_DOCKER_SOCKET: z
      .string()
      .min(1)
      .max(1024)
      .refine(
        (value) =>
          value.startsWith("/") &&
          value.endsWith(".sock") &&
          !value.includes("\0"),
      )
      .optional(),
    COMPUTER_OWNER_ID: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,80}$/)
      .optional(),
    MCP_ORIGIN: httpUrl
      .refine((value) => {
        try {
          const url = new URL(value);
          return url.origin === value && value !== "https://api.github.com";
        } catch {
          return false;
        }
      })
      .optional(),
    MCP_ALLOW_LOOPBACK_HTTP: z.enum(["true"]).optional(),
    MCP_CREDENTIAL_BINDINGS: z
      .string()
      .max(100_000)
      .transform((value, ctx) => {
        try {
          return JSON.parse(value) as unknown;
        } catch {
          ctx.addIssue({ code: "custom", message: "Invalid bindings" });
          return z.NEVER;
        }
      })
      .pipe(
        z
          .array(mcpBinding)
          .min(1)
          .max(100)
          .refine(
            (bindings) =>
              new Set(
                bindings.map((binding) =>
                  JSON.stringify([
                    binding.workspaceId,
                    binding.connectionId,
                    binding.credentialRef,
                  ]),
                ),
              ).size === bindings.length,
          ),
      )
      .transform((bindings) => JSON.stringify(bindings))
      .optional(),
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
    SMTP_HOST: z.union([z.hostname(), z.ipv4(), z.ipv6()]).optional(),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).optional(),
    SMTP_TLS: z.enum(["tls", "starttls", "none"]).optional(),
    SMTP_USER: z.string().min(1).max(512).optional(),
    SMTP_PASSWORD: z.string().min(1).max(4096).optional(),
    /** Dictation is unavailable without a key; the model is any OpenRouter speech-to-text model. */
    OPENROUTER_API_KEY: z.string().min(1).optional(),
    TRANSCRIPTION_MODEL: z
      .string()
      .min(1)
      .default("mistralai/voxtral-mini-transcribe"),
  })
  .superRefine((config, ctx) => {
    for (const group of [
      ["COMPUTER_DOCKER_IMAGE", "COMPUTER_DOCKER_SOCKET", "COMPUTER_OWNER_ID"],
      ["MCP_ORIGIN", "MCP_CREDENTIAL_BINDINGS"],
      ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"],
      ["MAIL_FROM", "SMTP_HOST", "SMTP_PORT", "SMTP_TLS"],
      ["SMTP_USER", "SMTP_PASSWORD"],
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
    if (config.MCP_ALLOW_LOOPBACK_HTTP && !config.MCP_ORIGIN)
      ctx.addIssue({
        code: "custom",
        path: ["MCP_ORIGIN"],
        message: "Required together",
      });
    if (config.MCP_ORIGIN) {
      let secure = false;
      try {
        const url = new URL(config.MCP_ORIGIN);
        secure =
          url.protocol === "https:" ||
          (config.MCP_ALLOW_LOOPBACK_HTTP === "true" &&
            ["127.0.0.1", "[::1]"].includes(url.hostname));
      } catch {}
      if (!secure)
        ctx.addIssue({
          code: "custom",
          path: ["MCP_ORIGIN"],
          message: "HTTPS required",
        });
    }
    if (config.SMTP_USER !== undefined && config.SMTP_HOST === undefined)
      ctx.addIssue({
        code: "custom",
        path: ["SMTP_HOST"],
        message: "Required with SMTP authentication",
      });
    if (
      config.SMTP_TLS === "none" &&
      (!["localhost", "127.0.0.1", "::1"].includes(
        config.SMTP_HOST?.toLowerCase() ?? "",
      ) ||
        config.SMTP_USER !== undefined)
    )
      ctx.addIssue({
        code: "custom",
        path: ["SMTP_TLS"],
        message: "Plaintext is limited to unauthenticated loopback delivery",
      });
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
