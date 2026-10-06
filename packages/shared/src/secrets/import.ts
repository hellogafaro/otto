import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadStoredConfig, saveConfig } from '../config/storage.ts'
import { CONFIG_DIR } from '../config/paths.ts'
import { getCredentialManager, type CredentialManager } from '../credentials/index.ts'
import { initDb, type Db } from '../db/index.ts'
import { getDecisionKey, setDecisionKey } from '../decisions/keys.ts'
import { DECISION_PROVIDER_PRESETS } from '../decisions/providers.ts'
import { settings } from '../settings/schema.ts'
import { getSetting, INSTALL, updateSetting } from '../settings/index.ts'
import { and, eq } from 'drizzle-orm'
import { initSecretsStore } from './index.ts'

/**
 * The importer of the tokens that sat in plain text: the server's auth token (`serverConfig.token` of `config.json`,
 * or in the `server` setting of an earlier build), the tokens of remote workspaces in the `config.json` registry, and
 * the decision model's API keys (`decision_api_key::{provider}` in `credentials.enc`) become secrets, once, at boot.
 * The `server` setting then keeps `tokenSecretId`, the registry `tokenSecretId` per remote workspace, the `decisionLayer`
 * setting `keySecretIds`. The registry is live (it holds the workspaces until they move to the database), so it is
 * rewritten without the tokens; `config.json`'s `serverConfig` and `credentials.enc` are only read.
 * `imports.secrets` is recorded last.
 */

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

function readConfig(configDir: string): Record<string, unknown> {
  const path = join(configDir, 'config.json')
  if (!existsSync(path)) return {}
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8').replace(/^﻿/, ''))
    if (isObject(parsed)) return parsed
  } catch {
    // an unreadable file is skipped, never fatal
  }
  return {}
}

export async function initSecretsImport(options: { configDir?: string; db?: Db; manager?: CredentialManager } = {}): Promise<{ imported: number }> {
  const db = options.db ?? initDb()
  if (getSetting(INSTALL, 'imports', db).secrets) return { imported: 0 }
  const secrets = initSecretsStore()
  let imported = 0

  // the server token: a plain `token` in the setting's row (the zod reader drops it), else the one of config.json
  const row = db.select({ value: settings.value }).from(settings).where(and(eq(settings.entity, INSTALL), eq(settings.key, 'server'))).get()
  const inRow = row ? (JSON.parse(row.value) as { token?: unknown }).token : undefined
  const inFile = readConfig(options.configDir ?? CONFIG_DIR).serverConfig
  const token = [inRow, isObject(inFile) ? inFile.token : undefined].find((value): value is string => typeof value === 'string' && value !== '')
  const server = getSetting(INSTALL, 'server', db)
  if (row && token && !server.tokenSecretId) {
    updateSetting(INSTALL, 'server', { ...server, tokenSecretId: secrets.createSecret('Server token', token) }, db)
    imported++
  } else if (inRow !== undefined) {
    updateSetting(INSTALL, 'server', server, db) // rewrite the row without the plain token
  }

  // the tokens of remote workspaces: a save of the registry moves them (and strips them from the file)
  const config = loadStoredConfig()
  if (config?.workspaces.some((ws) => ws.remoteServer && !ws.remoteServer.tokenSecretId)) {
    imported += config.workspaces.filter((ws) => ws.remoteServer && !ws.remoteServer.tokenSecretId).length
    saveConfig(config)
  }

  // the decision model's keys
  const manager = options.manager ?? getCredentialManager()
  for (const provider of Object.keys(DECISION_PROVIDER_PRESETS)) {
    if (getDecisionKey(provider, db)) continue
    const stored = await manager.get({ type: 'decision_api_key', name: provider }).catch(() => null)
    if (stored?.value) {
      setDecisionKey(provider, stored.value, db)
      imported++
    }
  }

  updateSetting(INSTALL, 'imports', { ...getSetting(INSTALL, 'imports', db), secrets: Date.now() }, db)
  return { imported }
}
