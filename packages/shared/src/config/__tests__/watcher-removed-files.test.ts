/**
 * Labels, statuses, workspace permissions and routines are database rows now, so the ConfigWatcher no longer watches
 * their files: a change to `labels/config.json`, `statuses/config.json` (+ `icons/`), `permissions.json` or
 * `automations.json` calls nothing.
 */
import { afterAll, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigWatcher, type ConfigWatcherCallbacks } from '../watcher.ts';

const root = mkdtempSync(join(tmpdir(), 'otto-watcher-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

it('calls no callback for the files that moved into the database, while a still-watched file does', async () => {
  const called: string[] = [];
  const callbacks = new Proxy({}, { get: (_target, name) => () => void called.push(String(name)) }) as ConfigWatcherCallbacks;
  const watcher = new ConfigWatcher(root, callbacks);
  watcher.start();
  try {
    mkdirSync(join(root, 'labels'));
    mkdirSync(join(root, 'statuses', 'icons'), { recursive: true });
    writeFileSync(join(root, 'labels', 'config.json'), '{}');
    writeFileSync(join(root, 'statuses', 'config.json'), '{}');
    writeFileSync(join(root, 'statuses', 'icons', 'todo.svg'), '<svg/>');
    writeFileSync(join(root, 'permissions.json'), '{}');
    writeFileSync(join(root, 'automations.json'), '{}');
    for (const file of ['labels/config.json', 'statuses/config.json', 'statuses/icons/todo.svg', 'permissions.json', 'automations.json']) watcher.notifyFileChange(file);
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(called).toEqual([]);

    mkdirSync(join(root, 'sources', 'linear'), { recursive: true });
    writeFileSync(join(root, 'sources', 'linear', 'guide.md'), '# Linear');
    watcher.notifyFileChange('sources/linear/guide.md');
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(called.length).toBeGreaterThan(0);
  } finally {
    watcher.stop();
  }
});
