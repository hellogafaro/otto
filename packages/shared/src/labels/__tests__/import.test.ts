import { createHash } from 'node:crypto';
import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getWorkspacePermissions } from '../../agent/permissions-config.ts';
import { openDb } from '../../db/index.ts';
import { pushSchema } from '../../db/push.ts';
import { INSTALL, getSetting } from '../../settings/index.ts';
import { DEFAULT_ICON_SVGS } from '../../statuses/default-icons.ts';
import { MAX_STATUS_ICON, getStatuses } from '../../statuses/storage.ts';
import { deleteLabel } from '../crud.ts';
import { initLabelsStatusesImport } from '../import.ts';
import { getLabels, getLabelsFlat } from '../storage.ts';

async function setup() {
  const db = openDb(':memory:');
  await pushSchema(db);
  return db;
}

// A workspace folder shaped like a real one (~/.otto/workspaces/<slug>)
const LABELS = {
  version: 1,
  labels: [
    { id: 'development', name: 'Development', color: { light: '#3B82F6', dark: '#60A5FA' }, children: [{ id: 'bug', name: 'Bug', color: 'text-destructive' }, { id: 'code', name: 'Code', autoRules: [{ pattern: 'TODO-(\\d+)', valueTemplate: '$1' }] }] },
    { id: 'priority', name: 'Priority', valueType: 'number' },
    { id: 'bug', name: 'A duplicate slug that must be skipped' },
  ],
};
const STATUSES = {
  version: 1,
  defaultStatusId: 'backlog',
  statuses: [
    { id: 'backlog', label: 'Backlog', category: 'open', isFixed: false, isDefault: true, order: 0 },
    { id: 'todo', label: 'Todo', category: 'open', isFixed: true, isDefault: false, order: 1 },
    { id: 'in-progress', label: 'In Progress', category: 'open', isFixed: false, isDefault: false, order: 2, icon: '🔥' },
    { id: 'review', label: 'Review', category: 'open', isFixed: false, isDefault: false, order: 3, icon: 'review-icon.svg' },
    { id: 'huge', label: 'Huge', category: 'open', isFixed: false, isDefault: false, order: 4 },
    { id: 'web', label: 'Web', category: 'open', isFixed: false, isDefault: false, order: 5, icon: 'https://example.com/i.svg' },
    { id: 'done', label: 'Done', category: 'closed', isFixed: true, isDefault: false, order: 6 },
    { id: 'cancelled', label: 'Cancelled', category: 'closed', isFixed: true, isDefault: false, order: 7 },
  ],
};
const PERMISSIONS = { allowedBashPatterns: ['^git\\s+status'], allowedMcpPatterns: [{ pattern: 'list', comment: 'all list calls' }] };

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'otto-labels-import-'));
  mkdirSync(join(root, 'labels'));
  mkdirSync(join(root, 'statuses', 'icons'), { recursive: true });
  writeFileSync(join(root, 'labels', 'config.json'), JSON.stringify(LABELS, null, 2));
  writeFileSync(join(root, 'statuses', 'config.json'), JSON.stringify(STATUSES, null, 2));
  for (const id of ['backlog', 'todo', 'done']) writeFileSync(join(root, 'statuses', 'icons', `${id}.svg`), DEFAULT_ICON_SVGS[id]!);
  writeFileSync(join(root, 'statuses', 'icons', 'review-icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');
  writeFileSync(join(root, 'statuses', 'icons', 'huge.svg'), `<svg xmlns="http://www.w3.org/2000/svg"><!-- ${'x'.repeat(MAX_STATUS_ICON)} --></svg>`);
  writeFileSync(join(root, 'permissions.json'), JSON.stringify(PERMISSIONS, null, 2));
  return root;
}

const hashTree = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => `${join(entry.parentPath, entry.name)}:${createHash('sha256').update(readFileSync(join(entry.parentPath, entry.name))).digest('hex')}`)
    .sort();

