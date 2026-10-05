import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { createMemoryHistory } from '@tanstack/react-router'
import { createAppRouter } from '../router'

// The router runs in "server mode" without a DOM, where it redirects differently: force the client path,
// which needs a `window`. Removed afterwards: other test files in the process must not see one.
const g = globalThis as { window?: unknown }
const hadWindow = 'window' in g
beforeAll(() => {
  g.window ??= globalThis
})
afterAll(() => {
  if (!hadWindow) delete g.window
})

async function open(href: string) {
  const router = createAppRouter(() => null, createMemoryHistory({ initialEntries: [href] }))
  router.update({ ...router.options, isServer: false })
  await router.load()
  return router
}

type TestRouter = Awaited<ReturnType<typeof open>>
const where = (router: TestRouter) => router.history.location.href
const leaf = (router: TestRouter) => router.state.matches.at(-1)!
const params = (router: TestRouter) => leaf(router).params as Record<string, string>
const go = (router: TestRouter, to: string, search: Record<string, unknown> = {}, replace = false) => router.navigate({ to, search, replace })
const notFound = (router: TestRouter) => Boolean((router.state.matches[0]?.error as { isNotFound?: boolean } | undefined)?.isNotFound)

describe('route tree', () => {
  it('matches every section of a workspace', async () => {
    const leaves: Record<string, string> = {
      '/test/chats': '/$workspaceSlug/chats',
      '/test/chats/abc': '/$workspaceSlug/chats/$sessionId',
      '/test/settings': '/$workspaceSlug/settings',
      '/test/settings/appearance': '/$workspaceSlug/settings/$page',
      '/test/tasks': '/$workspaceSlug/tasks',
      '/test/projects': '/$workspaceSlug/projects',
      '/test/projects/p1': '/$workspaceSlug/projects/$projectId',
      '/test/routines': '/$workspaceSlug/routines',
      '/test/routines/a1': '/$workspaceSlug/routines/$automationId',
      '/test/library': '/$workspaceSlug/library',
      '/test/library/doc': '/$workspaceSlug/library/$pageId',
      '/test/skills': '/$workspaceSlug/skills',
      '/test/skills/s': '/$workspaceSlug/skills/$skillSlug',
      '/test/sources': '/$workspaceSlug/sources',
      '/test/sources/gmail': '/$workspaceSlug/sources/$sourceSlug',
    }
    for (const [href, routeId] of Object.entries(leaves)) {
      const router = await open(href)
      expect(where(router), href).toBe(href)
      expect(leaf(router).routeId as string, href).toBe(routeId)
      expect(notFound(router), href).toBe(false)
    }
  })

  it('redirects a bare workspace to its Chats', async () => {
    expect(where(await open('/test'))).toBe('/test/chats')
    expect(where(await open('/test/'))).toBe('/test/chats')
  })

  it('reads path params, decoded', async () => {
    expect(params(await open('/test/chats/abc'))).toEqual({ workspaceSlug: 'test', sessionId: 'abc' })
    expect(params(await open('/test/chats/a%25b')).sessionId).toBe('a%b')
  })

  it('validates search into the typed filters (combined, lists, known types)', async () => {
    const strict = (router: TestRouter) => (leaf(router) as unknown as { _strictSearch: unknown })._strictSearch
    expect(strict(await open('/test/chats?status=todo&status=done&label=a&flagged=1&archived=1&junk=1')))
      .toEqual({ status: ['todo', 'done'], label: ['a'], flagged: true, archived: true })
    expect(strict(await open('/test/chats?status=todo'))).toEqual({ status: ['todo'] })
    expect(strict(await open('/test/chats/abc?flagged=1'))).toEqual({ flagged: true })
    expect(strict(await open('/test/sources?type=nope'))).toEqual({})
    expect(strict(await open('/test/sources/gmail?type=mcp'))).toEqual({ type: 'mcp' })
    expect(strict(await open('/test/routines?type=agentic'))).toEqual({ type: 'agentic' })
  })

  it('a reserved first segment is not a workspace', async () => {
    for (const slug of ['login', 'api', 'ws', 'assets', 'health', 'login-assets']) {
      expect(notFound(await open(`/${slug}/chats`)), slug).toBe(true)
    }
    expect(notFound(await open('/login-co/chats'))).toBe(false)
  })

  it('translates a legacy ?ws=&route= URL before the first match', async () => {
    expect(where(await open('/?ws=test&route=allSessions%2Fsession%2Fabc'))).toBe('/test/chats/abc')
    expect(where(await open('/?ws=test&route=settings/appearance&workspaceId=ws_1'))).toBe('/test/settings/appearance')
    expect(where(await open('/?workspaceId=ws_1'))).toBe('/')
  })

  it('leaves the root URL, and an unknown section, for the navigation provider', async () => {
    expect(where(await open('/'))).toBe('/')
    const router = await open('/test/nope')
    expect(where(router)).toBe('/test/nope')
    expect(leaf(router).routeId as string).toBe('/$workspaceSlug')
  })
})

describe('navigation', () => {
  it('pushes numbered entries and goes back', async () => {
    const router = await open('/test/chats')
    await go(router, '/test/chats/abc', {})
    await go(router, '/test/settings/ai', {})
    expect(where(router)).toBe('/test/settings/ai')
    expect(router.history.location.state.__TSR_index).toBe(2)
    router.history.back()
    await router.load()
    expect(where(router)).toBe('/test/chats/abc')
    expect(router.history.location.state.__TSR_index).toBe(1)
  })

  it('replaces without adding an entry', async () => {
    const router = await open('/test/chats')
    await go(router, '/test/settings', {}, true)
    expect(where(router)).toBe('/test/settings')
    expect(router.history.location.state.__TSR_index).toBe(0)
  })

  it('takes an already-encoded path as it is, search included', async () => {
    const router = await open('/test/chats')
    await go(router, '/test/chats/a%25b', {})
    expect(where(router)).toBe('/test/chats/a%25b')
    await go(router, '/test/chats/a%20b', { label: ['x y'] })
    expect(where(router)).toBe('/test/chats/a%20b?label=x+y')
    await go(router, '/test/chats', { status: ['todo', 'done'], flagged: true })
    expect(where(router)).toBe('/test/chats?status=todo&status=done&flagged=1')
    await go(router, '/test/chats', { label: ['123'] })
    expect(where(router)).toBe('/test/chats?label=123')
  })
})
