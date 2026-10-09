import { secrets } from "@otto/secrets/schema";
import * as workspacesSchema from "@otto/workspaces/schema";
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  jsonb,
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
    provider: text({
      enum: ["codex", "openai", "anthropic", "openai-compatible"],
    }).notNull(),
    protocol: text({ enum: ["responses", "chat-completions", "anthropic"] }),
    baseUrl: text(),
    models: jsonb().$type<string[]>().notNull().default([]),
    secretId: uuid().references(() => secrets.id),
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
    check(
      "subscriptions_provider",
      sql`${t.provider} in ('codex','openai','anthropic','openai-compatible')`,
    ),
    check(
      "subscriptions_protocol",
      sql`${t.protocol} is null or ${t.protocol} in ('responses','chat-completions','anthropic')`,
    ),
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
