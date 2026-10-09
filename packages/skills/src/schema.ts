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
export const skills = pgTable(
  "skills",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid().notNull(),
    createdAt: timestamp({ withTimezone: true }).$defaultFn(() => new Date()),
    updatedAt: timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
    archived: boolean().notNull().default(false),
    projectId: uuid(),
    title: text().notNull(),
    instructions: text().notNull(),
    createdBy: text().notNull(),
    visibility: text({ enum: ["user", "workspace"] })
      .notNull()
      .default("user"),
    metadata: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    whenToUse: text(),
    editToken: integer().notNull().default(0),
    supportingFiles: jsonb()
      .$type<StoredSkillFileReference[]>()
      .notNull()
      .default([]),
  },
  (t): PgTableExtraConfigValue[] => [
    check("skills_visibility", sql`${t.visibility} in ('user','workspace')`),
    foreignKey({
      name: "skills_workspace_fk",
      columns: [t.workspaceId],
      foreignColumns: [workspacesSchema.workspaces.id],
    }),
    foreignKey({
      name: "skills_projectId_workspace_fk",
      columns: [t.projectId, t.workspaceId],
      foreignColumns: [
        projectsSchema.projects.id,
        projectsSchema.projects.workspaceId,
      ],
    }),
    foreignKey({
      name: "skills_createdBy_fk",
      columns: [t.createdBy],
      foreignColumns: [workspacesSchema.users.id],
    }),
    unique("skills_identity_workspace").on(t.id, t.workspaceId),
  ],
);
export interface SkillFileReference {
  path: string;
  fileId: string;
  sha256: string;
  byteLength: number;
}

/** Resource-era stored Skill form; projected to `fileId` on read and never rewritten. */
export type ResourceSkillFileReference = Omit<SkillFileReference, "fileId"> & {
  resourceId: string;
};
/** Private accepted Run/Session file identity; preserve its historical JSON key and scope bytes. */
export type AcceptedSkillFileReference = Omit<SkillFileReference, "fileId"> & {
  artifactId: string;
};

/** Every persisted Skill file form: current, Resource-era and the earliest Artifact-era key. */
export type StoredSkillFileReference =
  | SkillFileReference
  | ResourceSkillFileReference
  | AcceptedSkillFileReference;

export const skillProposals = pgTable("skill_proposals", {
  id: uuid().primaryKey().defaultRandom(),
  skillId: uuid()
    .notNull()
    .references(() => skills.id),
  proposerId: text()
    .notNull()
    .references(() => workspacesSchema.users.id),
  agentId: uuid(),
  title: text().notNull(),
  instructions: text().notNull(),
  editToken: integer().notNull(),
});
