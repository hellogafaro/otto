import { boolean, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
export const projects = pgTable("project", {
  id: uuid().primaryKey().defaultRandom(),
  workspaceId: uuid().notNull(),
  name: text().notNull(),
  archived: boolean().notNull().default(false),
  repositoryUrl: text(),
});
export const projectMembers = pgTable(
  "project_member",
  {
    projectId: uuid()
      .notNull()
      .references(() => projects.id),
    userId: text().notNull(),
    role: text({ enum: ["contributor", "viewer"] }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.userId] })],
);
