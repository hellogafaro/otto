import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import type { Database } from "@otto/db";
import {
  accounts,
  authSessions,
  users,
  verifications,
} from "@otto/workspaces/schema";
import { betterAuth } from "better-auth";
/** Human authentication only; workspace membership is independently required. */
export function createAuth(db: Database, secret: string, origin: string) {
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
    emailAndPassword: { enabled: true, minPasswordLength: 12 },
    session: { cookieCache: { enabled: false } },
    rateLimit: { enabled: true },
  });
}
export type Auth = ReturnType<typeof createAuth>;
