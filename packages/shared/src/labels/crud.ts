/**
 * Label CRUD Operations
 *
 * Create, update, delete, move and reorder for a workspace's label tree (rows of `labels`).
 * `slug` arguments are the label ids chats write (`bug`); a label's slug never changes, so a
 * rename is only its title. Deleting cascades: the label and its descendants lose their
 * `labels_entities` rows and are stripped from the chat headers that still carry them (chats
 * keep their labels in their headers until they move to the database).
 */

import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { getWorkspaceRootPath } from '../config/storage.ts';
import { initDb, type Db, type Tx } from '../db/index.ts';
import { createId } from '../id.ts';
import { domainError } from '../utils/errors.ts';
import { getDescendantIds, getLabelDisplayName } from './tree.ts';
import { extractLabelId, formatLabelEntry, parseLabelEntry } from './values.ts';
import { assertAutoRules } from './auto/validation.ts';
import { getLabelRow, getLabels, isValidLabelId, isValidLabelIdFormat } from './storage.ts';
import { labels, labelsEntities } from './schema.ts';
import type { CreateLabelInput, LabelConfig, UpdateLabelInput } from './types.ts';

/**
 * Generate URL-safe slug from name. Accents are folded first ("fejlesztési" →
 * "fejlesztesi", not "fejleszt-si"), and hyphens are trimmed after the 30-char cut:
 * trimming before it left ids like `task-powershell-fejleszt-k-pz-`, which the
 * label validator rejects, blocking every later label edit in the workspace.
 */
export function generateLabelSlug(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .substring(0, 30)
    .replace(/^-+|-+$/g, '');
}

/**
 * Create a new label under the parent (a slug) or at the root, last among its siblings.
 * The slug comes from the name and is made unique across the workspace.
 */
