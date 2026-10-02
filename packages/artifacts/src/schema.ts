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
export const artifacts = pgTable(
  "artifacts",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid().notNull(),
    createdAt: timestamp({ withTimezone: true }).$defaultFn(() => new Date()),
    updatedAt: timestamp({ withTimezone: true })
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
    projectId: uuid(),
    ownerId: text().notNull(),
    creatorAgentId: uuid(),
    requestId: uuid().notNull(),
    request: jsonb().$type<{
      title: string;
      type: string;
      labels: string[];
      projectId: string | null;
      access: "inherited" | "restricted";
      mediaType: string;
      sourceRunId: string | null;
    }>(),
    title: text().notNull(),
    editToken: integer().notNull().default(0),
    type: text().notNull(),
    labels: jsonb().$type<string[]>().notNull().default([]),
    access: text({ enum: ["inherited", "restricted"] }).notNull(),
    readerIds: jsonb().$type<string[]>().notNull().default([]),
    writerIds: jsonb().$type<string[]>().notNull().default([]),
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
    foreignKey({
      name: "artifacts_workspace_fk",
      columns: [t.workspaceId],
      foreignColumns: [workspacesSchema.workspaces.id],
    }),
    foreignKey({
      name: "artifacts_projectId_workspace_fk",
      columns: [t.projectId, t.workspaceId],
      foreignColumns: [
        projectsSchema.projects.id,
        projectsSchema.projects.workspaceId,
      ],
    }),
    foreignKey({
      name: "artifacts_sourceRunId_workspace_fk",
      columns: [t.sourceRunId, t.workspaceId],
      foreignColumns: [runsSchema.runs.id, runsSchema.runs.workspaceId],
    }),
    foreignKey({
      name: "artifacts_ownerId_fk",
      columns: [t.ownerId],
      foreignColumns: [workspacesSchema.users.id],
    }),
    unique("artifacts_identity_workspace").on(t.id, t.workspaceId),
    check(
      "artifacts_size",
      sql`${t.byteLength}>=0 AND ${t.byteLength}<=8388608`,
    ),
    index("artifacts_library").on(
      t.workspaceId,
      t.projectId,
      t.state,
      t.archived,
      t.id,
    ),
    uniqueIndex("artifacts_idempotency").on(
      t.workspaceId,
      t.ownerId,
      t.requestId,
    ),
  ],
);
