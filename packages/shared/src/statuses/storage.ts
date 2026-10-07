/**
 * Status Storage
 *
 * A workspace's statuses are rows of `statuses` (./schema.ts), read here by workspace id as `StatusConfig`s
 * whose `id` is the row's `slug`: the id chats carry (`todo`), kept from the old `statuses/config.json`.
 * Reading never writes: a workspace that has no rows yet (before `initWorkspaceStatuses` seeded it) reads
 * as the default statuses.
 *
 * Icon: one text column, an emoji, an icon name or an image data URL of at most 16 KB (the default icons
 * are SVG data URLs using currentColor, so they take the status color).
 */

import { and, asc, eq, sql } from 'drizzle-orm';
import { initDb, type Db, type Tx } from '../db/index.ts';
import { createId } from '../id.ts';
import type { EntityColor } from '../colors/types.ts';
import { DEFAULT_ICON_SVGS } from './default-icons.ts';
import { statuses } from './schema.ts';
import type { StatusCategory, StatusConfig } from './types.ts';

type Row = typeof statuses.$inferSelect;

/** The statuses every workspace has and none may lose. */
export const FIXED_STATUS_IDS = ['todo', 'done', 'cancelled', 'archived'];

/** Longest icon the column takes: an image data URL of at most 16 KB. */
export const MAX_STATUS_ICON = 16 * 1024;

/** An SVG as a data URL (base64), the form icons are stored in. */
export const svgDataUrl = (svg: string): string => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

function toConfig(row: Row): StatusConfig {
  let color: EntityColor | undefined;
  try {
    if (row.color != null) color = JSON.parse(row.color) as EntityColor;
  } catch {
    // an unreadable color is no color: the design system default applies
  }
  return { id: row.slug, label: row.title, ...(color !== undefined && { color }), ...(row.icon && { icon: row.icon }), category: row.category, isFixed: FIXED_STATUS_IDS.includes(row.slug), isDefault: row.isDefault, position: row.position };
}

/**
 * Get default statuses (matches current hardcoded behavior).
 * Colors are omitted - defaults from colors/defaults.ts are applied:
 * - backlog: foreground/50 (muted, not yet planned)
 * - todo: foreground/50 (muted, ready to work on)
 * - needs-review: info (amber, attention needed)
 * - done: success (green, completed, as a task's)
 * - cancelled: foreground/50 (muted, inactive)
 * - archived: the fixed status archiving a chat moves it to
 * `todo` is the status new chats get.
 */
export function getDefaultStatuses(): StatusConfig[] {
  const defaults: Array<[string, string, StatusCategory]> = [
    ['backlog', 'Backlog', 'open'],
    ['todo', 'Todo', 'open'],
    ['needs-review', 'Needs Review', 'open'],
    ['done', 'Done', 'closed'],
    ['cancelled', 'Cancelled', 'closed'],
    ['archived', 'Archived', 'archived'],
  ];
  return defaults.map(([id, label, category], position) => ({
    id,
    label,
    icon: svgDataUrl(DEFAULT_ICON_SVGS[id]!),
    category,
    isFixed: FIXED_STATUS_IDS.includes(id),
    isDefault: id === 'todo',
    position,
  }));
}

/** Statuses of a workspace sorted by position; the defaults while it has no rows. */
export function getStatuses(workspaceId: string, db: Db | Tx = initDb()): StatusConfig[] {
  const rows = db.select().from(statuses).where(eq(statuses.workspaceId, workspaceId)).orderBy(asc(statuses.position)).all();
  return rows.length ? rows.map(toConfig) : getDefaultStatuses();
}

/** Each status of a workspace by row id: its slug and category (chats store the row id and read the slug). */
export function getStatusesById(workspaceId: string, db: Db | Tx = initDb()): Map<string, { slug: string; category: StatusCategory }> {
  const rows = db.select({ id: statuses.id, slug: statuses.slug, category: statuses.category }).from(statuses).where(eq(statuses.workspaceId, workspaceId)).all();
  return new Map(rows.map((row) => [row.id, { slug: row.slug, category: row.category }]));
}

/** The row of a status by slug; undefined for a workspace that has no rows yet or no such status. */
export function getStatusRow(workspaceId: string, slug: string, db: Db | Tx = initDb()): Row | undefined {
  return db.select().from(statuses).where(and(eq(statuses.workspaceId, workspaceId), eq(statuses.slug, slug))).get();
}

/** One status by slug, or null. */
export function getStatus(workspaceId: string, slug: string, db: Db | Tx = initDb()): StatusConfig | null {
  return getStatuses(workspaceId, db).find((status) => status.id === slug) ?? null;
}

/** Whether a status slug is valid for this workspace. */
export function isValidStatusId(workspaceId: string, slug: string, db: Db | Tx = initDb()): boolean {
  return getStatus(workspaceId, slug, db) !== null;
}

/** The slug of the status new chats get (`todo` unless the workspace picked another). */
export function getDefaultStatusId(workspaceId: string, db: Db | Tx = initDb()): string {
  return getStatuses(workspaceId, db).find((status) => status.isDefault)?.id ?? 'todo';
}

/** Inserts statuses with new row ids (`slug` = the status id); a slug the workspace already has is skipped. Returns how many were inserted. */
export function insertStatuses(db: Db | Tx, workspaceId: string, list: StatusConfig[]): number {
  let inserted = 0;
  for (const status of list) {
    inserted += db
      .insert(statuses)
      .values({
        id: createId(),
        workspaceId,
        slug: status.id,
        title: status.label,
        color: status.color === undefined ? null : JSON.stringify(status.color),
        icon: status.icon ?? null,
        category: status.category,
        isDefault: status.isDefault,
        position: status.position,
      })
      .onConflictDoNothing()
      .returning({ id: statuses.id })
      .all().length;
  }
  return inserted;
}

/** Seeds the default statuses into a workspace that has none (idempotent); every write calls it first. */
export function initWorkspaceStatuses(workspaceId: string, db: Db | Tx = initDb()): void {
  const has = db.select({ n: sql<number>`count(*)` }).from(statuses).where(eq(statuses.workspaceId, workspaceId)).get()?.n ?? 0;
  if (!has) insertStatuses(db, workspaceId, getDefaultStatuses());
}
