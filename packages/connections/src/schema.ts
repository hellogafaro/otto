import * as agentsSchema from "@otto/agents/schema";
import * as runsSchema from "@otto/runs/schema";
import * as workspacesSchema from "@otto/workspaces/schema";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  type PgTableExtraConfigValue,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  ConnectionAudience,
  ConnectionConfig,
  Discovery,
  JsonValue,
} from "./types";
export const connections = pgTable(
  "connections",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid().notNull(),
    ownerId: text().notNull(),
    visibility: text({ enum: ["user", "workspace"] })
      .notNull()
      .default("user"),
    name: text().notNull(),
    type: text({ enum: ["github", "mcp", "model"] }).notNull(),
    accountRef: text().notNull(),
    credentialRef: text(),
    mode: text({ enum: ["service", "native_subscription"] }).notNull(),
    connected: boolean().notNull().default(false),
    editToken: integer().notNull().default(0),
    config: jsonb().$type<ConnectionConfig>(),
    discovery: jsonb().$type<Discovery>(),
    expiresAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t): PgTableExtraConfigValue[] => [
    check(
      "connections_visibility",
      sql`${t.visibility} in ('user','workspace')`,
    ),
    foreignKey({
      name: "connections_workspace_fk",
      columns: [t.workspaceId],
      foreignColumns: [workspacesSchema.workspaces.id],
    }),
    foreignKey({
      name: "connections_ownerId_fk",
      columns: [t.ownerId],
      foreignColumns: [workspacesSchema.users.id],
    }),
    unique("connections_identity_workspace").on(t.id, t.workspaceId),
  ],
);
export const grants = pgTable(
  "connection_grants",
  {
    id: uuid().primaryKey().defaultRandom(),
    connectionId: uuid()
      .notNull()
      .references(() => connections.id),
    agentId: uuid().notNull(),
    sponsorId: text().notNull(),
    resources: jsonb().$type<string[]>().notNull(),
    operations: jsonb()
      .$type<Record<string, "allowed" | "confirmation" | "disabled">>()
      .notNull(),
    revokedAt: timestamp({ withTimezone: true }),
    generation: integer().notNull().default(1),
    audience: jsonb().$type<ConnectionAudience>(),
  },
  (t): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "connection_grants_sponsorId_fk",
      columns: [t.sponsorId],
      foreignColumns: [workspacesSchema.users.id],
    }),
    foreignKey({
      name: "grant_agent_fk",
      columns: [t.agentId],
      foreignColumns: [agentsSchema.agents.id],
    }),
    uniqueIndex("connections_agent_grant").on(t.connectionId, t.agentId),
  ],
);
export const operations = pgTable(
  "connection_operations",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid().notNull(),
    connectionId: uuid()
      .notNull()
      .references(() => connections.id),
    agentId: uuid().notNull(),
    sponsorId: text().notNull(),
    runId: uuid().notNull(),
    requestId: uuid().notNull(),
    action: text().notNull(),
    target: text().notNull(),
    accountRef: text().notNull(),
    editToken: integer(),
    grantGeneration: integer(),
    attempt: integer(),
    launchKey: uuid(),
    audience: jsonb().$type<ConnectionAudience>(),
    environmentGeneration: integer(),
    arguments: jsonb().$type<Record<string, JsonValue>>(),
    identity: text(),
    isWrite: boolean().notNull().default(true),
    retryCount: integer().notNull().default(0),
    result: jsonb().$type<JsonValue>(),
    outcome: text(),
    executionToken: uuid(),
    startedAt: timestamp({ withTimezone: true }),
    completedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    state: text({
      enum: [
        "awaiting_approval",
        "approved",
        "executing",
        "succeeded",
        "failed",
        "uncertain",
      ],
    }).notNull(),
    approvedBy: text(),
    expiresAt: timestamp({ withTimezone: true }),
    externalRef: text(),
  },
  (t): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "connection_operations_workspace_fk",
      columns: [t.workspaceId],
      foreignColumns: [workspacesSchema.workspaces.id],
    }),
    foreignKey({
      name: "connection_operations_connectionId_workspace_fk",
      columns: [t.connectionId, t.workspaceId],
      foreignColumns: [connections.id, connections.workspaceId],
    }),
    foreignKey({
      name: "connection_operations_agentId_workspace_fk",
      columns: [t.agentId, t.workspaceId],
      foreignColumns: [agentsSchema.agents.id, agentsSchema.agents.workspaceId],
    }),
    foreignKey({
      name: "connection_operations_runId_workspace_fk",
      columns: [t.runId, t.workspaceId],
      foreignColumns: [runsSchema.runs.id, runsSchema.runs.workspaceId],
    }),
    foreignKey({
      name: "connection_operations_sponsorId_fk",
      columns: [t.sponsorId],
      foreignColumns: [workspacesSchema.users.id],
    }),
    foreignKey({
      name: "connection_operations_approvedBy_fk",
      columns: [t.approvedBy],
      foreignColumns: [workspacesSchema.users.id],
    }),
    unique("connection_operations_identity_workspace").on(t.id, t.workspaceId),
    index("connection_operations_recovery")
      .on(t.startedAt, t.id)
      .where(sql`${t.state} = 'executing'`),
    uniqueIndex("connection_operations_request").on(t.runId, t.requestId),
  ],
);
