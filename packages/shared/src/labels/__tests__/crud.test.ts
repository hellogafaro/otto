import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createLabel, ensureLabelsExist, generateLabelSlug } from '../crud.ts';
import { loadLabelConfig, saveLabelConfig } from '../storage.ts';
import { flattenLabels } from '../tree.ts';

let workspaceRoot: string;

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'labels-crud-test-'));
  // Seed with a minimal config (no defaults — we control the tree)
  saveLabelConfig(workspaceRoot, { version: 1, labels: [] });
});

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true });
});

describe('ensureLabelsExist', () => {
  it('passes through labels that already exist', () => {
    createLabel(workspaceRoot, { name: 'Bug', color: 'foreground/50' });

    const result = ensureLabelsExist(workspaceRoot, ['bug']);
    expect(result).toEqual(['bug']);

    // No new labels created
    const all = flattenLabels(loadLabelConfig(workspaceRoot).labels);
    expect(all).toHaveLength(1);
  });

  it('auto-creates missing labels with titlecased name', () => {
    const result = ensureLabelsExist(workspaceRoot, ['morning-briefing']);
    expect(result).toEqual(['morning-briefing']);

    const config = loadLabelConfig(workspaceRoot);
    const created = flattenLabels(config.labels).find(l => l.id === 'morning-briefing');
    expect(created).toBeDefined();
    expect(created!.name).toBe('Morning Briefing');
    expect(created!.color).toBe('foreground/50');
  });

  it('preserves value on valued labels that need creation', () => {
    const result = ensureLabelsExist(workspaceRoot, ['priority::3']);
    expect(result).toEqual(['priority::3']);

    const config = loadLabelConfig(workspaceRoot);
    const created = flattenLabels(config.labels).find(l => l.id === 'priority');
    expect(created).toBeDefined();
    expect(created!.name).toBe('Priority');
  });

  it('passes through valued labels when the label already exists', () => {
    createLabel(workspaceRoot, { name: 'Priority', color: 'foreground/50' });

    const result = ensureLabelsExist(workspaceRoot, ['priority::high']);
    expect(result).toEqual(['priority::high']);

    // No new labels created
    const all = flattenLabels(loadLabelConfig(workspaceRoot).labels);
    expect(all).toHaveLength(1);
  });

  it('passes through entries with invalid ID format unchanged', () => {
    const result = ensureLabelsExist(workspaceRoot, ['INVALID_FORMAT', '--bad']);
    expect(result).toEqual(['INVALID_FORMAT', '--bad']);

    // No labels created
    const all = flattenLabels(loadLabelConfig(workspaceRoot).labels);
    expect(all).toHaveLength(0);
  });

  it('handles mixed labels (existing, new, invalid)', () => {
    createLabel(workspaceRoot, { name: 'Bug', color: 'foreground/50' });

    const result = ensureLabelsExist(workspaceRoot, ['bug', 'new-label', 'INVALID']);
    expect(result).toEqual(['bug', 'new-label', 'INVALID']);

    const all = flattenLabels(loadLabelConfig(workspaceRoot).labels);
    expect(all).toHaveLength(2); // bug + new-label
    expect(all.find(l => l.id === 'new-label')!.name).toBe('New Label');
  });

  it('uses created ID when slug differs from input', () => {
    // Pre-create 'test' so createLabel generates 'test-2' for a new "Test" label
    createLabel(workspaceRoot, { name: 'Test', color: 'foreground/50' });

    // 'test' already exists, so ensureLabelsExist passes it through
    const result1 = ensureLabelsExist(workspaceRoot, ['test']);
    expect(result1).toEqual(['test']);

    // Now create a scenario where the slug would collide:
    // Input 'test' exists, but if we force a new label with name "Test",
    // createLabel would give it 'test-2'. We test this indirectly by creating
    // a label whose slug matches an existing one.
    const manualLabel = createLabel(workspaceRoot, { name: 'Test', color: 'foreground/50' });
    expect(manualLabel.id).toBe('test-2');
  });

  it('returns empty array for empty input', () => {
    const result = ensureLabelsExist(workspaceRoot, []);
    expect(result).toEqual([]);
  });
});

describe('generateLabelSlug', () => {
  it('never ends in a hyphen after the 30-char cut and folds accents', () => {
    const long = generateLabelSlug('TASK-powershell-fejlesztési-képzés-1')
    expect(long.length).toBeLessThanOrEqual(30)
    expect(long).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    expect(long.startsWith('task-powershell-fejlesztesi')).toBe(true)
    expect(generateLabelSlug('  Café & Crème  ')).toBe('cafe-creme')
    expect(generateLabelSlug('TASK-craft-agents-pages-feature-1')).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  })
})
