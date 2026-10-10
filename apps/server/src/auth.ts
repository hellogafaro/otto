import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import type { Database } from "@otto/db";
import {
  accounts,
  authSessions,
  users,
  verifications,
} from "@otto/workspaces/schema";
import { betterAuth } from "better-auth";
import { createLogger } from "./logger";
import type { Mail } from "./mail";
/** Human authentication only; workspace membership is independently required. */
export function createAuth(
  db: Database,
  secret: string,
  origin: string,
  mail?: Mail | null,
) {
  const logger = createLogger();
  return betterAuth({
    secret,
    baseURL: origin,
    trustedOrigins: [origin],
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: users,
        session: authSessions,
        account: accounts,
        verification: verifications,
      },
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      revokeSessionsOnPasswordReset: true,
      ...(mail
        ? {
            sendResetPassword: async ({
              user,
              url,
              token,
            }: {
              user: { email: string };
              url: string;
              token: string;
            }) => {
              await mail.send({
                to: user.email,
                subject: "Reset your Otto password",
                text: `Reset your password: ${url}`,
                key: `reset:${token}`,
              });
            },
          }
        : {}),
    },
    logger: {
      log(level) {
        logger.info({ authLevel: level }, "auth event");
      },
    },
    session: { cookieCache: { enabled: false } },
    rateLimit: { enabled: true },
  });
}
export type Auth = ReturnType<typeof createAuth>;
