import { afterEach, describe, expect, it } from 'bun:test';
import { initDb } from '../../db/index.ts';
import { users } from '../../users/schema.ts';
import { createWorkspaceMember } from '../../workspaces/members.ts';
import { createConnection, deleteConnection, getConnectionById, updateConnection, userScope, workspaceScope } from '../../connections/index.ts';
import { getStoredSetting, updateSetting, userEntity } from '../../settings/index.ts';
import { getUserMidStreamPreference, initUserMidStreamPreference, loadPreferences, savePreferences, updatePreferences } from '../preferences.ts';
import { UserPreferencesUpdateSchema, validatePreferencesContent } from '../validators.ts';

const connectionIds: string[] = [];
afterEach(() => {
  for (const id of connectionIds.splice(0)) deleteConnection(id);
});

function newUser(): string {
  const id = crypto.randomUUID();
  const now = new Date();
  initDb().insert(users).values({ id, name: 'Fixture', email: `${id}@example.test`, createdAt: now, updatedAt: now }).run();
  return id;
}

function legacy(scope: string, behavior?: 'steer' | 'queue', slug = crypto.randomUUID()) {
  const row = createConnection({ scope, slug, type: 'anthropic', authType: 'api_key', title: 'Fixture', config: behavior ? { midStreamBehavior: behavior } : {} });
  connectionIds.push(row.id);
  return row;
}

