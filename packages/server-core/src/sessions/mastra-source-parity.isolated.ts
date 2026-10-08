import { afterAll, expect, it } from 'bun:test'
import { join } from 'node:path'
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { addWorkspace, saveConfig } from '@otto/shared/config'
import { CONFIG_DIR } from '@otto/shared/config/paths'
import { createAgent, updateAgent } from '@otto/shared/agents'
import { createSource, saveSourceConfig, setSourceCredential, syncLocalSource } from '@otto/shared/sources'
import { ensureDefaultPermissions } from '@otto/shared/agent'
import { getLibraryItem, getLibraryItems, readLibraryContent } from '@otto/shared/library'
import { openMastraSourceTools, testMastraSource } from './mastra-source-tools'

const requests: { path: string; auth: string | null }[] = []
let redirected = 0
const foreign = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => { redirected++; return Response.json({ foreign: true }) } })
const pdf = Buffer.from('%PDF-1.4\ncontrolled-binary\0fixture')
const endpoint = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: async (request) => {
  const path = new URL(request.url).pathname
  requests.push({ path, auth: request.headers.get('authorization') })
  if (path.endsWith('/redirect')) return Response.redirect(foreign.url.href)
  if (path.endsWith('/slow')) { await Bun.sleep(150); return new Response(pdf, { headers: { 'content-type': 'application/pdf' } }) }
  if (path.endsWith('/huge')) return new Response(new Uint8Array(5 * 1024 * 1024 + 1), { headers: { 'content-type': 'application/octet-stream' } })
  if (path.endsWith('/stream-huge')) return new Response(new ReadableStream({ start(controller) { for (let i = 0; i < 81; i++) controller.enqueue(new Uint8Array(65536)); controller.close() } }), { headers: { 'content-type': 'application/octet-stream' } })
  if (path.endsWith('/echo')) return new Response('controlled-source-secret', { headers: { 'content-type': 'application/octet-stream' } })
  if (path.endsWith('/text')) return new Response('A'.repeat(65537), { headers: { 'content-type': 'text/plain' } })
  if (path.endsWith('/error')) return new Response('controlled-source-secret', { status: 403 })
  if (path.endsWith('/mcp')) {
    if (request.method === 'GET') return new Response(null, { status: 405 })
    const body = await request.json() as { id?: number; method?: string }
    if (body.id === undefined) return new Response(null, { status: 202 })
    return Response.json({ jsonrpc: '2.0', id: body.id, result: body.method === 'initialize'
      ? { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } }
      : { tools: [{ name: 'read_fixture', inputSchema: { type: 'object' } }] } })
  }
  return new Response(pdf, { headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="../../foreign-secret.pdf"' } })
} })
afterAll(() => { endpoint.stop(true); foreign.stop(true) })

