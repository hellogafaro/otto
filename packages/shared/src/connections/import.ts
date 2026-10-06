import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CONFIG_DIR } from '../config/paths.ts'
import { getCredentialManager, type CredentialManager } from '../credentials/index.ts'
import { initDb, type Db } from '../db/index.ts'
import { initSecretsStore } from '../secrets/index.ts'
import { getSetting, INSTALL, updateSetting } from '../settings/index.ts'
import { CONNECTION_TYPES, createConnectionsStore, INSTALL_SCOPE, type ConnectionInput, type Credential } from './index.ts'

/**
 * The importer: the `llmConnections` of `config.json` and their credentials in `credentials.enc`
 * (`llm_api_key::{slug}`, `llm_oauth::`, `llm_iam::`, `llm_service_account::`, and the global `anthropic_api_key` and
 * `claude_oauth` of before connections) become `connections` rows (scope `install`) with one secret each, once, at boot.
 * A row that exists for a slug (the old bridge made some) is updated, not duplicated; a connection that cannot be
 * read (an unknown provider type) is skipped and counted. The credentials are read first and each connection is
 * one transaction, so a run that stops half-way is finished by the next one, and `imports.connections` is recorded
 * last: after it nothing is read from the old files again. They are never changed.
 */

type Raw = Record<string, unknown>
const isObject = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown) => (typeof value === 'string' && value ? value : undefined)
const date = (value: unknown) => (typeof value === 'number' ? new Date(value) : undefined)

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
  const get = async (type: 'llm_api_key' | 'llm_oauth' | 'llm_iam' | 'llm_service_account' | 'claude_oauth' | 'anthropic_api_key') =>
    (await manager.get(type.startsWith('llm_') ? { type, connectionSlug: slug } : { type }).catch(() => null)) ?? undefined
  switch (authType) {
    case 'oauth': {
      const stored = (await get('llm_oauth')) ?? (slug === 'claude-max' ? await get('claude_oauth') : undefined)
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
  if (!text(slug) || !text(name) || !text(authType) || !CONNECTION_TYPES.includes(providerType as never)) return undefined
  return {
    slug: slug as string,
    type: providerType as ConnectionInput['type'],
    authType: authType as ConnectionInput['authType'],
    title: name as string,
    baseUrl: text(raw.baseUrl),
    defaultModel: text(raw.defaultModel),
    models: Array.isArray(raw.models) ? (raw.models as ConnectionInput['models']) : undefined,
    config: {
      modelSelectionMode: raw.modelSelectionMode as never,
      piAuthProvider: text(raw.piAuthProvider),
      customEndpoint: isObject(raw.customEndpoint) ? (raw.customEndpoint as never) : undefined,
      midStreamBehavior: raw.midStreamBehavior as never,
    },
    account: {
      oauthAccountUuid: text(raw.oauthAccountUuid),
      oauthAccountEmail: text(raw.oauthAccountEmail),
      oauthOrganizationUuid: text(raw.oauthOrganizationUuid),
      oauthOrganizationName: text(raw.oauthOrganizationName),
      verifiedAt: typeof raw.oauthProfileVerifiedAt === 'number' ? raw.oauthProfileVerifiedAt : undefined,
    },
    lastUsedAt: date(raw.lastUsedAt),
    createdAt: date(raw.createdAt),
  }
}

export async function initConnectionsImport(
  options: { configDir?: string; db?: Db; store?: ReturnType<typeof createConnectionsStore>; manager?: CredentialManager } = {},
): Promise<{ imported: number; skipped: number }> {
  const db = options.db ?? initDb()
  if (getSetting(INSTALL, 'imports', db).connections) return { imported: 0, skipped: 0 }
  const store = options.store ?? createConnectionsStore(db, initSecretsStore())
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
      if (!credential && input.authType !== 'none' && input.authType !== 'environment') console.warn(`[connections] no credential found for ${input.slug}`)
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
