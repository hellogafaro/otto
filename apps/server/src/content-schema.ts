import { integer, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";

export type ShareSelection =
  | { type: "document"; targetId: string; start: number; end: number }
  | { type: "conversation"; targetId: string; messageIds: string[] }
  | { type: "artifact"; targetId: string; includeFile: boolean };
export type ShareSnapshot =
  | { type: "document"; title: string; body: string }
  | { type: "conversation"; title: string; messages: { body: string }[] }
  | {
      type: "artifact";
      title: string;
      artifactType: string;
      labels: string[];
      file: { mediaType: string; byteLength: number; sha256: string } | null;
    };
/** One current preview and one explicitly published snapshot; no cursor history. */
export const contentShares = pgTable("content_shares", {
  id: uuid().primaryKey().defaultRandom(),
  workspaceId: uuid().notNull(),
  publisherId: text().notNull(),
  selection: jsonb().$type<ShareSelection>().notNull(),
  preview: jsonb().$type<ShareSnapshot>().notNull(),
  snapshot: jsonb().$type<ShareSnapshot>(),
  editToken: integer().notNull().default(0),
});
