import { describe, expect, it } from 'bun:test';
import { openDb } from '../db/index.ts';
import { pushSchema } from '../db/push.ts';
import { createStatus, deleteStatus, reorderStatuses, setDefaultStatus, updateStatus } from './crud.ts';
import { statuses } from './schema.ts';
import { getDefaultStatuses, getStatus, getStatusCategory, getStatuses, getDefaultStatusId, initWorkspaceStatuses, isValidStatusId, MAX_STATUS_ICON } from './storage.ts';
import { validateSessionStatus } from './validation.ts';

const WS = 'ws-aaaa';
const OTHER = 'ws-bbbb';

async function setup() {
  const db = openDb(':memory:');
  await pushSchema(db);
  return db;
}

const code = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return (error as { code?: string }).code;
  }
};

const defaultCount = (db: Awaited<ReturnType<typeof setup>>, ws: string) => getStatuses(ws, db).filter((s) => s.isDefault).length;

describe('statuses', () => {
  it('reads as the defaults while a workspace has no rows, and seeds them once', async () => {
    const db = await setup();
    expect(getStatuses(WS, db).map((s) => s.id)).toEqual(['backlog', 'todo', 'needs-review', 'done', 'cancelled', 'archived']);
    expect(db.select().from(statuses).all()).toHaveLength(0); // reading never writes
    initWorkspaceStatuses(WS, db);
    initWorkspaceStatuses(WS, db);
    expect(db.select().from(statuses).all()).toHaveLength(6);
    for (const row of db.select().from(statuses).all()) expect(row.id).toMatch(/^[a-z0-9]{12}$/);
    const todo = getStatus(WS, 'todo', db)!;
    expect(todo).toMatchObject({ isFixed: true, isDefault: true, category: 'open' });
    expect(todo.icon).toStartWith('data:image/svg+xml;base64,');
    expect(getDefaultStatuses().every((s) => s.icon!.length < MAX_STATUS_ICON)).toBe(true);
  });

  it('keeps exactly one default per workspace', async () => {
    const db = await setup();
    initWorkspaceStatuses(WS, db);
    initWorkspaceStatuses(OTHER, db);
    expect(getDefaultStatusId(WS, db)).toBe('todo');
    setDefaultStatus(WS, 'backlog', db);
    expect(defaultCount(db, WS)).toBe(1);
    expect(getDefaultStatusId(WS, db)).toBe('backlog');
    expect(getDefaultStatusId(OTHER, db)).toBe('todo'); // another workspace is untouched
    expect(createStatus(WS, { label: 'Doing', category: 'open' }, db).isDefault).toBe(false);
    expect(defaultCount(db, WS)).toBe(1);
    expect(code(() => setDefaultStatus(WS, 'nope', db))).toBe('not_found');
    // the default cannot be deleted
    expect(code(() => deleteStatus(WS, 'backlog', db))).toBe('forbidden');
  });

  it('creates with a unique slug, last in order, and validates the icon', async () => {
    const db = await setup();
    const doing = createStatus(WS, { label: 'In Progress', category: 'open', color: 'info', icon: '🔥' }, db);
    expect(doing).toMatchObject({ id: 'in-progress', label: 'In Progress', icon: '🔥', isFixed: false, isDefault: false, position: 6 });
    expect(createStatus(WS, { label: 'In Progress', category: 'open' }, db).id).toBe('in-progress-2');
    expect(code(() => createStatus(WS, { label: 'X', category: 'open', icon: 'https://example.com/i.svg' }, db))).toBe('invalid');
    expect(code(() => createStatus(WS, { label: 'X', category: 'open', icon: 'data:text/html;base64,AAAA' }, db))).toBe('invalid');
    expect(code(() => createStatus(WS, { label: 'X', category: 'open', icon: `data:image/png;base64,${'A'.repeat(MAX_STATUS_ICON)}` }, db))).toBe('invalid');
    expect(createStatus(WS, { label: 'Y', category: 'closed', icon: 'data:image/png;base64,AAAA' }, db).icon).toBe('data:image/png;base64,AAAA');
  });

  it('updates, protects the fixed ones and deletes only what is neither fixed nor default', async () => {
    const db = await setup();
    createStatus(WS, { label: 'Doing', category: 'open' }, db);
    expect(updateStatus(WS, 'doing', { label: 'Busy', category: 'closed' }, db)).toMatchObject({ id: 'doing', label: 'Busy', category: 'closed' });
    expect(updateStatus(WS, 'todo', { label: 'To do' }, db).label).toBe('To do');
    expect(code(() => updateStatus(WS, 'done', { category: 'open' }, db))).toBe('forbidden');
    expect(code(() => deleteStatus(WS, 'archived', db))).toBe('forbidden');
    expect(getStatus(WS, 'archived', db)).toMatchObject({ category: 'archived', isFixed: true, isDefault: false });
    expect(code(() => updateStatus(WS, 'nope', { label: 'x' }, db))).toBe('not_found');
    expect(code(() => deleteStatus(WS, 'todo', db))).toBe('forbidden');
    expect(code(() => deleteStatus(WS, 'nope', db))).toBe('not_found');
    expect(deleteStatus(WS, 'doing', db)).toEqual({ migrated: 0 });
    expect(isValidStatusId(WS, 'doing', db)).toBe(false);
  });

  it('reorders: the listed ones first, any left out after them', async () => {
    const db = await setup();
    reorderStatuses(WS, ['done', 'todo'], db);
    expect(getStatuses(WS, db).map((s) => s.id)).toEqual(['done', 'todo', 'backlog', 'needs-review', 'cancelled', 'archived']);
    expect(code(() => reorderStatuses(WS, ['nope'], db))).toBe('invalid');
  });

  it('answers by root path for chat storage: the defaults for a root that is not registered', () => {
    expect(getStatusCategory('/nowhere/at/all', 'done')).toBe('closed');
    expect(getStatusCategory('/nowhere/at/all', 'nope')).toBeNull();
    expect(validateSessionStatus('/nowhere/at/all', 'needs-review')).toBe('needs-review');
    expect(validateSessionStatus('/nowhere/at/all', 'deleted-status')).toBe('todo');
    expect(validateSessionStatus('/nowhere/at/all', undefined)).toBe('todo');
  });
});
