import * as connectionsSchema from "@otto/connections/schema";
import * as projectsSchema from "@otto/projects/schema";
import * as workspacesSchema from "@otto/workspaces/schema";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  integer,
  jsonb,
  type PgTableExtraConfigValue,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
export const agents = pgTable(
  "agents",
  {
    id: uuid().primaryKey().defaultRandom(),
    createdAt: timestamp({ withTimezone: true }).$defaultFn(() => new Date()),
    updatedAt: timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .$onUpdate(() => new Date()),
    workspaceId: uuid().notNull(),
    projectId: uuid(),
    ownerId: text().notNull(),
    visibility: text({ enum: ["user", "workspace"] })
      .notNull()
      .default("user"),
    name: text().notNull(),
    instructions: text().notNull(),
    harness: text().notNull(),
    model: text().notNull(),
    connectionId: uuid(),
    skillIds: jsonb().$type<string[]>().notNull().default([]),
    archived: boolean().notNull().default(false),
    editToken: integer().notNull().default(0),
  },
  (t): PgTableExtraConfigValue[] => [
    check("agents_visibility", sql`${t.visibility} in ('user','workspace')`),
    foreignKey({
      name: "agents_workspace_fk",
      columns: [t.workspaceId],
      foreignColumns: [workspacesSchema.workspaces.id],
    }),
    foreignKey({
      name: "agents_projectId_workspace_fk",
      columns: [t.projectId, t.workspaceId],
      foreignColumns: [
        projectsSchema.projects.id,
        projectsSchema.projects.workspaceId,
      ],
    }),
    foreignKey({
      name: "agents_connectionId_workspace_fk",
      columns: [t.connectionId, t.workspaceId],
      foreignColumns: [
        connectionsSchema.connections.id,
        connectionsSchema.connections.workspaceId,
      ],
    }),
    foreignKey({
      name: "agents_ownerId_fk",
      columns: [t.ownerId],
      foreignColumns: [workspacesSchema.users.id],
    }),
    unique("agents_identity_workspace").on(t.id, t.workspaceId),
  ],
);