describe('initLabelsStatusesImport', () => {
  it('imports labels, statuses with inlined icons and permissions, and never touches the old files', async () => {
    const db = await setup();
    const root = fixture();
    const before = hashTree(root);

    const report = initLabelsStatusesImport(db, [{ id: 'ws-1', rootPath: root }]);
    expect(report).toMatchObject({ workspaces: 1, labels: 4, statuses: 8, permissions: 1, skipped: 1 });
    expect(report.warnings.some((w) => w.includes('huge.svg') && w.includes('dropped'))).toBe(true);
    expect(report.warnings.some((w) => w.includes('status web') && w.includes('dropped'))).toBe(true);

    // nested children became parentId; the old id is the slug; the duplicate slug was skipped
    const tree = getLabels('ws-1', db);
    expect(tree.map((l) => l.id)).toEqual(['development', 'priority']);
    expect(tree[0]!.children!.map((l) => l.id)).toEqual(['bug', 'code']);
    expect(tree[0]!.children![0]!.color).toBe('destructive'); // an old Tailwind color is migrated like the old loader did
    expect(tree[0]!.children![1]!.autoRules).toEqual([{ pattern: 'TODO-(\\d+)', valueTemplate: '$1' }]);
    expect(getLabelsFlat('ws-1', db).find((l) => l.id === 'priority')?.valueType).toBe('number');
    expect(getLabels('ws-2', db)).toEqual([]);

    const imported = getStatuses('ws-1', db);
    expect(imported.map((s) => s.id)).toEqual(['backlog', 'todo', 'in-progress', 'review', 'huge', 'web', 'done', 'cancelled']);
    expect(imported.filter((s) => s.isDefault).map((s) => s.id)).toEqual(['backlog']); // defaultStatusId, not the old isDefault flag
    const byId = Object.fromEntries(imported.map((s) => [s.id, s]));
    expect(byId['in-progress']!.icon).toBe('🔥');
    expect(byId['todo']!.icon).toBe(`data:image/svg+xml;base64,${Buffer.from(DEFAULT_ICON_SVGS['todo']!).toString('base64')}`);
    expect(byId['review']!.icon).toStartWith('data:image/svg+xml;base64,'); // a named file inline
    expect(byId['cancelled']!.icon).toStartWith('data:image/svg+xml;base64,'); // no file: the default icon
    expect(byId['huge']!.icon).toBeUndefined();
    expect(byId['web']!.icon).toBeUndefined();

    expect(getWorkspacePermissions('ws-1', db)).toEqual({ allowedBashPatterns: ['^git\\s+status'], allowedMcpPatterns: [{ pattern: 'list', comment: 'all list calls' }] });
    expect(getSetting(INSTALL, 'imports', db)['labelsStatuses:ws-1']).toBeGreaterThan(0);

    expect(hashTree(root)).toEqual(before); // nothing was written, changed or deleted
  });

  it('is idempotent: a second run changes nothing, and a label deleted later stays deleted', async () => {
    const db = await setup();
    const root = fixture();
    initLabelsStatusesImport(db, [{ id: 'ws-1', rootPath: root }]);
    deleteLabel('ws-1', 'priority', db);
    const labelsBefore = getLabelsFlat('ws-1', db).map((l) => l.id);
    const second = initLabelsStatusesImport(db, [{ id: 'ws-1', rootPath: root }]);
    expect(second).toMatchObject({ workspaces: 0, labels: 0, statuses: 0, permissions: 0 });
    expect(getLabelsFlat('ws-1', db).map((l) => l.id)).toEqual(labelsBefore);
    expect(getStatuses('ws-1', db)).toHaveLength(8);
  });

  it('seeds the defaults for a workspace with no old files, and imports a later workspace on its own', async () => {
    const db = await setup();
    const empty = mkdtempSync(join(tmpdir(), 'otto-labels-import-'));
    const first = initLabelsStatusesImport(db, [{ id: 'ws-1', rootPath: empty }]);
    expect(first.workspaces).toBe(1);
    expect(getLabelsFlat('ws-1', db).map((l) => l.id)).toContain('development');
    expect(getStatuses('ws-1', db).map((s) => s.id)).toEqual(['backlog', 'todo', 'needs-review', 'done', 'cancelled']);
    expect(getWorkspacePermissions('ws-1', db)).toEqual({});
    const root = fixture();
    const second = initLabelsStatusesImport(db, [{ id: 'ws-1', rootPath: empty }, { id: 'ws-2', rootPath: root }]);
    expect(second.workspaces).toBe(1);
    expect(getLabelsFlat('ws-2', db)).toHaveLength(4);
  });

  it('skips an unreadable or invalid file with a warning, never fatally', async () => {
    const db = await setup();
    const root = mkdtempSync(join(tmpdir(), 'otto-labels-import-'));
    mkdirSync(join(root, 'labels'));
    mkdirSync(join(root, 'statuses'));
    writeFileSync(join(root, 'labels', 'config.json'), '{not json');
    writeFileSync(join(root, 'statuses', 'config.json'), JSON.stringify({ version: 1, defaultStatusId: 'todo', statuses: [{ id: 'todo', label: 'Todo', category: 'open', isFixed: true, isDefault: true, order: 0 }] }));
    writeFileSync(join(root, 'permissions.json'), JSON.stringify({ allowedBashPatterns: 'nope' }));
    const report = initLabelsStatusesImport(db, [{ id: 'ws-1', rootPath: root }]);
    expect(report.warnings.length).toBe(3);
    expect(getStatuses('ws-1', db)).toHaveLength(5); // missing fixed statuses: the defaults
    expect(getLabelsFlat('ws-1', db).length).toBeGreaterThan(0); // unreadable labels file: the defaults
    expect(getWorkspacePermissions('ws-1', db)).toEqual({});
  });
});
