import { randomBytes } from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The desktop's `ENCRYPTION_KEY` (the key of the `secrets` table, see
 * `@otto/shared/secrets`). The server reads it from the environment; a desktop
 * install has no one to set it, so the first launch makes 32 random bytes and
 * keeps them in `CONFIG_DIR/encryption-key` (mode 0600):
 *
 *   safe:<base64 of safeStorage.encryptString(key)>   protected by the OS keychain
 *   plain:<base64 key>                                 only when the OS offers no keychain
 *
 * An `ENCRYPTION_KEY` already in the environment (dev, a server) wins and no file is touched.
 * A file that cannot be read is an error, never a reason to make a new key: that
 * would orphan every stored secret.
 */

export interface EncryptionKeyDeps {
  safeStorage: {
    isEncryptionAvailable(): boolean
    encryptString(plain: string): Buffer
    decryptString(encrypted: Buffer): string
  }
  configDir: string
  env: Record<string, string | undefined>
  fs?: Pick<typeof import('node:fs'), 'chmodSync' | 'mkdirSync' | 'readFileSync' | 'writeFileSync'>
  warn?: (message: string) => void
}

export type EncryptionKeySource = 'env' | 'safe' | 'plain'

/** Set `env.ENCRYPTION_KEY` (base64) and say where it came from. Throws an actionable error when the stored key is unusable. */
export function initEncryptionKey({
  safeStorage,
  configDir,
  env,
  fs = { chmodSync, mkdirSync, readFileSync, writeFileSync },
  warn = () => {},
}: EncryptionKeyDeps): EncryptionKeySource {
  if (env.ENCRYPTION_KEY?.trim()) return 'env'

  const file = join(configDir, 'encryption-key')
  const unusable = (why: string) =>
    new Error(`The encryption key at ${file} cannot be used (${why}). Your stored secrets stay encrypted under it, so a new key is not made. Restore the file from a backup, or delete it to start with an empty secrets store.`)

  const read = (): { source: EncryptionKeySource; key: string } | undefined => {
    let text: string
    try {
      text = fs.readFileSync(file, 'utf8').trim()
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') return undefined
      throw unusable(String(error))
    }
    const [kind, body = ''] = [text.slice(0, text.indexOf(':')), text.slice(text.indexOf(':') + 1)]
    let key: string
    try {
      if (kind === 'safe') key = safeStorage.decryptString(Buffer.from(body, 'base64'))
      else if (kind === 'plain') key = body
      else throw new Error('unknown format')
    } catch (error) {
      throw unusable(error instanceof Error ? error.message : String(error))
    }
    if (Buffer.from(key, 'base64').length !== 32) throw unusable('it is not 32 bytes')
    return { source: kind, key }
  }

  let found = read()
  if (!found) {
    const key = randomBytes(32).toString('base64')
    const source: EncryptionKeySource = safeStorage.isEncryptionAvailable() ? 'safe' : 'plain'
    if (source === 'plain') warn('safeStorage is unavailable: the encryption key is stored unprotected in encryption-key (mode 0600)')
    const body = source === 'safe' ? safeStorage.encryptString(key).toString('base64') : key
    fs.mkdirSync(configDir, { recursive: true })
    try {
      // 'wx': a second launch that raced this one keeps the first key.
      fs.writeFileSync(file, `${source}:${body}\n`, { mode: 0o600, flag: 'wx' })
      fs.chmodSync(file, 0o600)
      found = { source, key }
    } catch (error) {
      if ((error as { code?: string }).code !== 'EEXIST') throw error
      found = read()
    }
  }
  if (!found) throw unusable('it could not be read')
  env.ENCRYPTION_KEY = found.key
  return found.source
}
