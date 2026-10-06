import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SettingsManager, type ExtensionAPI, type InlineExtension } from '@earendil-works/pi-coding-agent';
import {
  OTTO_SYSTEM_PROMPT_EXTENSION_NAME,
  createOttoResourceLoader,
  createSystemPromptOverride,
} from './system-prompt-override.ts';

/**
 * Regression contract for otto#648.
 *
 * Pi rebuilds its own system prompt on every `session.prompt()` and whenever the
 * tool loadout changes. The only supported way to replace the whole prompt is a
 * `before_agent_start` handler returning `{ systemPrompt }`, which the SDK applies
 * per run. These tests pin that the override registers exactly that handler,
 * stays silent until Otto sets a prompt, and always returns the latest prompt.
 */

type Handler = (event: unknown, ctx: unknown) => unknown;

function loadInline(extension: InlineExtension): Map<string, Handler[]> {
  const handlers = new Map<string, Handler[]>();
  const pi = {
    on(event: string, handler: Handler) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      return () => {};
    },
  } as unknown as ExtensionAPI;
  const factory = typeof extension === 'function' ? extension : extension.factory;
  void factory(pi);
  return handlers;
}

function invoke(handlers: Map<string, Handler[]>): unknown {
  const [handler, ...rest] = handlers.get('before_agent_start') ?? [];
  expect(handler).toBeDefined();
  expect(rest).toHaveLength(0);
  return handler!({ type: 'before_agent_start', prompt: 'hi', systemPrompt: 'SDK PROMPT' }, {});
}

describe('createSystemPromptOverride', () => {
  it('registers a single hidden before_agent_start handler under a stable inline name', () => {
    const override = createSystemPromptOverride();
    expect(override.extension).toMatchObject({ name: OTTO_SYSTEM_PROMPT_EXTENSION_NAME, hidden: true });
    const handlers = loadInline(override.extension);
    expect([...handlers.keys()]).toEqual(['before_agent_start']);
  });

  it('leaves the SDK prompt alone until a prompt is set', () => {
    const override = createSystemPromptOverride();
    const handlers = loadInline(override.extension);
    expect(override.current()).toBeUndefined();
    expect(invoke(handlers)).toBeUndefined();
  });

  it('forces the exact Otto prompt once set, on every run', () => {
    const override = createSystemPromptOverride();
    const handlers = loadInline(override.extension);
    override.set('OTTO_PROMPT');
    expect(invoke(handlers)).toEqual({ systemPrompt: 'OTTO_PROMPT' });
    expect(invoke(handlers)).toEqual({ systemPrompt: 'OTTO_PROMPT' });
    expect(override.current()).toBe('OTTO_PROMPT');
  });

  it('a later set() replaces the forced prompt for the next run', () => {
    const override = createSystemPromptOverride();
    const handlers = loadInline(override.extension);
    override.set('FIRST');
    override.set('SECOND');
    expect(invoke(handlers)).toEqual({ systemPrompt: 'SECOND' });
  });
});

describe('createOttoResourceLoader', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('loads the override as an inline extension through the SDK loader', async () => {
    const root = mkdtempSync(join(tmpdir(), 'otto-pi-loader-'));
    dirs.push(root);
    const loader = await createOttoResourceLoader({
      cwd: root,
      agentDir: join(root, '.pi-agent'),
      settingsManager: SettingsManager.inMemory(),
      systemPromptOverride: createSystemPromptOverride(),
    });
    const { extensions, errors } = loader.getExtensions();
    expect(errors).toEqual([]);
    expect(extensions.some(ext => ext.path === `<inline:${OTTO_SYSTEM_PROMPT_EXTENSION_NAME}>`)).toBe(true);
  });

  it('reads no AGENTS.md or CLAUDE.md: instructions come from the database', async () => {
    const root = mkdtempSync(join(tmpdir(), 'otto-pi-loader-'));
    dirs.push(root);
    writeFileSync(join(root, 'AGENTS.md'), 'project rules');
    writeFileSync(join(root, 'CLAUDE.md'), 'claude rules');
    mkdirSync(join(root, '.pi-agent'), { recursive: true });
    writeFileSync(join(root, '.pi-agent', 'AGENTS.md'), 'global rules');
    const loader = await createOttoResourceLoader({
      cwd: root,
      agentDir: join(root, '.pi-agent'),
      settingsManager: SettingsManager.inMemory(),
      systemPromptOverride: createSystemPromptOverride(),
    });
    expect(loader.getAgentsFiles().agentsFiles).toEqual([]);
  });
});
