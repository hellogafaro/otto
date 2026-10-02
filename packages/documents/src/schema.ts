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
export const documents = pgTable(
  "documents",
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
    body: text().notNull(),
    createdBy: text().notNull(),
    visibility: text({ enum: ["user", "workspace"] })
      .notNull()
      .default("user"),
    artifactIds: jsonb().$type<string[]>().notNull().default([]),
    skillMetadata: jsonb()
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    skill: boolean().notNull().default(false),
    whenToUse: text(),
    editToken: integer().notNull().default(0),
    properties: jsonb()
      .$type<Record<string, string | number | boolean | null>>()
      .notNull()
      .default({}),
    collectionId: uuid(),
    supportingFiles: jsonb()
      .$type<SkillFileReference[]>()
      .notNull()
      .default([]),
  },
  (t): PgTableExtraConfigValue[] => [
    check("documents_visibility", sql`${t.visibility} in ('user','workspace')`),
    foreignKey({
      name: "documents_workspace_fk",
      columns: [t.workspaceId],
      foreignColumns: [workspacesSchema.workspaces.id],
    }),
    foreignKey({
      name: "documents_projectId_workspace_fk",
      columns: [t.projectId, t.workspaceId],
      foreignColumns: [
        projectsSchema.projects.id,
        projectsSchema.projects.workspaceId,
      ],
    }),
    foreignKey({
      name: "documents_collectionId_workspace_fk",
      columns: [t.collectionId, t.workspaceId],
      foreignColumns: [collections.id, collections.workspaceId],
    }),
    foreignKey({
      name: "documents_createdBy_fk",
      columns: [t.createdBy],
      foreignColumns: [workspacesSchema.users.id],
    }),
    unique("documents_identity_workspace").on(t.id, t.workspaceId),
  ],
);
export interface CollectionField {
  id: string;
  title: string;
  type:
    | "text"
    | "number"
    | "date"
    | "checkbox"
    | "select"
    | "human"
    | "agent"
    | "document";
  options?: string[];
}
export const collections = pgTable(
  "collections",
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
    fields: jsonb()
      .$type<
        Array<
          CollectionField | (Omit<CollectionField, "title"> & { name: string })
        >
      >()
      .notNull(),
    view: text({ enum: ["table", "list"] })
      .notNull()
      .default("table"),
    editToken: integer().notNull().default(0),
  },
  (t): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "collections_workspace_fk",
      columns: [t.workspaceId],
      foreignColumns: [workspacesSchema.workspaces.id],
    }),
    foreignKey({
      name: "collections_projectId_workspace_fk",
      columns: [t.projectId, t.workspaceId],
      foreignColumns: [
        projectsSchema.projects.id,
        projectsSchema.projects.workspaceId,
      ],
    }),
    unique("collections_identity_workspace").on(t.id, t.workspaceId),
  ],
);

export interface SkillFileReference {
  path: string;
  artifactId: string;
  sha256: string;
  byteLength: number;
}

export const documentProposals = pgTable("document_proposals", {
  id: uuid().primaryKey().defaultRandom(),
  documentId: uuid()
    .notNull()
    .references(() => documents.id),
  proposerId: text().notNull(),
  agentId: uuid(),
  title: text().notNull(),
  body: text().notNull(),
  editToken: integer().notNull(),
});
