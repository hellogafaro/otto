/**
 * Integration test for the main-process i18n bootstrap.
 *
 * Validates the building blocks of the regression fix:
 * - `getPersistedUiLanguage()` reads back the language the user's preferences were written with (`preferences:write`,
 *   what main's `i18n:changeLanguage` sends to the server; main reads it back with `preferences:read` at startup).
 * - Calling `i18n.changeLanguage(persisted)` after `setupI18n()` makes
 *   `i18n.resolvedLanguage` match the persisted value.
 *
 * Together these mean: if the user's `uiLanguage` setting is `'hu'`, main-process `i18n.resolvedLanguage`
 * will be `'hu'` after the server answers at startup (`startServer` in `apps/electron/src/main/index.ts`) — which is the actual
 * thing that broke title generation across restarts.
 *
 * Runs on the process-wide test database (a temp CONFIG_DIR), with a user of its own.
 */
import { beforeAll, describe, expect, it } from 'bun:test'
import { setupI18n, i18n } from '@otto/shared/i18n'
import { getPersistedUiLanguage, loadPreferences, savePreferences } from '@otto/shared/config'
import { initDb } from '@otto/shared/db'
import { createId } from '@otto/shared/id'
import { updateSetting, userEntity } from '@otto/shared/settings'
import { pushSchema } from '../../../../../packages/shared/src/db/push.ts'
import { users } from '../../../../../packages/shared/src/users/schema.ts'

const db = initDb()
beforeAll(() => pushSchema(db))

function newUser(): string {
  const id = createId()
  const now = new Date()
  db.insert(users).values({ id, name: 'Alice', email: `${id}@x.test`, createdAt: now, updatedAt: now }).run()
  return id
}

describe('main-process i18n bootstrap', () => {
  it('hydrates main i18n from the persisted uiLanguage', async () => {
    setupI18n()
    const id = newUser()
    savePreferences({ ...loadPreferences(id), uiLanguage: 'hu' }, id)
    const persisted = getPersistedUiLanguage(id)
    await i18n.changeLanguage(persisted)
    expect({ persisted, resolved: i18n.resolvedLanguage }).toEqual({ persisted: 'hu', resolved: 'hu' })
  })

  it('returns undefined when no language is persisted (no hydration step)', () => {
    expect(getPersistedUiLanguage(newUser())).toBeUndefined()
  })

  it('ignores invalid persisted codes (defensive read)', () => {
    const id = newUser()
    updateSetting(userEntity(id), 'uiLanguage', 'xx', db)
    expect(getPersistedUiLanguage(id)).toBeUndefined()
  })
})
