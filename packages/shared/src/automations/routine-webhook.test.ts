import { expect, test } from 'bun:test'
import { openDb } from '../db/index.ts'
import { pushSchema } from '../db/push.ts'
import { createSecretsStore, parseEncryptionKey } from '../secrets/index.ts'
import { dropWebhookSecret, webhookSecretMatches, newWebhookSecret, prepareWebhookConfig, resetWebhookSecret } from './routine-webhook.ts'
import type { RoutineConfig } from './routine-types.ts'

async function setup() {
  const db = openDb(':memory:')
  await pushSchema(db)
  return createSecretsStore(db, parseEncryptionKey('0'.repeat(64)))
}
const actions = [{ type: 'prompt' as const, prompt: 'x' }]

test('secrets are unguessable and compared exactly', () => {
  const secret = newWebhookSecret()
  expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/)
  expect(newWebhookSecret()).not.toBe(secret)
  expect(webhookSecretMatches(secret, secret)).toBe(true)
  expect(webhookSecretMatches(`${secret}x`, secret)).toBe(false)
  expect(webhookSecretMatches('', secret)).toBe(false)
  expect(webhookSecretMatches(secret, undefined)).toBe(false)
})

test('a webhook config gets its secret from the server, whatever the caller sent', async () => {
  const store = await setup()
  const made = prepareWebhookConfig({ type: 'webhook', webhook: { secretId: 'someone-elses' }, actions }, 'Deploys', undefined, store)
  expect(made.config.webhook?.secretId).toBe(made.secretId!)
  expect(made.config.webhook?.secretId).not.toBe('someone-elses')
  expect(store.getSecret(made.secretId!)).toBe(made.secret!)
})

test('a routine that stays a webhook keeps its secret, one that stops being one gives it up', async () => {
  const store = await setup()
  const { config } = prepareWebhookConfig({ type: 'webhook', actions }, 'Deploys', undefined, store)
  const kept = prepareWebhookConfig({ type: 'webhook', webhook: { secretId: 'forged' }, actions }, 'Deploys', config, store)
  expect(kept.config.webhook).toEqual(config.webhook)
  expect(kept.secret).toBeUndefined()

  const schedule: RoutineConfig = { type: 'schedule', schedule: { cron: '0 9 * * *' }, actions }
  const left = prepareWebhookConfig(schedule, 'Deploys', config, store)
  expect(left.config.webhook).toBeUndefined()
  expect(left.drop).toBe(config.webhook!.secretId)
  dropWebhookSecret(left.drop, store)
  expect(store.getSecret(config.webhook!.secretId)).toBeUndefined()
})

test('rotating replaces the value under the same secret id, and only a webhook routine rotates', async () => {
  const store = await setup()
  const { config, secret } = prepareWebhookConfig({ type: 'webhook', actions }, 'Deploys', undefined, store)
  const rotated = resetWebhookSecret({ config }, store)
  expect(rotated).not.toBe(secret)
  expect(store.getSecret(config.webhook!.secretId)).toBe(rotated)
  expect(() => resetWebhookSecret({ config: { type: 'schedule', schedule: { cron: '0 9 * * *' }, actions } }, store)).toThrow()
})
