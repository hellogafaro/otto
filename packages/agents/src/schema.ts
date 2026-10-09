import * as projectsSchema from "@otto/projects/schema";
import * as skillsSchema from "@otto/skills/schema";
import * as subscriptionsSchema from "@otto/subscriptions/schema";
import * as workspacesSchema from "@otto/workspaces/schema";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  integer,
  type PgTableExtraConfigValue,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
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
    createdBy: text().notNull(),
    visibility: text({ enum: ["user", "workspace"] })
      .notNull()
      .default("user"),
    title: text("name").notNull(),
    instructions: text().notNull(),
    model: text().notNull(),
    subscriptionId: uuid(),
    archived: boolean().notNull().default(false),
    isDefault: boolean().notNull().default(false),
    editToken: integer().notNull().default(0),
  },
  (t): PgTableExtraConfigValue[] => [
    check("agents_visibility", sql`${t.visibility} in ('user','workspace')`),
    check(
      "agents_default_active_shared",
      sql`not ${t.isDefault} or (not ${t.archived} and ${t.visibility} = 'workspace' and ${t.projectId} is null)`,
    ),
    uniqueIndex("agents_one_default_workspace")
      .on(t.workspaceId)
      .where(sql`${t.isDefault}`),
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
      name: "agents_subscriptionId_workspace_fk",
      columns: [t.subscriptionId, t.workspaceId],
      foreignColumns: [
        subscriptionsSchema.subscriptions.id,
        subscriptionsSchema.subscriptions.workspaceId,
      ],
    }),
    foreignKey({
      name: "agents_createdBy_fk",
      columns: [t.createdBy],
      foreignColumns: [workspacesSchema.users.id],
    }),
    unique("agents_identity_workspace").on(t.id, t.workspaceId),
  ],
);

/** Reusable selections; accepted Run instruction/file snapshots remain immutable. */
export const agentSkills = pgTable(
  "agents_skills",
  {
    workspaceId: uuid().notNull(),
    agentId: uuid().notNull(),
    skillId: uuid().notNull(),
  },
  (t): PgTableExtraConfigValue[] => [
    primaryKey({ columns: [t.agentId, t.skillId] }),
    foreignKey({
      name: "agents_skills_agent_workspace_fk",
      columns: [t.agentId, t.workspaceId],
      foreignColumns: [agents.id, agents.workspaceId],
    }),
    foreignKey({
      name: "agents_skills_skill_workspace_fk",
      columns: [t.skillId, t.workspaceId],
      foreignColumns: [skillsSchema.skills.id, skillsSchema.skills.workspaceId],
    }),
  ],
);
