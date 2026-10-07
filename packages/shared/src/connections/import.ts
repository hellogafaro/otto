import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CONFIG_DIR } from '../config/paths.ts'
import { getCredentialManager, type CredentialManager } from '../credentials/index.ts'
import { initDb, type Db } from '../db/index.ts'
import { initSecretsStore } from '../secrets/index.ts'
import { getSetting, INSTALL, updateSetting } from '../settings/index.ts'
import { and, asc, eq, sql } from 'drizzle-orm'
import { CLAUDE_CODE_CONNECTION_TYPE, CUSTOM_CONNECTION_TYPE, createConnectionsStore, getClaudeCodeScope, INSTALL_SCOPE, type ConnectionConfig, type ConnectionInput, type Credential } from './index.ts'
import { connections } from './schema.ts'

/**
 * The importer: the `llmConnections` of `config.json` and their credentials in `credentials.enc`
 * (`llm_api_key::{slug}`, `llm_oauth::`, `llm_iam::`, `llm_service_account::`, and the global `anthropic_api_key` of
 * before connections) become `connections` rows (scope `install`) with one secret each, once, at boot. Their `type` is
 * the Pi provider id (`toPiProvider`); a Claude subscription becomes `claude-code`, which keeps no secret, so the
 * Claude OAuth tokens Otto once held are not imported, and the row becomes the instance owner's own
 * (`initClaudeCodeOwnerImport`).
 * A row that exists for a slug (the old bridge made some) is updated, not duplicated; a connection that cannot be
 * read (an unknown provider type) is skipped and counted. The credentials are read first and each connection is
 * one transaction, so a run that stops half-way is finished by the next one, and `imports.connections` is recorded
 * last: after it nothing is read from the old files again. They are never changed.
 */

type Raw = Record<string, unknown>
const isObject = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown) => (typeof value === 'string' && value ? value : undefined)
const date = (value: unknown) => (typeof value === 'number' ? new Date(value) : undefined)
/** The provider types of `config.json`. */
const OLD_TYPES = ['anthropic', 'pi', 'pi_compat']

/**
 * The Pi provider id and auth type of a connection in the shape before Pi only (`anthropic` | `pi` | `pi_compat`,
 * with `piAuthProvider`): `pi` + X is X, `pi_compat` is `custom`, a Claude subscription (`anthropic` + `oauth`) is
 * `claude-code` signed in through the CLI. A Pi provider id passes as it is.
 */
function toPiProvider(type: string, authType: ConnectionInput['authType'], piAuthProvider?: string): { type: string; authType: ConnectionInput['authType'] } {
  if (type === 'pi_compat') return { type: CUSTOM_CONNECTION_TYPE, authType }
  if (type === 'pi') return { type: piAuthProvider || 'anthropic', authType }
  if (type === 'anthropic' && authType === 'oauth') return { type: CLAUDE_CODE_CONNECTION_TYPE, authType: 'cli_login' }
  return { type, authType }
}

function readConfig(configDir: string): Raw {
  const path = join(configDir, 'config.json')
  if (!existsSync(path)) return {}
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8').replace(/^﻿/, ''))
    if (isObject(parsed)) return parsed
  } catch {
    // an unreadable file is skipped, never fatal
  }
  console.warn('[connections] could not read config.json; skipped')
  return {}
}

/** The credential `credentials.enc` holds for a connection of this auth type, or undefined. */
async function readCredential(manager: CredentialManager, slug: string, authType: string): Promise<Credential | undefined> {
  const get = async (type: 'llm_api_key' | 'llm_oauth' | 'llm_iam' | 'llm_service_account' | 'anthropic_api_key') =>
    (await manager.get(type.startsWith('llm_') ? { type, connectionSlug: slug } : { type }).catch(() => null)) ?? undefined
  switch (authType) {
    case 'oauth': {
      const stored = await get('llm_oauth')
      return stored?.value ? { accessToken: stored.value, refreshToken: stored.refreshToken, expiresAt: stored.expiresAt, idToken: stored.idToken } : undefined
    }
    case 'api_key':
    case 'api_key_with_endpoint':
    case 'bearer_token': {
      const stored = (await get('llm_api_key')) ?? (slug === 'anthropic-api' ? await get('anthropic_api_key') : undefined)
      return stored?.value ? { apiKey: stored.value } : undefined
    }
    case 'iam_credentials': {
      const stored = await get('llm_iam')
      return stored?.value && stored.awsAccessKeyId
        ? { accessKeyId: stored.awsAccessKeyId, secretAccessKey: stored.value, region: stored.awsRegion, sessionToken: stored.awsSessionToken }
        : undefined
    }
    case 'service_account_file': {
      const stored = await get('llm_service_account')
      return stored?.value ? { serviceAccountJson: stored.value, projectId: stored.gcpProjectId, region: stored.gcpRegion, email: stored.serviceAccountEmail } : undefined
    }
    default:
      return undefined
  }
}

function toInput(raw: unknown): ConnectionInput | undefined {
  if (!isObject(raw)) return undefined
  const { slug, name, providerType, authType } = raw
  if (!text(slug) || !text(name) || !text(authType) || !OLD_TYPES.includes(providerType as string)) return undefined
  const provider = toPiProvider(providerType as string, authType as ConnectionInput['authType'], text(raw.piAuthProvider))
  return {
    slug: slug as string,
    type: provider.type,
    authType: provider.authType,
    title: name as string,
    baseUrl: text(raw.baseUrl),
    defaultModel: text(raw.defaultModel),
    models: Array.isArray(raw.models) ? (raw.models as ConnectionInput['models']) : undefined,
    config: {
      modelSelectionMode: raw.modelSelectionMode as never,
      customEndpoint: isObject(raw.customEndpoint) ? (raw.customEndpoint as never) : undefined,
      midStreamBehavior: raw.midStreamBehavior as never,
    },
    createdAt: date(raw.createdAt),
  }
}