it('saves bounded API binaries to the authorized Library and refuses late saves, foreign scope and unsafe source transports', async () => {
  saveConfig({ workspaces: [] })
  ensureDefaultPermissions()
  const workspace = addWorkspace({ name: 'Native source parity', rootPath: join(CONFIG_DIR, 'parity') })
  const other = addWorkspace({ name: 'Foreign', rootPath: join(CONFIG_DIR, 'foreign') })
  const source = await createSource(workspace.rootPath, { name: 'Download API', provider: 'custom', type: 'api', api: { baseUrl: endpoint.url.href, authType: 'bearer', testEndpoint: { method: 'GET', path: '/download' } } })
  source.isAuthenticated = true
  saveSourceConfig(workspace.rootPath, source)
  await syncLocalSource(workspace.id, source.slug)
  await setSourceCredential(workspace.id, source.slug, 'source_bearer', { value: 'controlled-source-secret' })
  const agent = createAgent({ workspaceId: workspace.id, title: 'Scout', provider: 'openai', sources: [source.id], createdBy: 'user:fixture' })
  let access = true
  let refuseSaved = false
  let savedCount = 0
  const abort = new AbortController()
  const input = { workspaceId: workspace.id, agentId: agent.id, slugs: [source.slug], sessionPath: '', signal: abort.signal, mode: 'safe' as const, assertAccess: () => { if (!access || (refuseSaved && getLibraryItems(workspace.id).length > savedCount)) throw new Error('Access removed') } }
  const opened = await openMastraSourceTools(input)
  const name = `mcp__${source.slug}__api_${source.slug}`
  const call = (path: string) => opened.tools[name]!.execute!({ path, method: 'GET' }, {} as never)
  const result = await call('/download') as { status: number; libraryItem: { id: string; title: string; mime: string; size: number } }
  expect(result).toMatchObject({ status: 200, libraryItem: { title: 'API download.pdf', mime: 'application/pdf', size: pdf.length } })
  expect(JSON.stringify(result)).not.toContain(workspace.rootPath)
  expect(JSON.stringify(result)).not.toContain('foreign-secret')
  expect(getLibraryItem(workspace.id, result.libraryItem.id)?.createdBy).toBe(`agent:${agent.id}`)
  expect(getLibraryItem(other.id, result.libraryItem.id)).toBeUndefined()
  expect(Buffer.from(await readLibraryContent(workspace.id, result.libraryItem.id))).toEqual(pdf)
  const count = getLibraryItems(workspace.id).length
  savedCount = count
  refuseSaved = true
  expect(await call('/download')).toHaveProperty('error')
  expect(getLibraryItems(workspace.id).length).toBe(count)
  refuseSaved = false
  for (const path of ['/huge', '/stream-huge', '/echo', '/text', '/redirect', '/error', '/../foreign', '//foreign']) expect(await call(path)).toHaveProperty('error')
  expect(getLibraryItems(workspace.id).length).toBe(count)
  expect(redirected).toBe(0)
  await setSourceCredential(workspace.id, source.slug, 'source_bearer', { value: 'controlled-rotated-secret' })
  expect(await testMastraSource({ ...input, sourceSlug: source.slug })).toEqual({ success: true, status: 200 })
  expect(requests.at(-1)?.auth).toBe('Bearer controlled-rotated-secret')
  expect(getLibraryItems(workspace.id).length).toBe(count)
  source.api!.testEndpoint = { method: 'POST', path: '/download' }
  saveSourceConfig(workspace.rootPath, source)
  const beforeTest = requests.length
  expect(await testMastraSource({ ...input, sourceSlug: source.slug })).toHaveProperty('success', false)
  expect(requests.length).toBe(beforeTest)
  source.api!.testEndpoint = { method: 'GET', path: '/download' }
  saveSourceConfig(workspace.rootPath, source)
  for (const path of ['/error', '/redirect', '/stream-huge']) {
    source.api!.testEndpoint = { method: 'GET', path }
    saveSourceConfig(workspace.rootPath, source)
    const tested = await testMastraSource({ ...input, sourceSlug: source.slug })
    expect(tested).toHaveProperty('success', false)
    expect(JSON.stringify(tested)).not.toContain('controlled-source-secret')
  }
  source.api!.testEndpoint = { method: 'GET', path: '/download' }
  saveSourceConfig(workspace.rootPath, source)
  source.api!.baseUrl = foreign.url.href
  saveSourceConfig(workspace.rootPath, source)
  await expect(call('/download')).rejects.toThrow('configuration changed')
  source.api!.baseUrl = endpoint.url.href
  saveSourceConfig(workspace.rootPath, source)
  const late = call('/slow')
  await Bun.sleep(30)
  access = false
  expect(await late).toHaveProperty('error')
  expect(getLibraryItems(workspace.id).length).toBe(count)
  access = true
  updateAgent(workspace.id, agent.id, { sources: ['unauthorized'] })
  await expect(call('/download')).rejects.toThrow('Source access')
  await expect(openMastraSourceTools(input)).rejects.toThrow('not allowed')
  updateAgent(workspace.id, agent.id, { sources: [source.id] })
  await expect(openMastraSourceTools({ ...input, workspaceId: other.id })).rejects.toThrow()
  await opened.close()
  source.isAuthenticated = false
  saveSourceConfig(workspace.rootPath, source)
  const missing = await openMastraSourceTools(input)
  expect(missing.tools).toEqual({})
  expect(missing.missingAuthSlugs).toEqual([source.slug])
  expect(missing.slugs).toEqual([source.slug])
  await missing.close()
  source.isAuthenticated = true
  saveSourceConfig(workspace.rootPath, source)
  const cancellable = await openMastraSourceTools(input)
  const pending = cancellable.tools[name]!.execute!({ path: '/slow', method: 'GET' }, {} as never)
  await Bun.sleep(30)
  abort.abort()
  await expect(pending).rejects.toThrow()
  expect(getLibraryItems(workspace.id).length).toBe(count)
  await cancellable.close()
  const root = join(workspace.rootPath, 'configured-root')
  mkdirSync(root)
  writeFileSync(join(other.rootPath, 'foreign.txt'), 'FOREIGN_DATA')
  symlinkSync(join(other.rootPath, 'foreign.txt'), join(root, 'escape'))
  const local = await createSource(workspace.rootPath, { name: 'Local', provider: 'custom', type: 'local', local: { path: root } })
  updateAgent(workspace.id, agent.id, { sources: [local.id] })
  await expect(openMastraSourceTools({ ...input, signal: new AbortController().signal, slugs: [local.slug] })).rejects.toThrow('race-safe configured-root isolation')
  const stdio = await createSource(workspace.rootPath, { name: 'Stdio', provider: 'custom', type: 'mcp', mcp: { transport: 'stdio', command: '/bin/false', authType: 'none' } })
  updateAgent(workspace.id, agent.id, { sources: [stdio.id] })
  await expect(openMastraSourceTools({ ...input, signal: new AbortController().signal, slugs: [stdio.slug] })).rejects.toThrow('isolated subprocess boundary')
  const mcp = await createSource(workspace.rootPath, { name: 'Discovery MCP', provider: 'custom', type: 'mcp', mcp: { transport: 'http', url: new URL('/mcp', endpoint.url).href, authType: 'none' } })
  updateAgent(workspace.id, agent.id, { sources: [mcp.id] })
  expect(await testMastraSource({ ...input, signal: new AbortController().signal, sourceSlug: mcp.slug })).toEqual({ success: true, toolCount: 1 })
  mcp.mcp!.url = new URL('/redirect', endpoint.url).href
  saveSourceConfig(workspace.rootPath, mcp)
  expect(await testMastraSource({ ...input, signal: new AbortController().signal, sourceSlug: mcp.slug })).toHaveProperty('success', false)
  expect(redirected).toBe(0)
  mcp.mcp!.url = new URL('/stream-huge', endpoint.url).href
  saveSourceConfig(workspace.rootPath, mcp)
  expect(await testMastraSource({ ...input, signal: new AbortController().signal, sourceSlug: mcp.slug })).toHaveProperty('success', false)
  mcp.mcp!.url = new URL('/slow', endpoint.url).href
  saveSourceConfig(workspace.rootPath, mcp)
  const testAbort = new AbortController()
  const probing = testMastraSource({ ...input, signal: testAbort.signal, sourceSlug: mcp.slug })
  await Bun.sleep(30)
  testAbort.abort()
  await expect(probing).rejects.toThrow()
})
