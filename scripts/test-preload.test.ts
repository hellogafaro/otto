import { expect, it } from 'bun:test'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { DB_PATH } from '../packages/shared/src/db/index.ts'
import { CONFIG_DIR } from '../packages/shared/src/config/paths.ts'

it('tests never run against the real ~/.otto', () => {
  expect(CONFIG_DIR).not.toBe(join(homedir(), '.otto'))
  expect(CONFIG_DIR.startsWith(tmpdir())).toBe(true)
  expect(DB_PATH.startsWith(CONFIG_DIR)).toBe(true)
})
