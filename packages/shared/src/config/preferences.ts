import { initDb } from '../db/index.ts';
import { CATALOGUE, deleteSetting, getSettings, getUserSetting, updateSetting, userEntity } from '../settings/index.ts';
import { getFirstUser, getUser, LOCAL_EMAIL, updateUser } from '../users/queries.ts';
import { domainError } from '../utils/errors.ts';
import { i18n, SUPPORTED_LANGUAGE_CODES } from '../i18n/index.ts';
import { LOCALE_REGISTRY, type LanguageCode } from '../i18n/registry.ts';
import { sanitizePromptBody, sanitizePromptLine } from '../prompts/prompt-sanitize.ts';

export interface UserLocation {
  city?: string;
  region?: string;
  country?: string;
}

/** Diff viewer display preferences */
export interface DiffViewerPreferences {
  /** Diff layout: 'unified' (stacked) or 'split' (side-by-side) */
  diffStyle?: 'unified' | 'split';
  /** Whether to disable background highlighting on changed lines */
  disableBackground?: boolean;
}

/**
 * What a person told the app about themselves. `name` and `email` are the person's `users` row; the rest are
 * their `user:<id>` settings (`timezone`, `location`, `notes`, `diffViewer`, `includeCoAuthoredBy`, `uiLanguage`).
 * Every function takes the user's id; without one it is the first user (the local user on a desktop).
 */
export interface UserPreferences {
  name?: string;
  /** Shown in the workspace menu's account block; never sent anywhere. */
  email?: string;
  timezone?: string;
  location?: UserLocation;
  // Free-form notes the agent learns about the user
  notes?: string;
  diffViewer?: DiffViewerPreferences;
  // Whether to include Co-Authored-By trailer on git commits (default: true)
  includeCoAuthoredBy?: boolean;
  /**
   * Internal: persisted UI language code (mirrors Appearance → Language).
   * Maintained only by the desktop's `i18n:changeLanguage` IPC handler (through `preferences:write`).
   * Not user-editable; not exposed via the `update_user_preferences` tool.
   */
  uiLanguage?: LanguageCode;
}

const PREFERENCE_SETTINGS = ['timezone', 'location', 'notes', 'diffViewer', 'includeCoAuthoredBy', 'uiLanguage'] as const;

/** What the user has set: only what differs from the default. */
export function loadPreferences(userId?: string | null): UserPreferences {
  const id = userId ?? getFirstUser()?.id;
  if (!id) return {};
  const prefs: Record<string, unknown> = {};
  const user = getUser(id);
  if (user && user.email !== LOCAL_EMAIL) Object.assign(prefs, { name: user.name, email: user.email });
  const stored = getSettings(userEntity(id));
  for (const key of PREFERENCE_SETTINGS) {
    if (JSON.stringify(stored[key]) !== JSON.stringify(CATALOGUE[key].fallback)) prefs[key] = stored[key];
  }
  return prefs;
}

/** Makes these the user's preferences: a setting left out goes back to its default; an empty name or email is left as it is. */
export function savePreferences(prefs: UserPreferences, userId?: string | null): void {
  const id = userId ?? getFirstUser()?.id;
  if (!id) throw domainError('not_found', 'There is no user yet');
  initDb().transaction((tx) => {
    const name = prefs.name?.trim();
    const email = prefs.email?.trim();
    if (name || email) updateUser(id, { name, email }, tx);
    for (const key of PREFERENCE_SETTINGS) {
      if (prefs[key] === undefined) deleteSetting(userEntity(id), key, tx);
      else updateSetting(userEntity(id), key, prefs[key], tx);
    }
  });
}

export function updatePreferences(updates: Partial<UserPreferences>, userId?: string | null): UserPreferences {
  const current = loadPreferences(userId);
  const updated = {
    ...current,
    ...updates,
    // Merge location if provided
    location: updates.location
      ? { ...current.location, ...updates.location }
      : current.location,
    // Merge diffViewer if provided
    diffViewer: updates.diffViewer
      ? { ...current.diffViewer, ...updates.diffViewer }
      : current.diffViewer,
  };
  savePreferences(updated, userId);
  return updated;
}

/**
 * Read the persisted UI language code (validated against the supported set).
 * Returns `undefined` when none is stored or it holds an unrecognised value, and when the
 * settings cannot be read at all (a client-only desktop has no local database).
 */
export function getPersistedUiLanguage(userId?: string | null): LanguageCode | undefined {
  try {
    const candidate = getUserSetting(userId, 'uiLanguage');
    return candidate && (SUPPORTED_LANGUAGE_CODES as readonly string[]).includes(candidate) ? (candidate as LanguageCode) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Native-language name to request for AI-generated session titles, or
 * `undefined` to let the model follow the conversation's own language.
 *
 * Resolves from the explicitly persisted UI language (disk-backed) rather than
 * `i18n.resolvedLanguage`, which in the main process hydrates asynchronously at
 * startup and can still read the `'en'` fallback when an early title fires
 * (#885). Returning `undefined` when no language was chosen lets the title
 * prompt auto-detect the conversation language instead of being forced to
 * English.
 */
export function resolveTitleLanguageName(userId?: string | null): string | undefined {
  const code = getPersistedUiLanguage(userId);
  return code ? LOCALE_REGISTRY[code]?.nativeName : undefined;
}

/**
 * Format preferences for inclusion in system prompt
 */
export function formatPreferencesForPrompt(userId?: string | null): string {
  let prefs: UserPreferences;
  try {
    prefs = loadPreferences(userId);
  } catch {
    return ''; // a prompt is built without preferences rather than not at all
  }

  // Derive language from the app's i18n setting (Appearance > Language).
  const langCode = (i18n.resolvedLanguage ?? 'en') as LanguageCode;
  const langEntry = LOCALE_REGISTRY[langCode];
  const langName = langEntry?.nativeName ?? 'English';

  if (Object.keys(prefs).length === 0 ||
      (!prefs.name && !prefs.timezone && !prefs.location && !prefs.notes && langCode === 'en')) {
    return '';
  }

  const tags = ['user_preferences'] as const;
  const lines: string[] = [
    '<user_preferences>',
    'The user/app supplied these preferences. Follow them unless they conflict with higher-priority system, developer, tool, safety, or permission instructions.',
    '',
  ];

  if (prefs.name) {
    lines.push(`- Name: ${sanitizePromptLine(prefs.name, tags)}`);
  }

  if (prefs.timezone) {
    lines.push(`- Timezone: ${sanitizePromptLine(prefs.timezone, tags)}`);
  }

  if (prefs.location) {
    const loc = prefs.location;
    const parts = [loc.city, loc.region, loc.country].filter(Boolean).map((part) => sanitizePromptLine(part!, tags));
    if (parts.length > 0) {
      lines.push(`- Location: ${parts.join(', ')}`);
    }
  }

  // UI language is app state, not necessarily an explicitly saved user note.
  lines.push(`- Preferred response language (from app UI): ${sanitizePromptLine(langName, tags)}`);

  if (prefs.notes) {
    lines.push('', '### Notes about this user', sanitizePromptBody(prefs.notes, tags));
  }

  lines.push('</user_preferences>', '');
  return lines.join('\n');
}

/**
 * Whether the Co-Authored-By trailer should be included on git commits.
 * Defaults to true when the preference is not explicitly set.
 */
export function getCoAuthorPreference(userId?: string | null): boolean {
  try {
    return getUserSetting(userId, 'includeCoAuthoredBy');
  } catch {
    return true;
  }
}
