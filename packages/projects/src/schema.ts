import * as workspacesSchema from "@otto/workspaces/schema";
import {
  boolean,
  foreignKey,
  index,
  integer,
  type PgTableExtraConfigValue,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
export const projects = pgTable(
  "projects",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid().notNull(),
    createdAt: timestamp({ withTimezone: true }).$defaultFn(() => new Date()),
    updatedAt: timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
    name: text().notNull(),
    editToken: integer().notNull().default(0),
    archived: boolean().notNull().default(false),
    repositoryUrl: text(),
  },
  (t): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "projects_workspace_fk",
      columns: [t.workspaceId],
      foreignColumns: [workspacesSchema.workspaces.id],
    }),
    unique("projects_identity_workspace").on(t.id, t.workspaceId),
    index("projects_workspace_page").on(t.workspaceId, t.id),
  ],
);
export const projectMembers = pgTable(
  "project_members",
  {
    projectId: uuid()
      .notNull()
      .references(() => projects.id),
    userId: text().notNull(),
    role: text({ enum: ["contributor", "viewer"] }).notNull(),
  },
  (t): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "project_members_userId_fk",
      columns: [t.userId],
      foreignColumns: [workspacesSchema.users.id],
    }),
    index("project_members_user").on(t.userId, t.projectId),
    primaryKey({ columns: [t.projectId, t.userId] }),
  ],
);
