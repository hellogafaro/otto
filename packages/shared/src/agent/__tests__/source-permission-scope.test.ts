import { afterEach, expect, it } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { CONFIG_DIR } from '../../config/paths.ts'
import { addWorkspace } from '../../config/storage.ts'
import { permissionsConfigCache, updateWorkspacePermissions } from '../permissions-config.ts'

const dirs: string[] = []
afterEach(async () => {
  permissionsConfigCache.clear()
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function rules(slug: string, patterns: string[]) {
  expect(basename(CONFIG_DIR)).toStartWith('otto-test-')
  const root = await mkdtemp(join(CONFIG_DIR, 'source-permission-scope-'))
  dirs.push(root)
  await mkdir(join(root, 'sources', slug), { recursive: true })
  await writeFile(join(root, 'sources', slug, 'permissions.json'), JSON.stringify({ allowedMcpPatterns: patterns }))
  const merged = permissionsConfigCache.getMergedConfig({ workspaceRootPath: root, activeSourceSlugs: [slug] })
  return { root, matches: (name: string) => merged.readOnlyMcpPatterns.some((pattern) => pattern.test(name)) }
}

it('anchors source prefixes and groups alternation without promoting another source or an embedded qualified namespace', async () => {
  const scoped = await rules('allowed', ['get_item', 'read|search'])
  for (const name of ['mcp__allowed__get_item', 'mcp__allowed__read_document', 'mcp__allowed__search_documents']) expect(scoped.matches(name)).toBe(true)
  for (const name of ['mcp__other__get_item', 'mcp__other__search_documents', 'mcp__other__mcp__allowed__get_item', 'prefix_mcp__allowed__get_item']) expect(scoped.matches(name)).toBe(false)
  const unknown = permissionsConfigCache.getMergedConfig({ workspaceRootPath: scoped.root, activeSourceSlugs: ['unknown-source-alias'] })
  expect(unknown.readOnlyMcpPatterns.some((pattern) => pattern.test('mcp__allowed__get_item'))).toBe(false)
})

it('escapes source slug regex operators while retaining legitimate action-pattern behavior within that exact source', async () => {
  const scoped = await rules('allowed.+', ['(?:get|list)_item', 'read_[a-z]+'])
  expect(scoped.matches('mcp__allowed.+__get_item')).toBe(true)
  expect(scoped.matches('mcp__allowed.+__list_item')).toBe(true)
  expect(scoped.matches('mcp__allowed.+__read_document')).toBe(true)
  expect(scoped.matches('mcp__allowed-other__get_item')).toBe(false)
  expect(scoped.matches('mcp__other__mcp__allowed.+__get_item')).toBe(false)
})

it('does not alter separately authorized workspace rules while scoping source rules', async () => {
  const scoped = await rules('allowed', ['get_item'])
  const workspace = addWorkspace({ name: 'Compiler workspace fixture', rootPath: scoped.root })
  updateWorkspacePermissions(workspace.id, { allowedMcpPatterns: ['^mcp__other__workspace_allowed$'] })
  const merged = permissionsConfigCache.getMergedConfig({ workspaceRootPath: scoped.root, activeSourceSlugs: ['allowed'] })
  expect(merged.readOnlyMcpPatterns.some((pattern) => pattern.test('mcp__other__workspace_allowed'))).toBe(true)
  expect(merged.readOnlyMcpPatterns.some((pattern) => pattern.test('mcp__allowed__get_item'))).toBe(true)
  expect(merged.readOnlyMcpPatterns.some((pattern) => pattern.test('mcp__other__mcp__allowed__get_item'))).toBe(false)
})
