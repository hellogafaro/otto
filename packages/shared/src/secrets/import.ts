import { loadStoredConfig, saveConfig } from '../config/storage.ts'
import { getCredentialManager, type CredentialManager } from '../credentials/index.ts'
import { initDb, type Db } from '../db/index.ts'
import { getDecisionKey, setDecisionKey } from '../decisions/keys.ts'
import { DECISION_PROVIDER_PRESETS } from '../decisions/providers.ts'
import { getSetting, INSTALL, updateSetting } from '../settings/index.ts'

/**
 * The importer of the tokens that sat in plain text: the tokens of remote workspaces in the `config.json` registry and
 * the decision model's API keys (`decision_api_key::{provider}` in `credentials.enc`) become secrets, once, at boot.
 * The registry then keeps `tokenSecretId` per remote workspace, the `decisionLayer` setting `keySecretIds`. The registry
 * is live (it holds the workspaces until they move to the database), so it is rewritten without the tokens;
 * `credentials.enc` is only read. `imports.secrets` is recorded last.
 */

export async function initSecretsImport(options: { db?: Db; manager?: CredentialManager } = {}): Promise<{ imported: number }> {
  const db = options.db ?? initDb()
  if (getSetting(INSTALL, 'imports', db).secrets) return { imported: 0 }
  let imported = 0

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
