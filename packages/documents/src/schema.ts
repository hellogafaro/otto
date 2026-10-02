import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  uuid,
} from "drizzle-orm/pg-core";
export const documents = pgTable("document", {
  id: uuid().primaryKey().defaultRandom(),
  workspaceId: uuid().notNull(),
  projectId: uuid(),
  title: text().notNull(),
  body: text().notNull(),
  ownerId: text().notNull(),
  access: text({ enum: ["inherited", "restricted"] }).notNull(),
  readerIds: jsonb().$type<string[]>().notNull().default([]),
  skill: boolean().notNull().default(false),
  whenToUse: text(),
  editToken: integer().notNull().default(0),
  properties: jsonb()
    .$type<Record<string, string | number | boolean | null>>()
    .notNull()
    .default({}),
  collectionId: uuid(),
});
export interface CollectionField {
  id: string;
  name: string;
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
export const collections = pgTable("collection", {
  id: uuid().primaryKey().defaultRandom(),
  workspaceId: uuid().notNull(),
  projectId: uuid(),
  title: text().notNull(),
  fields: jsonb().$type<CollectionField[]>().notNull(),
  editToken: integer().notNull().default(0),
});
