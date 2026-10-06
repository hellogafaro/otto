/**
 * Tests for AutomationSystem facade
 */

import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AutomationSystem, type SessionMetadataSnapshot } from './automation-system.ts';
import { openDb, type Db } from '../db/index.ts';
import { pushSchema } from '../db/push.ts';
import type { RoutineConfig } from './routine-types.ts';
import { createRoutine, updateRoutine } from './routines.ts';

describe('AutomationSystem', () => {
  let tempDir: string;
  let db: Db;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'automation-system-test-'));
    db = openDb(':memory:');
    await pushSchema(db);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const event = (matcher: string | undefined, prompt: string, extra: Partial<RoutineConfig> = {}): RoutineConfig =>
    ({ type: 'event', event: 'LabelAdd', ...(matcher ? { matcher } : {}), actions: [{ type: 'prompt', prompt }], ...extra });
  const addRoutine = (title: string, config: RoutineConfig, paused = false) =>
    createRoutine({ workspaceId: 'test-workspace', title, config, createdBy: 'user:aaaaaaaaaaaa', paused }, db);

  describe('constructor', () => {
    it('should create an AutomationSystem without routines', async () => {
      const system = new AutomationSystem({ workspaceRootPath: tempDir, workspaceId: 'test-workspace', db });

      expect(system.isDisposed()).toBe(false);
      expect(system.getConfig()).toEqual({ automations: {} });

      await system.dispose();
    });

    it('should read the active event routines of its workspace as matchers', async () => {
      addRoutine('Triage', event('test', 'echo hello', { permissionMode: 'safe' }));
      addRoutine('Paused', event('test', 'echo paused'), true);
      addRoutine('Daily', { type: 'schedule', schedule: { cron: '0 9 * * *' }, actions: [{ type: 'prompt', prompt: 'echo daily' }] });
      createRoutine({ workspaceId: 'other', title: 'Elsewhere', config: event('test', 'echo other'), createdBy: 'user:aaaaaaaaaaaa' }, db);

      const system = new AutomationSystem({ workspaceRootPath: tempDir, workspaceId: 'test-workspace', db });

      const matchers = system.getConfig()?.automations.LabelAdd;
      expect(matchers).toHaveLength(1);
      expect(matchers?.[0]).toMatchObject({ name: 'Triage', matcher: 'test', permissionMode: 'safe', actions: [{ type: 'prompt', prompt: 'echo hello' }] });
      expect(Object.keys(system.getConfig()?.automations ?? {})).toEqual(['LabelAdd']);

      await system.dispose();
    });

    it('should preserve thinkingLevel and labels on prompt actions', async () => {
      addRoutine('Review', event('review', 'Audit changes', { actions: [{ type: 'prompt', prompt: 'Audit changes', llmConnection: 'anthropic', model: 'claude-opus-4-7', thinkingLevel: 'high', labels: ['bug'] }] }));

      const system = new AutomationSystem({ workspaceRootPath: tempDir, workspaceId: 'test-workspace', db });

      expect(system.getConfig()?.automations.LabelAdd?.[0]?.actions[0]).toMatchObject({ type: 'prompt', thinkingLevel: 'high', labels: ['bug'] });

      await system.dispose();
    });

    it('should hand a webhook action its credentials from its secret, and none when the secret is gone', async () => {
      addRoutine('Hook', { type: 'event', event: 'LabelAdd', actions: [{ type: 'webhook', url: 'https://example.test', secretId: 'missing' }] });

      const system = new AutomationSystem({ workspaceRootPath: tempDir, workspaceId: 'test-workspace', db });

      const action = system.getConfig()?.automations.LabelAdd?.[0]?.actions[0];
      expect(action).toEqual({ type: 'webhook', url: 'https://example.test' });

      await system.dispose();
    });
  });

  describe('reloadConfig', () => {
    it('should count the active event routines (there is nothing to reload: they are read at every event)', async () => {
      const system = new AutomationSystem({ workspaceRootPath: tempDir, workspaceId: 'test-workspace', db });

      expect(system.reloadConfig()).toEqual({ success: true, automationCount: 0, errors: [] });
      addRoutine('Triage', event('test', 'echo hello'));
      expect(system.reloadConfig()).toEqual({ success: true, automationCount: 1, errors: [] });
      expect(system.getConfig()?.automations.LabelAdd).toHaveLength(1);

      await system.dispose();
    });
  });

  describe('getMatchersForEvent', () => {
    it('should return matchers for configured events, and follow a pause at once', async () => {
      addRoutine('One', event('test1', 'echo 1'));
      const second = addRoutine('Two', event('test2', 'echo 2'));

      const system = new AutomationSystem({ workspaceRootPath: tempDir, workspaceId: 'test-workspace', db });

      expect(system.getMatchersForEvent('LabelAdd').map((m) => m.matcher)).toEqual(['test1', 'test2']);
      updateRoutine('test-workspace', second.id, { paused: true }, db);
      expect(system.getMatchersForEvent('LabelAdd').map((m) => m.matcher)).toEqual(['test1']);

      await system.dispose();
    });

    it('should return empty array for unconfigured events', async () => {
      const system = new AutomationSystem({ workspaceRootPath: tempDir, workspaceId: 'test-workspace', db });

      expect(system.getMatchersForEvent('LabelAdd')).toEqual([]);

      await system.dispose();
    });
  });

  describe('updateSessionMetadata', () => {
    it('should emit PermissionModeChange event', async () => {
      const system = new AutomationSystem({
        workspaceRootPath: tempDir,
        workspaceId: 'test-workspace',
        db,
      });

      const emitSpy = spyOn(system.eventBus, 'emit');

      const events = await system.updateSessionMetadata('session-1', {
        permissionMode: 'execute',
      });

      expect(events).toContain('PermissionModeChange');
      expect(emitSpy).toHaveBeenCalledWith('PermissionModeChange', expect.objectContaining({
        sessionId: 'session-1',
        oldMode: '',
        newMode: 'execute',
      }));

      await system.dispose();
    });

    it('should emit LabelAdd event for new labels', async () => {
      const system = new AutomationSystem({
        workspaceRootPath: tempDir,
        workspaceId: 'test-workspace',
        db,
      });

      const emitSpy = spyOn(system.eventBus, 'emit');

      const events = await system.updateSessionMetadata('session-1', {
        labels: ['label-1', 'label-2'],
      });

      expect(events).toContain('LabelAdd');
      expect(emitSpy).toHaveBeenCalledWith('LabelAdd', expect.objectContaining({
        label: 'label-1',
      }));
      expect(emitSpy).toHaveBeenCalledWith('LabelAdd', expect.objectContaining({
        label: 'label-2',
      }));

      await system.dispose();
    });

    it('should emit LabelRemove event for removed labels', async () => {
      const system = new AutomationSystem({
        workspaceRootPath: tempDir,
        workspaceId: 'test-workspace',
        db,
      });

      // Set initial state
      system.setInitialSessionMetadata('session-1', {
        labels: ['label-1', 'label-2'],
      });

      const emitSpy = spyOn(system.eventBus, 'emit');

      const events = await system.updateSessionMetadata('session-1', {
        labels: ['label-1'], // label-2 removed
      });

      expect(events).toContain('LabelRemove');
      expect(emitSpy).toHaveBeenCalledWith('LabelRemove', expect.objectContaining({
        label: 'label-2',
      }));

      await system.dispose();
    });

    it('should emit FlagChange event', async () => {
      const system = new AutomationSystem({
        workspaceRootPath: tempDir,
        workspaceId: 'test-workspace',
        db,
      });

      const emitSpy = spyOn(system.eventBus, 'emit');

      const events = await system.updateSessionMetadata('session-1', {
        isFlagged: true,
      });

      expect(events).toContain('FlagChange');
      expect(emitSpy).toHaveBeenCalledWith('FlagChange', expect.objectContaining({
        isFlagged: true,
      }));

      await system.dispose();
    });

    it('should emit SessionStatusChange event', async () => {
      const system = new AutomationSystem({
        workspaceRootPath: tempDir,
        workspaceId: 'test-workspace',
        db,
      });

      system.setInitialSessionMetadata('session-1', {
        sessionStatus: 'todo',
      });

      const emitSpy = spyOn(system.eventBus, 'emit');

      const events = await system.updateSessionMetadata('session-1', {
        sessionStatus: 'done',
      });

      expect(events).toContain('SessionStatusChange');
      expect(emitSpy).toHaveBeenCalledWith('SessionStatusChange', expect.objectContaining({
        oldState: 'todo',
        newState: 'done',
      }));

      await system.dispose();
    });

    it('should not emit events when metadata unchanged', async () => {
      const system = new AutomationSystem({
        workspaceRootPath: tempDir,
        workspaceId: 'test-workspace',
        db,
      });

      system.setInitialSessionMetadata('session-1', {
        permissionMode: 'explore',
        labels: ['label-1'],
        isFlagged: false,
      });

      const emitSpy = spyOn(system.eventBus, 'emit');

      const events = await system.updateSessionMetadata('session-1', {
        permissionMode: 'explore',
        labels: ['label-1'],
        isFlagged: false,
      });

      expect(events).toEqual([]);
      expect(emitSpy).not.toHaveBeenCalled();

      await system.dispose();
    });

    it('should update stored metadata', async () => {
      const system = new AutomationSystem({
        workspaceRootPath: tempDir,
        workspaceId: 'test-workspace',
        db,
      });

      await system.updateSessionMetadata('session-1', {
        permissionMode: 'execute',
        labels: ['label-1'],
      });

      const stored = system.getSessionMetadata('session-1');
      expect(stored?.permissionMode).toBe('execute');
      expect(stored?.labels).toEqual(['label-1']);

      await system.dispose();
    });
  });

  describe('removeSessionMetadata', () => {
    it('should remove stored metadata', async () => {
      const system = new AutomationSystem({
        workspaceRootPath: tempDir,
        workspaceId: 'test-workspace',
        db,
      });

      system.setInitialSessionMetadata('session-1', {
        permissionMode: 'explore',
      });

      expect(system.getSessionMetadata('session-1')).toBeDefined();

      system.removeSessionMetadata('session-1');

      expect(system.getSessionMetadata('session-1')).toBeUndefined();

      await system.dispose();
    });
  });

  describe('emitLabelConfigChange', () => {
    it('should emit LabelConfigChange event', async () => {
      const system = new AutomationSystem({
        workspaceRootPath: tempDir,
        workspaceId: 'test-workspace',
        db,
      });

      const emitSpy = spyOn(system.eventBus, 'emit');

      await system.emitLabelConfigChange();

      expect(emitSpy).toHaveBeenCalledWith('LabelConfigChange', expect.objectContaining({
        workspaceId: 'test-workspace',
      }));

      await system.dispose();
    });
  });

  describe('executeAgentEvent', () => {
    it('should match agent events when matcher and conditions pass', async () => {
      addRoutine('Bash', {
        type: 'event',
        event: 'PreToolUse',
        matcher: '^Bash$',
        conditions: [{ condition: 'state', field: 'hook_event_name', value: 'PreToolUse' }],
        actions: [{ type: 'prompt', prompt: 'check this' }],
      });

      const system = new AutomationSystem({
        workspaceRootPath: tempDir,
        workspaceId: 'test-workspace',
        db,
      });

      const matched = await system.executeAgentEvent('PreToolUse', {
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'echo hi' },
      });

      expect(matched).toBe(1);
      await system.dispose();
    });

    it('should not match agent events when conditions fail', async () => {
      addRoutine('Bash', {
        type: 'event',
        event: 'PreToolUse',
        matcher: '^Bash$',
        conditions: [{ condition: 'state', field: 'hook_event_name', value: 'PostToolUse' }],
        actions: [{ type: 'prompt', prompt: 'check this' }],
      });

      const system = new AutomationSystem({
        workspaceRootPath: tempDir,
        workspaceId: 'test-workspace',
        db,
      });

      const matched = await system.executeAgentEvent('PreToolUse', {
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'echo hi' },
      });

      expect(matched).toBe(0);
      await system.dispose();
    });
  });

  describe('buildSdkHooks', () => {
    it('should return empty object (command execution removed)', async () => {
      addRoutine('Bash', { type: 'event', event: 'PreToolUse', matcher: 'Bash', actions: [{ type: 'prompt', prompt: 'check this' }] });

      const system = new AutomationSystem({
        workspaceRootPath: tempDir,
        workspaceId: 'test-workspace',
        db,
      });

      const result = system.buildSdkHooks();
      expect(result).toEqual({});

      await system.dispose();
    });
  });

  describe('dispose', () => {
    it('should clean up all resources', async () => {
      const system = new AutomationSystem({
        workspaceRootPath: tempDir,
        workspaceId: 'test-workspace',
        db,
      });

      system.setInitialSessionMetadata('session-1', { permissionMode: 'explore' });

      await system.dispose();

      expect(system.isDisposed()).toBe(true);
      expect(system.eventBus.isDisposed()).toBe(true);
      expect(system.getSessionMetadata('session-1')).toBeUndefined();
    });

    it('should be idempotent', async () => {
      const system = new AutomationSystem({
        workspaceRootPath: tempDir,
        workspaceId: 'test-workspace',
        db,
      });

      await system.dispose();
      await system.dispose(); // Should not throw
      expect(system.isDisposed()).toBe(true);
    });
  });
});
