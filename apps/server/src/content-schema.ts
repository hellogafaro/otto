import { integer, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";

export type ShareSelection =
  | { type: "document"; targetId: string; start: number; end: number }
  | { type: "chat"; targetId: string; messageIds: string[] }
  | { type: "file"; targetId: string; includeFile: boolean };
export type ShareSnapshot =
  | { type: "document"; title: string; body: string }
  | { type: "chat"; title: string; messages: { body: string }[] }
  | {
      type: "file";
      title: string;
      fileType: string;
      labels: string[];
      file: { mediaType: string; byteLength: number; sha256: string } | null;
    };
/** Historical frozen selections/snapshots are projected, never rewritten during reads. */
export type StoredShareSelection =
  | ShareSelection
  | { type: "resource"; targetId: string; includeFile: boolean }
  | { type: "artifact"; targetId: string; includeFile: boolean }
  | { type: "conversation"; targetId: string; messageIds: string[] };
export type StoredShareSnapshot =
  | ShareSnapshot
  | { type: "conversation"; title: string; messages: { body: string }[] }
  | {
      type: "resource";
      title: string;
      resourceType: string;
      labels: string[];
      file: { mediaType: string; byteLength: number; sha256: string } | null;
    }
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
  selection: jsonb().$type<StoredShareSelection>().notNull(),
  preview: jsonb().$type<StoredShareSnapshot>().notNull(),
  snapshot: jsonb().$type<StoredShareSnapshot>(),
  editToken: integer().notNull().default(0),
});
