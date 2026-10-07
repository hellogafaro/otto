/**
 * Status CRUD Operations
 *
 * Create, update, delete and reorder a workspace's statuses (rows of `statuses`).
 * Enforces business rules (fixed statuses, the one default, unique slugs).
 * Deleting a status moves the chats that carry it to `todo` (`chats.status_id`) and tells the session manager.
 */

import { and, eq, sql } from 'drizzle-orm';
import { initDb, type Db, type Tx } from '../db/index.ts';
import { domainError } from '../utils/errors.ts';
import { statuses } from './schema.ts';
import { FIXED_STATUS_IDS, getStatus, getStatusRow, initWorkspaceStatuses, MAX_STATUS_ICON } from './storage.ts';
import type { CreateStatusInput, StatusConfig, UpdateStatusInput } from './types.ts';
import { notifyChatsChange, updateChatsStatus } from '../sessions/chats.ts';

/**
 * Generate URL-safe slug from label
 */
function generateStatusSlug(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 30);
}

/** Throws `invalid` unless the icon is an emoji or short name, or an image data URL of at most 16 KB (a web address is not stored: give its image as a data URL). */
function assertIcon(icon: string): void {
  if (/^https?:\/\//i.test(icon)) throw domainError('invalid', 'A status icon is an emoji or an image data URL, not a web address');
  if (icon.startsWith('data:') && !/^data:image\//.test(icon)) throw domainError('invalid', 'A status icon data URL must be an image');
  if (icon.length > MAX_STATUS_ICON) throw domainError('invalid', `A status icon is at most ${MAX_STATUS_ICON} characters`);
}

/**
 * Create a new custom status, last in the order.
 * @throws `invalid` for a bad icon
 */
export function createStatus(workspaceId: string, input: CreateStatusInput, db: Db | Tx = initDb()): StatusConfig {
  if (input.icon) assertIcon(input.icon);
  initWorkspaceStatuses(workspaceId, db);

  // Generate unique slug
  const base = generateStatusSlug(input.label) || 'status';
  let slug = base;
  for (let suffix = 2; getStatusRow(workspaceId, slug, db); suffix++) slug = `${base}-${suffix}`;

  const last = db.select({ n: sql<number>`coalesce(max(${statuses.position}), -1)` }).from(statuses).where(eq(statuses.workspaceId, workspaceId)).get();
  db.insert(statuses)
    .values({
      id: crypto.randomUUID(),
      workspaceId,
      slug,
      title: input.label,
      color: input.color === undefined ? null : JSON.stringify(input.color),
      icon: input.icon ?? null,
      category: input.category,
      isDefault: false,
      position: (last?.n ?? -1) + 1,
    })
    .run();
  return getStatus(workspaceId, slug, db)!;
}

/**
 * Update a status (label, color, icon, category)
 * Cannot change the slug or the fixed/default flags
 * @throws `not_found`; `forbidden` when changing the category of a fixed status
 */
export function updateStatus(workspaceId: string, slug: string, updates: UpdateStatusInput, db: Db | Tx = initDb()): StatusConfig {
  initWorkspaceStatuses(workspaceId, db);
  const row = getStatusRow(workspaceId, slug, db);
  if (!row) throw domainError('not_found', `Status '${slug}' not found`);

  // Fixed statuses cannot change category
  if (FIXED_STATUS_IDS.includes(slug) && updates.category && updates.category !== row.category) {
    throw domainError('forbidden', 'Cannot change category of fixed status');
  }
  if (updates.icon) assertIcon(updates.icon);

  db.update(statuses)
    .set({
      ...(updates.label !== undefined && { title: updates.label }),
      ...(updates.color !== undefined && { color: JSON.stringify(updates.color) }),
      ...(updates.icon !== undefined && { icon: updates.icon || null }),
      ...(updates.category !== undefined && { category: updates.category }),
    })
    .where(eq(statuses.id, row.id))
    .run();
  return getStatus(workspaceId, slug, db)!;
}

/**
 * Make a status the one new chats get; the previous default stops being it (one default per workspace).
 * @throws `not_found`
 */
export function setDefaultStatus(workspaceId: string, slug: string, db: Db = initDb()): void {
  initWorkspaceStatuses(workspaceId, db);
  const row = getStatusRow(workspaceId, slug, db);
  if (!row) throw domainError('not_found', `Status '${slug}' not found`);
  db.transaction((tx) => {
    tx.update(statuses).set({ isDefault: false }).where(and(eq(statuses.workspaceId, workspaceId), eq(statuses.isDefault, true))).run();
    tx.update(statuses).set({ isDefault: true }).where(eq(statuses.id, row.id)).run();
  });
}

/**
 * Delete a status
 * @throws `not_found`; `forbidden` for a fixed or default status
 * @returns Number of chats that were moved to 'todo'
 */
export function deleteStatus(workspaceId: string, slug: string, db: Db | Tx = initDb()): { migrated: number } {
  initWorkspaceStatuses(workspaceId, db);
  const row = getStatusRow(workspaceId, slug, db);
  if (!row) throw domainError('not_found', `Status '${slug}' not found`);
  if (FIXED_STATUS_IDS.includes(slug)) throw domainError('forbidden', `Cannot delete fixed status '${slug}'`);
  if (row.isDefault) throw domainError('forbidden', `Cannot delete default status '${slug}'. Pick another default first.`);

  // Move its chats to 'todo' and delete it in one transaction
  const moved = db.transaction((tx) => {
    const ids = updateChatsStatus(tx, workspaceId, row.id, getStatusRow(workspaceId, 'todo', tx)?.id ?? null);
    tx.delete(statuses).where(eq(statuses.id, row.id)).run();
    return ids;
  });
  notifyChatsChange(workspaceId, moved);
  return { migrated: moved.length };
}

/**
 * Reorder statuses: the listed ones first in the given order, any left out after them.
 * @throws `invalid` for an unknown slug
 */
export function reorderStatuses(workspaceId: string, orderedSlugs: string[], db: Db | Tx = initDb()): void {
  initWorkspaceStatuses(workspaceId, db);
  const rows = db.select().from(statuses).where(eq(statuses.workspaceId, workspaceId)).orderBy(statuses.position).all();
  const bySlug = new Map(rows.map((row) => [row.slug, row]));
  for (const slug of orderedSlugs) {
    if (!bySlug.has(slug)) throw domainError('invalid', `Invalid status ID: ${slug}`);
  }
  const order = [...new Set(orderedSlugs), ...rows.map((row) => row.slug).filter((slug) => !orderedSlugs.includes(slug))];
  order.forEach((slug, position) => db.update(statuses).set({ position }).where(eq(statuses.id, bySlug.get(slug)!.id)).run());
}
