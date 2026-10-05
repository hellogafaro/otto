import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { CONFIG_DIR, DEFAULT_CONFIG_DIR_NAME, resolveConfigDir } from '../paths.ts';

// OSS #1062: OTTO_CONFIG_DIR must be the single switch for where the app keeps
// its state; every module joins onto CONFIG_DIR instead of homedir().
describe('resolveConfigDir', () => {
  it('defaults to ~/.otto', () => {
    expect(resolveConfigDir({}, '/Users/me')).toBe(join('/Users/me', DEFAULT_CONFIG_DIR_NAME));
    expect(resolveConfigDir({ OTTO_CONFIG_DIR: '' }, '/Users/me')).toBe(join('/Users/me', DEFAULT_CONFIG_DIR_NAME));
    expect(resolveConfigDir({ OTTO_CONFIG_DIR: '   ' }, '/Users/me')).toBe(join('/Users/me', DEFAULT_CONFIG_DIR_NAME));
  });

  it('honors OTTO_CONFIG_DIR', () => {
    expect(resolveConfigDir({ OTTO_CONFIG_DIR: '/tmp/otto-dev' }, '/Users/me')).toBe('/tmp/otto-dev');
    expect(resolveConfigDir({ OTTO_CONFIG_DIR: ' /tmp/otto-dev ' }, '/Users/me')).toBe('/tmp/otto-dev');
  });

  it('CONFIG_DIR is the resolver evaluated against the real environment', () => {
    expect(CONFIG_DIR).toBe(resolveConfigDir(process.env, homedir()));
  });
});
