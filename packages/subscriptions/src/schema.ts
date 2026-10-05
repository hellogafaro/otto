import * as workspacesSchema from "@otto/workspaces/schema";
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  type PgTableExtraConfigValue,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

/** Managed AI-account metadata only; no credential, purchase, plan or billing management. */
export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid().notNull(),
    createdBy: text().notNull(),
    title: text("name").notNull(),
    provider: text({ enum: ["codex"] }).notNull(),
    visibility: text({ enum: ["user", "workspace"] })
      .notNull()
      .default("user"),
    status: text({
      enum: ["needs_auth", "enabled", "disabled", "disconnected"],
    })
      .notNull()
      .default("needs_auth"),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t): PgTableExtraConfigValue[] => [
    check("subscriptions_provider", sql`${t.provider} = 'codex'`),
    check(
      "subscriptions_visibility",
      sql`${t.visibility} in ('user','workspace')`,
    ),
    check(
      "subscriptions_status",
      sql`${t.status} in ('needs_auth','enabled','disabled','disconnected')`,
    ),
    foreignKey({
      name: "subscriptions_workspace_fk",
      columns: [t.workspaceId],
      foreignColumns: [workspacesSchema.workspaces.id],
    }),
    foreignKey({
      name: "subscriptions_createdBy_fk",
      columns: [t.createdBy],
      foreignColumns: [workspacesSchema.users.id],
    }),
    unique("subscriptions_identity_workspace").on(t.id, t.workspaceId),
  ],
);
