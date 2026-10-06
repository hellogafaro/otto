import { describe, expect, it } from 'bun:test';
import { openDb } from '../../db/index.ts';
import { pushSchema } from '../../db/push.ts';
import { createLabel, createMissingLabels, deleteLabel, generateLabelSlug, moveLabel, reorderLabels, updateLabel } from '../crud.ts';
import { getEntityLabels, getLabeledEntities, removeEntityLabel, setEntityLabel } from '../entities.ts';
import { getDefaultLabelConfig, getLabel, getLabels, getLabelsFlat, initWorkspaceLabels, isValidLabelId } from '../storage.ts';
import { labels } from '../schema.ts';
import { flattenLabels } from '../tree.ts';

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

describe('labels: slugs, nesting, order', () => {
  it('gives each label a createId() row id and the slug of its name, unique per workspace', async () => {
    const db = await setup();
    const bug = createLabel(WS, { name: 'Bug', color: 'foreground/50' }, db);
    const again = createLabel(WS, { name: 'Bug' }, db);
    expect([bug.id, again.id]).toEqual(['bug', 'bug-2']);
    expect(createLabel(OTHER, { name: 'Bug' }, db).id).toBe('bug'); // another workspace has its own
    for (const row of db.select().from(labels).all()) expect(row.id).toMatch(/^[a-z0-9]{12}$/);
    // the database refuses a second row with the same slug in a workspace, whatever the code does
    const row = db.select().from(labels).all()[0]!;
    expect(() => db.insert(labels).values({ ...row, id: 'zzzzzzzzzzzz' }).run()).toThrow();
  });

  it('nests through parentId and reads back as a tree in order', async () => {
    const db = await setup();
    createLabel(WS, { name: 'Development' }, db);
    createLabel(WS, { name: 'Code', parentId: 'development' }, db);
    createLabel(WS, { name: 'Bug', parentId: 'development' }, db);
    createLabel(WS, { name: 'Content' }, db);
    const tree = getLabels(WS, db);
    expect(tree.map((l) => l.id)).toEqual(['development', 'content']);
    expect(tree[0]!.children!.map((l) => l.id)).toEqual(['code', 'bug']);
    expect(getLabelsFlat(WS, db).map((l) => l.id)).toEqual(['development', 'code', 'bug', 'content']);
    expect(code(() => createLabel(WS, { name: 'X', parentId: 'nope' }, db))).toBe('not_found');

    reorderLabels(WS, 'development', ['bug', 'code'], db);
    expect(getLabels(WS, db)[0]!.children!.map((l) => l.id)).toEqual(['bug', 'code']);
    reorderLabels(WS, null, ['content'], db); // a label left out keeps its place after the listed ones
    expect(getLabels(WS, db).map((l) => l.id)).toEqual(['content', 'development']);
    expect(code(() => reorderLabels(WS, null, ['nope'], db))).toBe('invalid');

    moveLabel(WS, 'code', null, db);
    expect(getLabels(WS, db).map((l) => l.id)).toEqual(['content', 'development', 'code']);
    expect(code(() => moveLabel(WS, 'development', 'bug', db))).toBe('invalid'); // into its own descendant
    expect(code(() => moveLabel(WS, 'development', 'development', db))).toBe('invalid');
  });

  it('updates the title, color, value type and rules, never the slug', async () => {
    const db = await setup();
    createLabel(WS, { name: 'Priority', valueType: 'number', color: { light: '#fff', dark: '#000' } }, db);
    const updated = updateLabel(WS, 'priority', { name: 'Urgency', autoRules: [{ pattern: 'urgent', flags: 'i' }] }, db);
    expect(updated).toMatchObject({ id: 'priority', name: 'Urgency', valueType: 'number', color: { light: '#fff', dark: '#000' }, autoRules: [{ pattern: 'urgent', flags: 'i' }] });
    expect(updateLabel(WS, 'priority', { valueType: '', autoRules: [] }, db).valueType).toBeUndefined();
    expect(getLabel(WS, 'priority', db)?.autoRules).toBeUndefined();
    expect(code(() => updateLabel(WS, 'nope', { name: 'x' }, db))).toBe('not_found');
    expect(code(() => updateLabel(WS, 'priority', { autoRules: [{ pattern: '(' }] }, db))).toBe('invalid');
    expect(code(() => updateLabel(WS, 'priority', { autoRules: [{ pattern: 'x', semantic: 'Is it x?' }] }, db))).toBe('invalid');
    expect(code(() => updateLabel(WS, 'priority', { autoRules: [{ semantic: 'Is it urgent?', threshold: 2 }] }, db))).toBe('invalid');
    expect(updateLabel(WS, 'priority', { autoRules: [{ semantic: 'Is it urgent?', threshold: 0.8 }] }, db).autoRules).toHaveLength(1);
  });

  it('deleting a label takes its children and their assignments with it', async () => {
    const db = await setup();
    createLabel(WS, { name: 'Development' }, db);
    createLabel(WS, { name: 'Bug', parentId: 'development' }, db);
    createLabel(WS, { name: 'Content' }, db);
    setEntityLabel(WS, 'task:aaaaaaaaaaaa', 'bug', null, db);
    setEntityLabel(WS, 'task:aaaaaaaaaaaa', 'content', null, db);
    expect(deleteLabel(WS, 'development', db)).toEqual({ stripped: 0 }); // no chats in this workspace
    expect(getLabelsFlat(WS, db).map((l) => l.id)).toEqual(['content']);
    expect(getEntityLabels(WS, 'task:aaaaaaaaaaaa', db)).toEqual([{ label: 'content', value: null }]);
    expect(code(() => deleteLabel(WS, 'development', db))).toBe('not_found');
  });

  it('seeds the defaults into a workspace that has none, once', async () => {
    const db = await setup();
    initWorkspaceLabels(WS, db);
    initWorkspaceLabels(WS, db);
    const expected = flattenLabels(getDefaultLabelConfig().labels).map((l) => l.id);
    expect(getLabelsFlat(WS, db).map((l) => l.id)).toEqual(expected);
    expect(getLabels(OTHER, db)).toEqual([]); // reading never seeds
    expect(isValidLabelId(WS, 'bug', db)).toBe(true);
  });
});

