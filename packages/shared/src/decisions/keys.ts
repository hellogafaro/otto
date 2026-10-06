import { initDb, type Db } from '../db/index.ts';
import { initSecretsStore } from '../secrets/index.ts';
import { getSetting, INSTALL, updateSetting } from '../settings/index.ts';

/**
 * The API key of each decision provider is a secret (`@otto/shared/secrets`); the install setting `decisionLayer`
 * keeps only which secret belongs to which provider (`keySecretIds`). Plain functions over the process-wide stores,
 * which the credential manager's `getDecisionApiKey` family calls.
 */

const idOf = (provider: string, db: Db) => getSetting(INSTALL, 'decisionLayer', db).keySecretIds?.[provider];

/** The key stored for a provider, or null. */
export function getDecisionKey(provider: string, db: Db = initDb()): string | null {
  const id = idOf(provider, db);
  return (id && initSecretsStore().getSecret(id)) || null;
}

/** Stores the key (replacing one in place) and remembers its secret for the provider. */
export function setDecisionKey(provider: string, apiKey: string, db: Db = initDb()): void {
  const secrets = initSecretsStore();
  const existing = idOf(provider, db);
  if (existing && secrets.getSecret(existing) !== undefined) return secrets.updateSecret(existing, apiKey);
  const id = secrets.createSecret(`Decision model key (${provider})`, apiKey);
  const current = getSetting(INSTALL, 'decisionLayer', db);
  updateSetting(INSTALL, 'decisionLayer', { ...current, keySecretIds: { ...current.keySecretIds, [provider]: id } }, db);
}

/** Removes the key. Returns true if there was one. */
export function deleteDecisionKey(provider: string, db: Db = initDb()): boolean {
  const id = idOf(provider, db);
  if (!id) return false;
  initSecretsStore().deleteSecret(id);
  const { [provider]: _gone, ...rest } = getSetting(INSTALL, 'decisionLayer', db).keySecretIds ?? {};
  const current = getSetting(INSTALL, 'decisionLayer', db);
  updateSetting(INSTALL, 'decisionLayer', { ...current, keySecretIds: rest }, db);
  return true;
}
