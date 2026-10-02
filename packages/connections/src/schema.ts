import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
export const connections = pgTable("connection", {
  id: uuid().primaryKey().defaultRandom(),
  workspaceId: uuid().notNull(),
  ownerId: text().notNull(),
  name: text().notNull(),
  kind: text({ enum: ["github", "mcp", "model"] }).notNull(),
  accountRef: text().notNull(),
  credentialRef: text(),
  mode: text({ enum: ["service", "native_subscription"] }).notNull(),
  connected: boolean().notNull().default(false),
  configToken: integer().notNull().default(0),
});
export const grants = pgTable(
  "connection_grant",
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
  },
  (t) => [uniqueIndex("connection_agent_grant").on(t.connectionId, t.agentId)],
);
export const operations = pgTable(
  "connection_operation",
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
  (t) => [uniqueIndex("connection_operation_request").on(t.runId, t.requestId)],
);
