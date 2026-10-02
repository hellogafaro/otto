import {
  boolean,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
export const users = pgTable("auth_user", {
  id: text().primaryKey(),
  name: text().notNull(),
  email: text().notNull().unique(),
  emailVerified: boolean().notNull().default(false),
  image: text(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
export const authSessions = pgTable("auth_session", {
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
export const accounts = pgTable("auth_account", {
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
export const verifications = pgTable("auth_verification", {
  id: text().primaryKey(),
  identifier: text().notNull(),
  value: text().notNull(),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
export const workspaces = pgTable("workspace", {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  revision: integer().notNull().default(0),
});
export const members = pgTable(
  "workspace_member",
  {
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id),
    userId: text()
      .notNull()
      .references(() => users.id),
    role: text({ enum: ["owner", "admin", "contributor", "viewer"] }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] })],
);
export const setup = pgTable("installation_setup", {
  id: integer().primaryKey(),
  claimedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
export const invitations = pgTable("invitation", {
  id: uuid().primaryKey().defaultRandom(),
  workspaceId: uuid()
    .notNull()
    .references(() => workspaces.id),
  email: text().notNull(),
  role: text({ enum: ["admin", "contributor", "viewer"] }).notNull(),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
  acceptedAt: timestamp({ withTimezone: true }),
  revokedAt: timestamp({ withTimezone: true }),
});
