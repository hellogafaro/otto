import * as projectsSchema from "@otto/projects/schema";
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
import { MAX_FILE_BYTES } from "./limits";
export const folders = pgTable(
  "folders",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid().notNull(),
    createdAt: timestamp({ withTimezone: true }).$defaultFn(() => new Date()),
    updatedAt: timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
    projectId: uuid(),
    parentId: uuid(),
    createdBy: text().notNull(),
    title: text().notNull(),
    visibility: text({ enum: ["user", "workspace"] })
      .notNull()
      .default("user"),
    archived: boolean().notNull().default(false),
  },
  (t): PgTableExtraConfigValue[] => [
    check("folders_visibility", sql`${t.visibility} in ('user','workspace')`),
    foreignKey({
      name: "folders_workspace_fk",
      columns: [t.workspaceId],
      foreignColumns: [workspacesSchema.workspaces.id],
    }),
    foreignKey({
      name: "folders_projectId_workspace_fk",
      columns: [t.projectId, t.workspaceId],
      foreignColumns: [
        projectsSchema.projects.id,
        projectsSchema.projects.workspaceId,
      ],
    }),
    foreignKey({
      name: "folders_parentId_workspace_fk",
      columns: [t.parentId, t.workspaceId],
      foreignColumns: [t.id, t.workspaceId],
    }),
    foreignKey({
      name: "folders_createdBy_fk",
      columns: [t.createdBy],
      foreignColumns: [workspacesSchema.users.id],
    }),
    check("folders_not_own_parent", sql`${t.parentId} <> ${t.id}`),
    unique("folders_identity_workspace").on(t.id, t.workspaceId),
    index("folders_children").on(
      t.workspaceId,
      t.projectId,
      t.parentId,
      t.archived,
      t.id,
    ),
  ],
);
export const files = pgTable(
  "files",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid().notNull(),
    createdAt: timestamp({ withTimezone: true }).$defaultFn(() => new Date()),
    updatedAt: timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
    projectId: uuid(),
    /** Organization only: set once at first placement and never part of the immutable upload identity. */
    folderId: uuid(),
    ownerId: text().notNull(),
    creatorAgentId: uuid(),
    requestId: uuid().notNull(),
    request: jsonb()
      .$type<{
        title: string;
        type: string;
        labels: string[];
        projectId: string | null;
        visibility: "user" | "workspace";
        mediaType: string;
        sourceRunId: string | null;
      }>()
      .notNull(),
    title: text().notNull(),
    type: text().notNull(),
    labels: jsonb().$type<string[]>().notNull().default([]),
    visibility: text({ enum: ["user", "workspace"] })
      .notNull()
      .default("user"),
    sourceRunId: uuid(),
    objectKey: text().notNull().unique(),
    sha256: text().notNull(),
    byteLength: integer().notNull(),
    mediaType: text().notNull(),
    state: text({ enum: ["pending", "saved"] })
      .notNull()
      .default("pending"),
    archived: boolean().notNull().default(false),
  },
  (t): PgTableExtraConfigValue[] => [
    check("files_visibility", sql`${t.visibility} in ('user','workspace')`),
    foreignKey({
      name: "files_workspace_fk",
      columns: [t.workspaceId],
      foreignColumns: [workspacesSchema.workspaces.id],
    }),
    foreignKey({
      name: "files_projectId_workspace_fk",
      columns: [t.projectId, t.workspaceId],
      foreignColumns: [
        projectsSchema.projects.id,
        projectsSchema.projects.workspaceId,
      ],
    }),
    foreignKey({
      name: "files_sourceRunId_workspace_fk",
      columns: [t.sourceRunId, t.workspaceId],
      foreignColumns: [runsSchema.runs.id, runsSchema.runs.workspaceId],
    }),
    foreignKey({
      name: "files_ownerId_fk",
      columns: [t.ownerId],
      foreignColumns: [workspacesSchema.users.id],
    }),
    unique("files_identity_workspace").on(t.id, t.workspaceId),
    foreignKey({
      name: "files_folderId_workspace_fk",
      columns: [t.folderId, t.workspaceId],
      foreignColumns: [folders.id, folders.workspaceId],
    }),
    // Native push does not re-diff a changed CHECK expression, so the name carries the limit: changing
    // MAX_FILE_BYTES changes the name and push replaces the constraint (proved on a populated database).
    check(
      `files_size_${MAX_FILE_BYTES}`,
      sql`${t.byteLength}>=0 AND ${t.byteLength}<=${sql.raw(String(MAX_FILE_BYTES))}`,
    ),
    index("files_folder").on(t.workspaceId, t.folderId, t.archived, t.id),
    index("files_library").on(
      t.workspaceId,
      t.projectId,
      t.state,
      t.archived,
      t.id,
    ),
    uniqueIndex("files_idempotency").on(t.workspaceId, t.ownerId, t.requestId),
  ],
);