describe('the general user midstream preference', () => {
  it('reads the default without writing, then initializes stored steer once', () => {
    const id = newUser();
    legacy(userScope(id));
    expect(getUserMidStreamPreference(id)).toEqual({ behavior: 'steer', needsReview: false });
    expect(getStoredSetting(userEntity(id), 'midStreamBehavior')).toBeUndefined();
    expect(initUserMidStreamPreference(id)).toEqual({ behavior: 'steer', needsReview: false });
    expect(getStoredSetting(userEntity(id), 'midStreamBehavior')).toBe('steer');
    legacy(userScope(id), 'queue');
    expect(initUserMidStreamPreference(id)).toEqual({ behavior: 'steer', needsReview: false });
  });

  it('initializes the unique explicit legacy value and physically preserves its config', () => {
    for (const behavior of ['steer', 'queue'] as const) {
      const id = newUser();
      const row = legacy(userScope(id), behavior);
      expect(getUserMidStreamPreference(id)).toEqual({ behavior, needsReview: false });
      expect(getStoredSetting(userEntity(id), 'midStreamBehavior')).toBeUndefined();
      expect(initUserMidStreamPreference(id)).toEqual({ behavior, needsReview: false });
      expect(getStoredSetting(userEntity(id), 'midStreamBehavior')).toBe(behavior);
      expect(getConnectionById(row.id)?.config).toEqual(row.config);
      updateConnection(row.id, { config: { midStreamBehavior: behavior === 'steer' ? 'queue' : 'steer' } });
      expect(getUserMidStreamPreference(id)).toEqual({ behavior, needsReview: false });
    }
  });

  it('checks all visible install and member-workspace scopes, including shadowed slugs', () => {
    const id = newUser();
    const workspace = crypto.randomUUID();
    const otherWorkspace = crypto.randomUUID();
    createWorkspaceMember(workspace, id, 'member');
    createWorkspaceMember(otherWorkspace, id, 'owner');
    const slug = crypto.randomUUID();
    legacy(userScope(id), 'steer', slug);
    legacy(workspaceScope(workspace), 'queue', slug);
    legacy(workspaceScope(otherWorkspace), 'queue');
    const install = legacy('install', 'queue', slug);
    expect(initUserMidStreamPreference(id)).toEqual({ behavior: 'queue', needsReview: true });
    expect(getStoredSetting(userEntity(id), 'midStreamBehavior')).toBeUndefined();
    expect(getConnectionById(install.id)?.config.midStreamBehavior).toBe('queue');
  });

  it('initializes install-only or any member-workspace-only legacy values', () => {
    const id = newUser();
    const install = legacy('install', 'queue');
    expect(initUserMidStreamPreference(id)).toEqual({ behavior: 'queue', needsReview: false });
    deleteConnection(install.id);
    const member = newUser();
    const workspace = crypto.randomUUID();
    createWorkspaceMember(workspace, member, 'member');
    legacy(workspaceScope(workspace), 'queue');
    expect(initUserMidStreamPreference(member)).toEqual({ behavior: 'queue', needsReview: false });
  });

  it('excludes other users and workspaces the user has not joined', () => {
    const id = newUser();
    legacy(userScope(newUser()), 'queue');
    legacy(workspaceScope(crypto.randomUUID()), 'queue');
    expect(initUserMidStreamPreference(id)).toEqual({ behavior: 'steer', needsReview: false });
    const second = newUser();
    legacy(userScope(second), 'queue');
    expect(initUserMidStreamPreference(second)).toEqual({ behavior: 'queue', needsReview: false });
    expect(getUserMidStreamPreference(id)).toEqual({ behavior: 'steer', needsReview: false });
  });

  it('uses conservative queue without persisting a decision for conflicting explicit values', () => {
    const id = newUser();
    const first = legacy(userScope(id), 'steer');
    const second = legacy(userScope(id), 'queue');
    expect(getUserMidStreamPreference(id)).toEqual({ behavior: 'queue', needsReview: true });
    expect(initUserMidStreamPreference(id)).toEqual({ behavior: 'queue', needsReview: true });
    expect(getStoredSetting(userEntity(id), 'midStreamBehavior')).toBeUndefined();
    updatePreferences({ notes: 'fixture note' }, id);
    expect(getUserMidStreamPreference(id)).toEqual({ behavior: 'queue', needsReview: true });
    updatePreferences({ midStreamBehavior: 'steer' }, id);
    expect(getUserMidStreamPreference(id)).toEqual({ behavior: 'steer', needsReview: false });
    updatePreferences({ timezone: 'UTC' }, id);
    expect(getStoredSetting(userEntity(id), 'midStreamBehavior')).toBe('steer');
    updatePreferences({ midStreamBehavior: 'queue' }, id);
    expect(getUserMidStreamPreference(id)).toEqual({ behavior: 'queue', needsReview: false });
    expect(getConnectionById(first.id)?.config.midStreamBehavior).toBe('steer');
    expect(getConnectionById(second.id)?.config.midStreamBehavior).toBe('queue');
  });

  it('lets a valid stored General value win over any legacy conflict', () => {
    for (const behavior of ['steer', 'queue'] as const) {
      const id = newUser();
      legacy(userScope(id), 'steer');
      legacy(userScope(id), 'queue');
      updateSetting(userEntity(id), 'midStreamBehavior', behavior);
      expect(initUserMidStreamPreference(id)).toEqual({ behavior, needsReview: false });
    }
  });

  it('does not use the first user when the explicit principal is missing or unknown', () => {
    updateSetting(userEntity(newUser()), 'midStreamBehavior', 'queue');
    for (const id of [undefined, null, '', crypto.randomUUID()]) {
      expect(() => getUserMidStreamPreference(id as string)).toThrow();
      expect(() => initUserMidStreamPreference(id as string)).toThrow();
    }
  });

  it('preserves every other preference and nested partial updates while full JSON writes still replace', () => {
    const id = newUser();
    savePreferences({ timezone: 'UTC', location: { city: 'Madrid', country: 'ES' }, notes: 'fixture note', diffViewer: { diffStyle: 'split', disableBackground: true }, includeCoAuthoredBy: false, uiLanguage: 'es' }, id);
    const before = loadPreferences(id);
    updatePreferences({ midStreamBehavior: 'queue' }, id);
    expect(loadPreferences(id)).toEqual({ ...before, midStreamBehavior: 'queue' });
    updatePreferences({ location: { region: 'Madrid' }, diffViewer: { diffStyle: 'unified' } }, id);
    expect(loadPreferences(id)).toMatchObject({ location: { city: 'Madrid', country: 'ES', region: 'Madrid' }, diffViewer: { diffStyle: 'unified', disableBackground: true }, midStreamBehavior: 'queue' });
    savePreferences({ timezone: 'UTC' }, id);
    expect(getStoredSetting(userEntity(id), 'midStreamBehavior')).toBeUndefined();
    expect(loadPreferences(id)).not.toHaveProperty('notes');
  });
});

describe('typed preference partial validation', () => {
  it('accepts either behavior or an unrelated partial without requiring omitted fields', () => {
    for (const value of [{}, { midStreamBehavior: 'steer' }, { midStreamBehavior: 'queue' }, { timezone: 'UTC' }, { diffViewer: { disableBackground: false }, includeCoAuthoredBy: true }]) {
      expect(UserPreferencesUpdateSchema.safeParse(value).success).toBe(true);
    }
  });

  it('rejects invalid enum values, readonly output, unknown keys, and invalid partial shapes', () => {
    for (const value of [null, [], 'queue', { midStreamBehavior: 'invalid' }, { midStreamBehavior: null }, { midStreamBehaviorNeedsReview: false }, { updatedAt: 1 }, { unknown: true }, { includeCoAuthoredBy: 'false' }, { diffViewer: { diffStyle: 'invalid' } }, { location: { city: 1 } }, { email: 'invalid' }]) {
      expect(UserPreferencesUpdateSchema.safeParse(value).success).toBe(false);
    }
    expect(validatePreferencesContent(JSON.stringify({ notes: 'fixture note', futureField: true }))).toEqual({ success: true });
  });
});