export function createLabel(workspaceId: string, input: CreateLabelInput, db: Db | Tx = initDb()): LabelConfig {
  if (input.autoRules) assertAutoRules(input.autoRules);
  const parent = input.parentId ? getLabelRow(workspaceId, input.parentId, db) : undefined;
  if (input.parentId && !parent) throw domainError('not_found', `Parent label '${input.parentId}' not found`);

  const base = generateLabelSlug(input.name);
  let slug = base;
  for (let suffix = 2; getLabelRow(workspaceId, slug, db); suffix++) slug = `${base}-${suffix}`;
  if (!isValidLabelIdFormat(slug)) throw domainError('invalid', `'${input.name}' does not make a label id`);

  const siblings = db
    .select({ n: sql<number>`coalesce(max(${labels.order}), -1)` })
    .from(labels)
    .where(and(eq(labels.workspaceId, workspaceId), parent ? eq(labels.parentId, parent.id) : sql`${labels.parentId} is null`))
    .get();
  const now = new Date();
  db.insert(labels)
    .values({
      id: createId(),
      workspaceId,
      parentId: parent?.id ?? null,
      slug,
      title: input.name,
      color: input.color === undefined ? null : JSON.stringify(input.color),
      valueType: input.valueType ?? null,
      autoRules: input.autoRules?.length ? JSON.stringify(input.autoRules) : null,
      order: (siblings?.n ?? -1) + 1,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return {
    id: slug,
    name: input.name,
    ...(input.color !== undefined && { color: input.color }),
    ...(input.valueType && { valueType: input.valueType }),
    ...(input.autoRules?.length && { autoRules: input.autoRules }),
  };
}

/**
 * Ensure all label entries reference labels that exist in the workspace.
 * For each entry, if the label ID doesn't exist, creates it with a
 * titlecased name derived from the slug. Returns resolved entries with the
 * actual created IDs (handles any slug mismatch from createLabel).
 *
 * Entries with invalid ID format are passed through unchanged.
 */
export function createMissingLabels(workspaceId: string, entries: string[], db: Db | Tx = initDb()): string[] {
  return entries.map(entry => {
    const { id: labelId, rawValue } = parseLabelEntry(entry)

    if (isValidLabelId(workspaceId, labelId, db)) return entry
    if (!isValidLabelIdFormat(labelId)) return entry

    // getLabelDisplayName with empty tree falls back to titlecased slug
    const created = createLabel(workspaceId, { name: getLabelDisplayName([], labelId), color: 'foreground/50' }, db)

    // Return entry with the actual created ID (handles slug mismatch)
    return formatLabelEntry(created.id, rawValue)
  })
}

/**
 * Update an existing label (name, color, valueType, autoRules; null clears the last two).
 * Cannot change the ID or hierarchy position.
 * @throws `not_found` if there is no such label
 */
export function updateLabel(workspaceId: string, slug: string, updates: UpdateLabelInput, db: Db | Tx = initDb()): LabelConfig {
  const row = getLabelRow(workspaceId, slug, db);
  if (!row) throw domainError('not_found', `Label '${slug}' not found`);
  if (updates.autoRules) assertAutoRules(updates.autoRules);

  db.update(labels)
    .set({
      ...(updates.name !== undefined && { title: updates.name }),
      ...(updates.color !== undefined && { color: JSON.stringify(updates.color) }),
      // valueType: set to a new value, or '' / null to revert to a boolean label
      ...(updates.valueType !== undefined && { valueType: updates.valueType || null }),
      ...(updates.autoRules !== undefined && { autoRules: updates.autoRules?.length ? JSON.stringify(updates.autoRules) : null }),
      updatedAt: new Date(),
    })
    .where(eq(labels.id, row.id))
    .run();
  return flattenFind(getLabels(workspaceId, db), slug)!;
}

const flattenFind = (nodes: LabelConfig[], slug: string): LabelConfig | undefined => {
  for (const node of nodes) {
    if (node.id === slug) return node;
    const found = flattenFind(node.children ?? [], slug);
    if (found) return found;
  }
  return undefined;
};

/**
 * Delete a label and all its descendants.
 * Removes their `labels_entities` rows and strips them from the chat headers that reference them.
 * @returns Number of chats that had labels stripped
 */
export function deleteLabel(workspaceId: string, slug: string, db: Db = initDb()): { stripped: number } {
  const tree = getLabels(workspaceId, db);
  if (!getLabelRow(workspaceId, slug, db)) throw domainError('not_found', `Label '${slug}' not found`);
  const removedSlugs = [slug, ...getDescendantIds(tree, slug)];

  db.transaction((tx) => {
    const ids = tx.select({ id: labels.id }).from(labels).where(and(eq(labels.workspaceId, workspaceId), inArray(labels.slug, removedSlugs))).all().map((row) => row.id);
    tx.delete(labelsEntities).where(and(eq(labelsEntities.workspaceId, workspaceId), inArray(labelsEntities.labelId, ids))).run();
    tx.delete(labels).where(inArray(labels.id, ids)).run();
  });

  // Strip all removed IDs from chats
  return { stripped: stripLabelsFromSessions(workspaceId, removedSlugs) };
}

/**
 * Reorder labels within a parent's children (or root level).
 * Provide the full ordered list of sibling slugs at that level.
 * @param parentSlug - null for root level, or the parent label's slug
 */
export function reorderLabels(workspaceId: string, parentSlug: string | null, orderedSlugs: string[], db: Db | Tx = initDb()): void {
  const parent = parentSlug ? getLabelRow(workspaceId, parentSlug, db) : undefined;
  if (parentSlug && !parent) throw domainError('not_found', `Parent label '${parentSlug}' not found`);
  const siblings = db
    .select()
    .from(labels)
    .where(and(eq(labels.workspaceId, workspaceId), parent ? eq(labels.parentId, parent.id) : sql`${labels.parentId} is null`))
    .orderBy(asc(labels.order))
    .all();
  const bySlug = new Map(siblings.map((row) => [row.slug, row]));
  for (const slug of orderedSlugs) {
    if (!bySlug.has(slug)) throw domainError('invalid', `Invalid label ID for reorder: '${slug}'`);
  }
  // Listed labels first in the given order, any left out keep their relative order after them.
  const order = [...new Set(orderedSlugs), ...siblings.map((row) => row.slug).filter((slug) => !orderedSlugs.includes(slug))];
  order.forEach((slug, position) => db.update(labels).set({ order: position }).where(eq(labels.id, bySlug.get(slug)!.id)).run());
}

/**
 * Move a label to a different parent (or to root level), last among its new siblings.
 * The label keeps its ID and children intact.
 * @param newParentSlug - null to move to root, or the target parent's slug
 */
export function moveLabel(workspaceId: string, slug: string, newParentSlug: string | null, db: Db | Tx = initDb()): void {
  const row = getLabelRow(workspaceId, slug, db);
  if (!row) throw domainError('not_found', `Label '${slug}' not found`);

  // Prevent moving a label into itself or its own descendant (would create a cycle)
  if (newParentSlug && (newParentSlug === slug || getDescendantIds(getLabels(workspaceId, db), slug).includes(newParentSlug))) {
    throw domainError('invalid', `Cannot move label '${slug}' into its own descendant '${newParentSlug}'`);
  }
  const parent = newParentSlug ? getLabelRow(workspaceId, newParentSlug, db) : undefined;
  if (newParentSlug && !parent) throw domainError('not_found', `Target parent '${newParentSlug}' not found`);

  const last = db
    .select({ n: sql<number>`coalesce(max(${labels.order}), -1)` })
    .from(labels)
    .where(and(eq(labels.workspaceId, workspaceId), parent ? eq(labels.parentId, parent.id) : sql`${labels.parentId} is null`))
    .get();
  db.update(labels).set({ parentId: parent?.id ?? null, order: (last?.n ?? -1) + 1, updatedAt: new Date() }).where(eq(labels.id, row.id)).run();
}

// ============================================================
// Internal Helpers
// ============================================================

/**
 * Strip deleted labels from all chats (their headers), one update per chat.
 * Removes entries matching a deleted label ID, including valued entries (e.g., "priority::3").
 * Uses extractLabelId to match both "bug" and "priority::3" style entries.
 */
function stripLabelsFromSessions(workspaceId: string, deletedLabelIds: string[]): number {
  const workspaceRootPath = getWorkspaceRootPath(workspaceId);
  if (!workspaceRootPath) return 0;
  // Dynamic import to avoid circular dependency with sessions module
  const { listSessions, updateSessionMetadata } = require('../sessions/storage.ts');
  const deleted = new Set(deletedLabelIds);

  let strippedCount = 0;
  for (const session of listSessions(workspaceRootPath)) {
    // Check if any entry matches a deleted label ID (handles both boolean and valued entries)
    if (session.labels?.some((entry: string) => deleted.has(extractLabelId(entry)))) {
      updateSessionMetadata(workspaceRootPath, session.id, { labels: session.labels.filter((entry: string) => !deleted.has(extractLabelId(entry))) });
      strippedCount++;
    }
  }

  return strippedCount;
}
