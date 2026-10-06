import { describe, it, expect, afterEach } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createScriptRuntimeEnv } from './sandbox-env.ts';

describe('sandbox-env', () => {
  const createdDirs: string[] = [];

  const mkTemp = () => {
    const dir = mkdtempSync(join(tmpdir(), 'sandbox-env-'));
    createdDirs.push(dir);
    return dir;
  };

  afterEach(() => {
    for (const dir of createdDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('passes only allow-listed host vars', () => {
    const env = createScriptRuntimeEnv({ language: 'node', dataDir: mkTemp() }, {
      PATH: '/usr/bin',
      SAFE_VAR: 'ok',
      ANTHROPIC_API_KEY: 'secret',
      ENCRYPTION_KEY: 'secret',
    });
    expect(env.PATH).toBe('/usr/bin');
    expect(env.SAFE_VAR).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.ENCRYPTION_KEY).toBeUndefined();
  });

  it('sets python/uv cache and temp dirs inside data directory', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'sandbox-env-python-'));
    createdDirs.push(dataDir);

    const env = createScriptRuntimeEnv({
      language: 'python3',
      dataDir,
    }, {
      HOME: '/home/u',
      OPENAI_API_KEY: 'secret',
    });

    expect(env.HOME).toBe('/home/u');
    expect(env.OPENAI_API_KEY).toBeUndefined();

    expect(env.TMPDIR).toBe(join(dataDir, '.tmp'));
    expect(env.TMP).toBe(join(dataDir, '.tmp'));
    expect(env.TEMP).toBe(join(dataDir, '.tmp'));
    expect(env.UV_CACHE_DIR).toBe(join(dataDir, '.uv-cache'));
    expect(env.XDG_CACHE_HOME).toBe(join(dataDir, '.cache'));
    expect(env.PYTHONPYCACHEPREFIX).toBe(join(dataDir, '.pycache'));

    expect(existsSync(env.TMPDIR!)).toBe(true);
    expect(existsSync(env.UV_CACHE_DIR!)).toBe(true);
    expect(existsSync(env.XDG_CACHE_HOME!)).toBe(true);
    expect(existsSync(env.PYTHONPYCACHEPREFIX!)).toBe(true);
  });

  it('does not add python-specific cache vars for node runtime', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'sandbox-env-node-'));
    createdDirs.push(dataDir);

    const env = createScriptRuntimeEnv({
      language: 'node',
      dataDir,
    });

    expect(env.TMPDIR).toBe(join(dataDir, '.tmp'));
    expect(env.UV_CACHE_DIR).toBeUndefined();
    expect(env.XDG_CACHE_HOME).toBeUndefined();
    expect(env.PYTHONPYCACHEPREFIX).toBeUndefined();
  });
});
