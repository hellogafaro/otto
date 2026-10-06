/**
 * Label storage: a workspace's labels are rows of `labels` (./schema.ts), a tree through `parentId`.
 *
 * The functions here take the workspace id and give `LabelConfig`s, whose `id` is the row's `slug`: the id
 * chats, routines and agents write (`bug`, `priority::3`), kept from the old `labels/config.json` so those
 * strings keep resolving. A new workspace is seeded with the default labels (Development + Content groups,
 * Priority, Project) by `initWorkspaceLabels`; reading never writes. Labels are visual by color only.
 * Assigning labels to chats, library items, tasks and projects is `./entities.ts`.
 */

import { and, asc, eq, sql } from 'drizzle-orm';
import { initDb, type Db, type Tx } from '../db/index.ts';
import { createId } from '../id.ts';
import type { EntityColor } from '../colors/types.ts';
import { labels } from './schema.ts';
import type { AutoLabelRule, LabelConfig, WorkspaceLabelConfig } from './types.ts';
import { flattenLabels, findLabelById } from './tree.ts';

type Row = typeof labels.$inferSelect;

const readJson = <T>(text: string | null): T | undefined => {
  if (text == null) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
};

function toConfig(row: Row): LabelConfig {
  const color = readJson<EntityColor>(row.color);
  const autoRules = readJson<AutoLabelRule[]>(row.autoRules);
  return {
    id: row.slug,
    name: row.title,
    ...(color !== undefined && { color }),
    ...(row.valueType && { valueType: row.valueType as LabelConfig['valueType'] }),
    ...(autoRules && { autoRules }),
  };
}

/** The row of a label by its slug, or undefined. */
export function getLabelRow(workspaceId: string, slug: string, db: Db | Tx = initDb()): Row | undefined {
  return db.select().from(labels).where(and(eq(labels.workspaceId, workspaceId), eq(labels.slug, slug))).get();
}

/** The label tree of a workspace: root labels with nested `children`, siblings in their order. */
export function getLabels(workspaceId: string, db: Db | Tx = initDb()): LabelConfig[] {
  const rows = db.select().from(labels).where(eq(labels.workspaceId, workspaceId)).orderBy(asc(labels.position), sql`rowid`).all();
  const nodes = new Map(rows.map((row) => [row.id, toConfig(row)]));
  const roots: LabelConfig[] = [];
  for (const row of rows) {
    const node = nodes.get(row.id)!;
    const parent = row.parentId ? nodes.get(row.parentId) : undefined;
    if (parent) (parent.children ??= []).push(node);
    else roots.push(node);
  }
  return roots;
}

/** Every label of a workspace as one list (the tree flattened depth-first). */
export function getLabelsFlat(workspaceId: string, db: Db | Tx = initDb()): LabelConfig[] {
  return flattenLabels(getLabels(workspaceId, db));
}

/** One label by slug (searches the whole tree), or null. */
export function getLabel(workspaceId: string, slug: string, db: Db | Tx = initDb()): LabelConfig | null {
  const row = getLabelRow(workspaceId, slug, db);
  return row ? (findLabelById(getLabels(workspaceId, db), slug) ?? toConfig(row)) : null;
}

/** Whether a label slug exists in this workspace. */
export function isValidLabelId(workspaceId: string, slug: string, db: Db | Tx = initDb()): boolean {
  return getLabelRow(workspaceId, slug, db) !== undefined;
}

/**
 * Validate label ID format.
 * Simple slug: lowercase alphanumeric + hyphens, no leading/trailing hyphens.
 * Examples: "bug", "frontend", "my-label"
 */
export function isValidLabelIdFormat(labelId: string): boolean {
  if (!labelId) return false;
  const SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
  return SLUG_PATTERN.test(labelId);
}

/**
 * Inserts a tree of labels under `parentId` with new row ids, `slug` = the node's id and `position` = its position.
 * A node whose slug the workspace already has is skipped with its children; returns how many were skipped.
 */
export function insertLabelTree(db: Db | Tx, workspaceId: string, nodes: LabelConfig[], parentId: string | null = null): { inserted: number; skipped: number } {
  let inserted = 0;
  let skipped = 0;
  nodes.forEach((node, position) => {
    const id = createId();
    const row = {
      id,
      workspaceId,
      parentId,
      slug: node.id,
      title: node.name,
      color: node.color === undefined ? null : JSON.stringify(node.color),
      valueType: node.valueType ?? null,
      autoRules: node.autoRules?.length ? JSON.stringify(node.autoRules) : null,
      position,
    };
    if (db.insert(labels).values(row).onConflictDoNothing().returning({ id: labels.id }).all().length === 0) {
      skipped += 1 + countTree(node.children ?? []);
      return;
    }
    inserted++;
    const children = insertLabelTree(db, workspaceId, node.children ?? [], id);
    inserted += children.inserted;
    skipped += children.skipped;
  });
  return { inserted, skipped };
}

const countTree = (nodes: LabelConfig[]): number => nodes.reduce((sum, node) => sum + 1 + countTree(node.children ?? []), 0);

/** Seeds the default labels into a workspace that has none (idempotent). */
export function initWorkspaceLabels(workspaceId: string, db: Db | Tx = initDb()): void {
  const has = db.select({ n: sql<number>`count(*)` }).from(labels).where(eq(labels.workspaceId, workspaceId)).get()?.n ?? 0;
  if (!has) insertLabelTree(db, workspaceId, getDefaultLabelConfig().labels);
}

/**
 * Get default label configuration.
 * Provides a starter set of labels organized into two complementary color families:
 * - Development (blue family): Code, Bug, Automation
 * - Content (purple family): Writing, Research, Design
 * Plus flat valued labels: Priority (number), Project (string)
 *
 * Children use hue-shifted shades of their parent color to show visual hierarchy.
 */
export function getDefaultLabelConfig(): WorkspaceLabelConfig {
  return {
    version: 1,
    labels: [
      {
        id: 'development',
        name: 'Development',
        color: { light: '#3B82F6', dark: '#60A5FA' },
        children: [
          {
            id: 'code',
            name: 'Code',
            color: { light: '#4F46E5', dark: '#818CF8' }, // indigo shift
          },
          {
            id: 'bug',
            name: 'Bug',
            color: { light: '#0EA5E9', dark: '#38BDF8' }, // sky shift
          },
          {
            id: 'automation',
            name: 'Automation',
            color: { light: '#06B6D4', dark: '#22D3EE' }, // cyan shift
          },
        ],
      },
      {
        id: 'content',
        name: 'Content',
        color: { light: '#8B5CF6', dark: '#A78BFA' },
        children: [
          {
            id: 'writing',
            name: 'Writing',
            color: { light: '#7C3AED', dark: '#C4B5FD' }, // deeper violet
          },
          {
            id: 'research',
            name: 'Research',
            color: { light: '#A855F7', dark: '#C084FC' }, // lighter purple
          },
          {
            id: 'design',
            name: 'Design',
            color: { light: '#D946EF', dark: '#E879F9' }, // fuchsia shift
          },
        ],
      },
      {
        id: 'priority',
        name: 'Priority',
        color: { light: '#F59E0B', dark: '#FBBF24' },
        valueType: 'number',
      },
      {
        id: 'project',
        name: 'Project',
        color: 'foreground/50',
        valueType: 'string',
      },
    ],
  };
}
