/**
 * The `uiLanguage` user setting that backs main-process i18n hydration and the title language.
 * See packages/shared/CLAUDE.md -> "Cross-process language persistence".
 * Runs on the process-wide test database (a temp CONFIG_DIR), each test with a user of its own.
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { initDb } from '../../db/index.ts';
import { pushSchema } from '../../db/push.ts';
import { createId } from '../../id.ts';
import { INSTALL, updateSetting, userEntity } from '../../settings/index.ts';
import { users } from '../../users/schema.ts';
import { eq } from 'drizzle-orm';
import { getPersistedUiLanguage, loadPreferences, resolveTitleLanguageName, savePreferences, setPersistedUiLanguage, updatePreferences } from '../preferences.ts';

const db = initDb();
beforeAll(() => pushSchema(db));

function newUser(): string {
  const id = createId();
  const now = new Date();
  db.insert(users).values({ id, name: 'Alice', email: `${id}@x.test`, createdAt: now, updatedAt: now }).run();
  return id;
}

describe('uiLanguage', () => {
  it('is undefined while none is stored', () => {
    expect(getPersistedUiLanguage(newUser())).toBeUndefined();
  });

  it('returns a supported code and refuses an unsupported one', () => {
    const id = newUser();
    updateSetting(userEntity(id), 'uiLanguage', 'es', db);
    expect(getPersistedUiLanguage(id)).toBe('es');
    updateSetting(userEntity(id), 'uiLanguage', 'xx', db);
    expect(getPersistedUiLanguage(id)).toBeUndefined();
  });

  it('is kept per user and read back; setting the same value again changes nothing', () => {
    const [a, b] = [newUser(), newUser()];
    setPersistedUiLanguage('hu', a);
    expect(getPersistedUiLanguage(a)).toBe('hu');
    expect(getPersistedUiLanguage(b)).toBeUndefined();
    setPersistedUiLanguage('hu', a);
    expect(getPersistedUiLanguage(a)).toBe('hu');
  });

  it('does not touch the other preferences', () => {
    const id = newUser();
    updatePreferences({ timezone: 'Europe/Budapest', notes: 'likes tea' }, id);
    setPersistedUiLanguage('de', id);
    expect(loadPreferences(id)).toMatchObject({ name: 'Alice', timezone: 'Europe/Budapest', notes: 'likes tea', uiLanguage: 'de' });
  });

  it('merges location and diffViewer instead of replacing them', () => {
    const id = newUser();
    updatePreferences({ location: { city: 'Utrecht' }, diffViewer: { diffStyle: 'split' } }, id);
    updatePreferences({ location: { country: 'NL' }, diffViewer: { disableBackground: true } }, id);
    expect(loadPreferences(id)).toMatchObject({ location: { city: 'Utrecht', country: 'NL' }, diffViewer: { diffStyle: 'split', disableBackground: true } });
  });
});

describe('resolveTitleLanguageName', () => {
  it('is undefined with no UI language (so titles auto-detect)', () => {
    expect(resolveTitleLanguageName(newUser())).toBeUndefined();
  });

  it('maps a persisted code to its native name, English included', () => {
    const id = newUser();
    setPersistedUiLanguage('zh-Hans', id);
    expect(resolveTitleLanguageName(id)).toBe('简体中文');
    setPersistedUiLanguage('en', id);
    expect(resolveTitleLanguageName(id)).toBe('English');
  });

  it('is undefined for an unsupported stored code', () => {
    const id = newUser();
    updateSetting(userEntity(id), 'uiLanguage', 'xx', db);
    expect(resolveTitleLanguageName(id)).toBeUndefined();
  });
});

it('the install settings are not a user setting', () => {
  expect(() => updateSetting(INSTALL, 'uiLanguage' as never, 'es', db)).toThrow();
});

describe('the profile', () => {
  it('keeps name and email on the user, a left-out setting goes back to its default, and the local placeholder is not shown', () => {
    const id = newUser();
    savePreferences({ name: 'Bob', email: `bob-${id}@x.test`, timezone: 'UTC', notes: 'n' }, id);
    expect(loadPreferences(id)).toMatchObject({ name: 'Bob', email: `bob-${id}@x.test`, timezone: 'UTC', notes: 'n' });
    savePreferences({ name: 'Bob', timezone: 'UTC' }, id);
    expect(loadPreferences(id)).not.toHaveProperty('notes');
    const other = newUser();
    expect(() => savePreferences({ email: `bob-${id}@x.test` }, other)).toThrow('Another user has that email');
    db.update(users).set({ email: 'local@localhost' }).where(eq(users.id, other)).run();
    expect(loadPreferences(other)).not.toHaveProperty('email');
  });
});