export async function initConnectionsImport(
  options: { configDir?: string; db?: Db; store?: ReturnType<typeof createConnectionsStore>; manager?: CredentialManager } = {},
): Promise<{ imported: number; skipped: number }> {
  const db = options.db ?? initDb()
  const store = options.store ?? createConnectionsStore(db, initSecretsStore())
  const converted = initConnectionsPiProviderImport(db, store)
  if (converted) console.info(`[connections] ${converted} connections now name their Pi provider`)
  const result = getSetting(INSTALL, 'imports', db).connections ? { imported: 0, skipped: 0 } : await importOldConnections(db, store, options)
  const moved = initClaudeCodeOwnerImport(db)
  if (moved) console.info(`[connections] ${moved} Claude subscriptions are now the instance owner's own`)
  return result
}

async function importOldConnections(
  db: Db,
  store: ReturnType<typeof createConnectionsStore>,
  options: { configDir?: string; manager?: CredentialManager },
): Promise<{ imported: number; skipped: number }> {
  const manager = options.manager ?? getCredentialManager()
  const raws = readConfig(options.configDir ?? CONFIG_DIR).llmConnections
  let imported = 0
  let skipped = 0

  for (const raw of Array.isArray(raws) ? raws : []) {
    const input = toInput(raw)
    if (!input) {
      skipped++
      console.warn('[connections] skipped a connection that could not be read')
      continue
    }
    try {
      const credential = await readCredential(manager, input.slug, input.authType)
      if (!credential && input.authType !== 'none' && input.authType !== 'environment' && input.authType !== 'cli_login') console.warn(`[connections] no credential found for ${input.slug}`)
      const existing = store.getConnection(input.slug)
      if (existing?.scope === INSTALL_SCOPE) {
        const { slug: _slug, scope: _scope, createdAt: _createdAt, ...patch } = input
        store.updateConnection(existing.id, patch, credential)
      } else {
        store.createConnection(input, credential)
      }
      imported++
    } catch (error) {
      skipped++
      console.warn(`[connections] could not import ${input.slug}: ${error instanceof Error ? error.message : 'failed'}`)
    }
  }

  updateSetting(INSTALL, 'imports', { ...getSetting(INSTALL, 'imports', db), connections: Date.now() }, db)
  return { imported, skipped }
}

/**
 * A `claude-code` connection of the install's (an imported Claude subscription, or one made before it was the instance
 * owner's alone) becomes the instance owner's own (`getClaudeCodeScope`), unless the owner already has that slug; the
 * install's default moves off it. Runs at every boot (in `initConnectionsImport`); without a user yet it waits for the
 * next boot, and a row it leaves is refused at use. Returns how many rows moved.
 */
export function initClaudeCodeOwnerImport(db: Db): number {
  const scope = getClaudeCodeScope(db)
  if (!scope) return 0
  const taken = new Set(db.select({ slug: connections.slug }).from(connections).where(eq(connections.scope, scope)).all().map((row) => row.slug))
  const rows = db.select().from(connections).where(and(eq(connections.type, CLAUDE_CODE_CONNECTION_TYPE), eq(connections.scope, INSTALL_SCOPE))).all()
  let moved = 0
  for (const row of rows) {
    if (taken.has(row.slug)) continue
    db.update(connections).set({ scope }).where(eq(connections.id, row.id)).run()
    if (getSetting(INSTALL, 'defaultConnectionSlug', db) === row.slug) {
      const first = db.select({ slug: connections.slug }).from(connections).where(eq(connections.scope, INSTALL_SCOPE)).orderBy(asc(connections.createdAt), sql`rowid`).get()
      updateSetting(INSTALL, 'defaultConnectionSlug', first?.slug ?? null, db)
    }
    moved++
  }
  return moved
}

/**
 * Rows written before Pi only become the shape `toPiProvider` gives: `pi` + `piAuthProvider` X is X, `pi_compat` is
 * `custom`, and a Claude subscription (`anthropic` + `oauth`) is `claude-code` + `cli_login`, whose stored Claude OAuth
 * token secret is deleted (the user's own `claude` login replaces it). `config.piAuthProvider` and the Claude account
 * identity once kept in `config.account` go. Runs at every boot (in `initConnectionsImport`) and changes nothing once
 * every row has its Pi provider; each row is one transaction. Returns how many rows changed; never logs a value.
 */
export function initConnectionsPiProviderImport(db: Db, store: ReturnType<typeof createConnectionsStore>): number {
  let changed = 0
  for (const row of db.select().from(connections).all()) {
    let raw: Raw = {}
    try {
      const parsed: unknown = row.config ? JSON.parse(row.config) : {}
      if (isObject(parsed)) raw = parsed
    } catch {
      // an unreadable config is left as it is
    }
    const { piAuthProvider, account: _account, ...config } = raw
    const provider = toPiProvider(row.type, row.authType as ConnectionInput['authType'], text(piAuthProvider))
    if (provider.type === row.type && provider.authType === row.authType && !('piAuthProvider' in raw) && !('account' in raw)) continue
    const claudeCode = provider.type === CLAUDE_CODE_CONNECTION_TYPE && row.type !== CLAUDE_CODE_CONNECTION_TYPE
    store.updateConnection(row.id, { ...provider, config: config as ConnectionConfig }, claudeCode ? null : undefined)
    changed++
  }
  return changed
}
