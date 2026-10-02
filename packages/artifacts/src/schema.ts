import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
export const artifacts = pgTable(
  "artifact",
  {
    id: uuid().primaryKey().defaultRandom(),
    workspaceId: uuid().notNull(),
    projectId: uuid(),
    ownerId: text().notNull(),
    requestId: uuid().notNull(),
    title: text().notNull(),
    kind: text().notNull(),
    labels: jsonb().$type<string[]>().notNull().default([]),
    access: text({ enum: ["inherited", "restricted"] }).notNull(),
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
  (t) => [
    uniqueIndex("artifact_idempotency").on(
      t.workspaceId,
      t.ownerId,
      t.requestId,
    ),
  ],
);
