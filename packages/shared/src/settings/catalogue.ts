import { z } from 'zod'
import { PermissionsConfigSchema } from '../agent/mode-types.ts'
import { THINKING_LEVEL_IDS, normalizeThinkingLevel } from '../agent/thinking-levels.ts'
import type { DecisionLayerStoredSettings } from '../decisions/settings.ts'
import { DEFAULT_SERVER_CONFIG } from '../config/server-config.ts'

/**
 * Every setting there is: the one typed list the `settings` table is checked against.
 * A key belongs to one kind of owner (`install`, `workspace` or `user`), has a default
 * (what a read gives while no row exists) and a validator (what a write must satisfy).
 * `sensitive` keys are not readable by every signed-in user (see bootstrap/authorize.ts).
 */
export type SettingKind = 'install' | 'workspace' | 'user'

function key<K extends SettingKind, T>(kind: K, schema: z.ZodType<T>, fallback: T, sensitive = false) {
  return { kind, schema, fallback, sensitive }
}

const text = z.string()
const textOrNull = z.string().nullable()
const flag = z.boolean()
const object = <T extends object>() => z.custom<T>((value) => typeof value === 'object' && value !== null && !Array.isArray(value))

export const CATALOGUE = {
  // install: one value for the whole server or desktop
  defaultConnectionSlug: key('install', textOrNull, null),
  defaultThinkingLevel: key('install', z.preprocess(normalizeThinkingLevel, z.enum(THINKING_LEVEL_IDS)), 'medium' as const),
  setupDeferred: key('install', flag, false),
  /** The auth token is a secret: `tokenSecretId` points at it (`getServerConfig` / `setServerConfig` in config/storage.ts read and write it). */
  server: key(
    'install',
    z.object({ enabled: flag, port: z.number().int(), tlsCertPath: text.optional(), tlsKeyPath: text.optional(), tokenSecretId: text.optional() }),
    { enabled: DEFAULT_SERVER_CONFIG.enabled, port: DEFAULT_SERVER_CONFIG.port } as { enabled: boolean; port: number; tlsCertPath?: string; tlsKeyPath?: string; tokenSecretId?: string },
    true,
  ),
  decisionLayer: key('install', object<DecisionLayerStoredSettings>(), {}),
  allowRemoteEvaluate: key('install', flag, true),
  gitBashPath: key('install', textOrNull, null),
  keepAwakeWhileRunning: key('install', flag, false),
  dismissedUpdateVersion: key('install', textOrNull, null),
  /** When each domain's importer ran: `{ settings: <ms> }`. */
  imports: key('install', z.record(z.string(), z.number()), {}),

  // workspace
  defaults: key('workspace', z.record(z.string(), z.unknown()), {}),
  localMcpServers: key('workspace', z.object({ enabled: flag }), { enabled: true }),
  /** The workspace's Explore-mode rules (the old `permissions.json`); a source's own rules stay in its bundle. */
  permissions: key('workspace', PermissionsConfigSchema, {}),

  // user: how one person has the app
  activeWorkspaceId: key('user', textOrNull, null),
  activeChatId: key('user', textOrNull, null),
  /** The slug of the connection this person's chats use when they name none (their own, else the one visible to them). */
  userDefaultConnectionSlug: key('user', textOrNull, null),
  colorTheme: key('user', text, 'default'),
  notificationsEnabled: key('user', flag, true),
  sendMessageKey: key('user', z.enum(['enter', 'cmd-enter']), 'enter' as const),
  spellCheck: key('user', flag, false),
  autoCapitalisation: key('user', flag, true),
  richToolDescriptions: key('user', flag, true),
  uiLanguage: key('user', textOrNull, null),
  timezone: key('user', text, ''),
  location: key('user', z.object({ city: text.optional(), region: text.optional(), country: text.optional() }), {}),
  notes: key('user', text, ''),
  diffViewer: key('user', z.object({ diffStyle: z.enum(['unified', 'split']).optional(), disableBackground: flag.optional() }), {}),
  includeCoAuthoredBy: key('user', flag, true),
}

/** The keys of one kind of owner, all of them by default. */
export type SettingKey<Kind extends SettingKind = SettingKind> = { [K in keyof typeof CATALOGUE]: (typeof CATALOGUE)[K]['kind'] extends Kind ? K : never }[keyof typeof CATALOGUE]
export type SettingValue<K extends keyof typeof CATALOGUE> = z.output<(typeof CATALOGUE)[K]['schema']>
