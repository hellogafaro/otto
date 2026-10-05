import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SettingsManager } from '@earendil-works/pi-coding-agent';
import {
  OTTO_PI_EPHEMERAL_MAX_BACKOFF_MS,
  OTTO_PI_EPHEMERAL_QUERY_DEADLINE_MS,
  OTTO_PI_EPHEMERAL_RETRY_SETTINGS,
  OTTO_PI_RETRY_SETTINGS,
  createOttoSettingsManager,
} from './session-settings.ts';

describe('createOttoSettingsManager', () => {
  it('batches steering without changing follow-up defaults', () => {
    expect(createOttoSettingsManager().getSteeringMode()).toBe('all');
    expect(createOttoSettingsManager().getFollowUpMode()).toBe(SettingsManager.inMemory().getFollowUpMode());
  });
  it('pins the agent-level auto-retry policy', () => {
    const settings = createOttoSettingsManager();
    expect(settings.getRetryEnabled()).toBe(true);
    expect(settings.getRetrySettings()).toEqual({
      enabled: true,
      maxRetries: OTTO_PI_RETRY_SETTINGS.maxRetries,
      baseDelayMs: OTTO_PI_RETRY_SETTINGS.baseDelayMs,
    });
  });

  it('enables provider-level (pre-stream) retries that the SDK leaves off by default', () => {
    const settings = createOttoSettingsManager();
    expect(settings.getProviderRetrySettings()).toMatchObject({
      maxRetries: OTTO_PI_RETRY_SETTINGS.provider.maxRetries,
      maxRetryDelayMs: OTTO_PI_RETRY_SETTINGS.provider.maxRetryDelayMs,
    });
    // Documents the SDK default this policy overrides. If a future SDK turns
    // provider retries on by itself, this assertion is the cue to revisit.
    expect(SettingsManager.inMemory().getProviderRetrySettings().maxRetries).toBeUndefined();
  });

  it('uses a smaller retry policy for bounded ephemeral queries', () => {
    const settings = createOttoSettingsManager('ephemeral');
    expect(settings.getRetrySettings()).toEqual({
      enabled: true,
      maxRetries: OTTO_PI_EPHEMERAL_RETRY_SETTINGS.maxRetries,
      baseDelayMs: OTTO_PI_EPHEMERAL_RETRY_SETTINGS.baseDelayMs,
    });
    expect(settings.getProviderRetrySettings()).toMatchObject({
      maxRetries: OTTO_PI_EPHEMERAL_RETRY_SETTINGS.provider.maxRetries,
      maxRetryDelayMs: OTTO_PI_EPHEMERAL_RETRY_SETTINGS.provider.maxRetryDelayMs,
    });
    expect(OTTO_PI_EPHEMERAL_MAX_BACKOFF_MS).toBe(66_000);
    expect(OTTO_PI_EPHEMERAL_QUERY_DEADLINE_MS).toBe(115_000);
    expect(OTTO_PI_EPHEMERAL_MAX_BACKOFF_MS).toBeLessThan(
      OTTO_PI_EPHEMERAL_QUERY_DEADLINE_MS,
    );
  });

  it('keeps auto-compaction enabled', () => {
    expect(createOttoSettingsManager().getCompactionEnabled()).toBe(true);
  });

  it('ignores a .pi/settings.json in the working directory', () => {
    // A repo used as the session's working directory may ship Pi project
    // settings. The SDK's default SettingsManager.create(cwd, agentDir) merges
    // them (project scope is trusted by default) — a repo could silently turn
    // off retries or compaction for Otto sessions. The in-memory manager must
    // not see them.
    const cwd = mkdtempSync(join(tmpdir(), 'otto-pi-settings-'));
    try {
      mkdirSync(join(cwd, '.pi'));
      writeFileSync(
        join(cwd, '.pi', 'settings.json'),
        JSON.stringify({ retry: { enabled: false }, compaction: { enabled: false } }),
      );

      // Proves the default path would have honored the repo file…
      const fromDisk = SettingsManager.create(cwd, join(cwd, 'agent-dir'));
      expect(fromDisk.getRetryEnabled()).toBe(false);
      expect(fromDisk.getCompactionEnabled()).toBe(false);

      // …and that Otto's manager does not.
      const settings = createOttoSettingsManager();
      expect(settings.getRetryEnabled()).toBe(true);
      expect(settings.getCompactionEnabled()).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('returns a fresh manager per call so sessions cannot leak settings into each other', () => {
    const a = createOttoSettingsManager('ephemeral');
    const b = createOttoSettingsManager('ephemeral');
    expect(a).not.toBe(b);
    a.setRetryEnabled(false);
    expect(a.getRetryEnabled()).toBe(false);
    expect(b.getRetryEnabled()).toBe(true);
  });
});
