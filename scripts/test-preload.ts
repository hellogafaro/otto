// Bun test preload (bunfig.toml): every test runs against a throwaway config dir, never `~/.otto`.
// CONFIG_DIR and the SQLite path are fixed when their modules load, so this has to run first.
// A test that needs its own dir sets OTTO_CONFIG_DIR itself before importing.
import { afterAll } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'otto-test-'))
process.env.OTTO_CONFIG_DIR = dir
afterAll(() => rmSync(dir, { recursive: true, force: true }))
