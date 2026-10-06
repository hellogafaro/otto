// Bun test preload (bunfig.toml): every test runs against a throwaway config dir, never `~/.otto`.
// CONFIG_DIR and the SQLite path are fixed when their modules load, so this has to run first.
// A test that needs its own dir sets OTTO_CONFIG_DIR itself before importing.
import { afterAll } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'otto-test-'))
process.env.OTTO_CONFIG_DIR = dir
// The key of the `secrets` table (connections keep their credentials there). A throwaway value: nothing real is encrypted under it.
process.env.ENCRYPTION_KEY ??= '0'.repeat(64)
// The database of that dir has every domain's tables (settings are read wherever a prompt or a config is built).
// A subprocess, so no module of ours is loaded here before a test sets its own OTTO_CONFIG_DIR.
const push = Bun.spawnSync([process.execPath, 'run', join(import.meta.dir, 'db-push.ts')], { env: { ...process.env, OTTO_CONFIG_DIR: dir }, stderr: 'pipe' })
if (push.exitCode !== 0) throw new Error(`db:push failed for the test database: ${push.stderr.toString()}`)
afterAll(() => rmSync(dir, { recursive: true, force: true }))