describe('labels_entities', () => {
  it('assigns, replaces the value, lists both ways and removes', async () => {
    const db = await setup();
    createLabel(WS, { name: 'Priority', valueType: 'number' }, db);
    createLabel(WS, { name: 'Bug' }, db);
    setEntityLabel(WS, 'chat:aaaaaaaaaaaa', 'priority', '3', db);
    setEntityLabel(WS, 'chat:aaaaaaaaaaaa', 'bug', undefined, db);
    setEntityLabel(WS, 'library:bbbbbbbbbbbb', 'bug', null, db);
    setEntityLabel(WS, 'chat:aaaaaaaaaaaa', 'priority', '5', db); // the primary key (label, entity) keeps one row
    expect(getEntityLabels(WS, 'chat:aaaaaaaaaaaa', db).sort((a, b) => a.label.localeCompare(b.label))).toEqual([
      { label: 'bug', value: null },
      { label: 'priority', value: '5' },
    ]);
    expect(getLabeledEntities(WS, 'bug', db).map((r) => r.entity).sort()).toEqual(['chat:aaaaaaaaaaaa', 'library:bbbbbbbbbbbb']);
    expect(getLabeledEntities(WS, 'nope', db)).toEqual([]);
    expect(getEntityLabels(OTHER, 'chat:aaaaaaaaaaaa', db)).toEqual([]); // bounded by workspace
    removeEntityLabel(WS, 'chat:aaaaaaaaaaaa', 'bug', db);
    removeEntityLabel(WS, 'chat:aaaaaaaaaaaa', 'bug', db); // not carrying it is fine
    expect(getEntityLabels(WS, 'chat:aaaaaaaaaaaa', db)).toEqual([{ label: 'priority', value: '5' }]);
  });

  it('refuses an unknown label and a malformed entity', async () => {
    const db = await setup();
    expect(code(() => setEntityLabel(WS, 'chat:aaaaaaaaaaaa', 'nope', null, db))).toBe('not_found');
    createLabel(WS, { name: 'Bug' }, db);
    expect(code(() => setEntityLabel(WS, 'not an entity', 'bug', null, db))).toBe('invalid');
    expect(code(() => getEntityLabels(WS, '', db))).toBe('invalid');
  });
});

describe('createMissingLabels', () => {
  it('passes through labels that already exist', async () => {
    const db = await setup();
    createLabel(WS, { name: 'Bug', color: 'foreground/50' }, db);
    expect(createMissingLabels(WS, ['bug'], db)).toEqual(['bug']);
    expect(getLabelsFlat(WS, db)).toHaveLength(1);
  });

  it('creates missing labels with a titlecased name, keeping the value', async () => {
    const db = await setup();
    expect(createMissingLabels(WS, ['morning-briefing', 'priority::3'], db)).toEqual(['morning-briefing', 'priority::3']);
    const flat = getLabelsFlat(WS, db);
    expect(flat.find((l) => l.id === 'morning-briefing')).toMatchObject({ name: 'Morning Briefing', color: 'foreground/50' });
    expect(flat.find((l) => l.id === 'priority')?.name).toBe('Priority');
  });

  it('passes through valued entries of an existing label, invalid ids and an empty list', async () => {
    const db = await setup();
    createLabel(WS, { name: 'Priority' }, db);
    expect(createMissingLabels(WS, ['priority::high'], db)).toEqual(['priority::high']);
    expect(createMissingLabels(WS, ['INVALID_FORMAT', '--bad'], db)).toEqual(['INVALID_FORMAT', '--bad']);
    expect(createMissingLabels(WS, [], db)).toEqual([]);
    expect(getLabelsFlat(WS, db)).toHaveLength(1);
  });
});

describe('generateLabelSlug', () => {
  it('never ends in a hyphen after the 30-char cut and folds accents', () => {
    const long = generateLabelSlug('TASK-powershell-fejlesztési-képzés-1');
    expect(long.length).toBeLessThanOrEqual(30);
    expect(long).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(long.startsWith('task-powershell-fejlesztesi')).toBe(true);
    expect(generateLabelSlug('  Café & Crème  ')).toBe('cafe-creme');
    expect(generateLabelSlug('TASK-otto-pages-feature-1')).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });
});
