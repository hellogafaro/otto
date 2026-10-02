import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
export const users = pgTable("auth_users", {
  id: text().primaryKey(),
  name: text().notNull(),
  email: text().notNull().unique(),
  emailVerified: boolean().notNull().default(false),
  image: text(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
export const authSessions = pgTable("auth_sessions", {
  id: text().primaryKey(),
  userId: text()
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  token: text().notNull().unique(),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
  ipAddress: text(),
  userAgent: text(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
export const accounts = pgTable("auth_accounts", {
  id: text().primaryKey(),
  userId: text()
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  accountId: text().notNull(),
  providerId: text().notNull(),
  accessToken: text(),
  refreshToken: text(),
  idToken: text(),
  accessTokenExpiresAt: timestamp({ withTimezone: true }),
  refreshTokenExpiresAt: timestamp({ withTimezone: true }),
  scope: text(),
  password: text(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
export const verifications = pgTable("auth_verifications", {
  id: text().primaryKey(),
  identifier: text().notNull(),
  value: text().notNull(),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
export const workspaces = pgTable("workspaces", {
  id: uuid().primaryKey().defaultRandom(),
  title: text("name").notNull(),
  cursor: integer().notNull().default(0),
});
export const members = pgTable(
  "workspace_members",
  {
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id),
    userId: text()
      .notNull()
      .references(() => users.id),
    role: text({ enum: ["owner", "admin", "contributor", "viewer"] }).notNull(),
  },
  (t) => [
    check(
      "workspace_members_role_values",
      sql`${t.role} IN ('owner','admin','contributor','viewer')`,
    ),
    primaryKey({ columns: [t.workspaceId, t.userId] }),
  ],
);
export const setup = pgTable(
  "installation_setups",
  {
    id: integer().primaryKey(),
    claimedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("single_setup", sql`${t.id}=1`)],
);
export const invitations = pgTable(
  "invitations",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id),
    email: text().notNull(),
    role: text({ enum: ["admin", "contributor", "viewer"] }).notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    acceptedAt: timestamp({ withTimezone: true }),
    revokedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    check(
      "invitations_role_values",
      sql`${t.role} IN ('admin','contributor','viewer')`,
    ),
  ],
);
