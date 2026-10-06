import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { createMemoryHistory, notFound as notFoundError } from '@tanstack/react-router'
import { createAppRouter } from '../router'
import { belongsToWorkspace, isRouterNotFound } from '../not-found'

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
const notFound = (router: TestRouter) => isRouterNotFound(router.state.matches)

describe('route tree', () => {
  it('matches every section of a workspace', async () => {
    const leaves: Record<string, string> = {
      '/test/chats': '/$workspaceSlug/chats',
      '/test/chats/abc': '/$workspaceSlug/chats/$sessionId',
      '/test/settings': '/$workspaceSlug/settings',
      '/test/settings/appearance': '/$workspaceSlug/settings/$page',
      '/test/tasks': '/$workspaceSlug/tasks',
      '/test/tasks/t1': '/$workspaceSlug/tasks/$taskId',
      '/test/projects': '/$workspaceSlug/projects',
      '/test/projects/p1': '/$workspaceSlug/projects/$projectId',
      '/test/routines': '/$workspaceSlug/routines',
      '/test/routines/a1': '/$workspaceSlug/routines/$automationId',
      '/test/library': '/$workspaceSlug/library',
      '/test/library/doc': '/$workspaceSlug/library/$itemId',
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
    expect(strict(await open('/test/tasks?project=p1&status=done&status=nope&archived=1&junk=1')))
      .toEqual({ project: 'p1', status: ['done'], archived: true })
    expect(strict(await open('/test/tasks/t1?assignee=user:u1'))).toEqual({ assignee: 'user:u1' })
    expect(strict(await open('/test/projects/p1?tab=files&status=archived'))).toEqual({ tab: 'files', status: 'archived' })
    expect(strict(await open('/test/projects?tab=nope'))).toEqual({})
    expect(strict(await open('/test/library?tab=documents&folder=f1&createdBy=agent:default')))
      .toEqual({ tab: 'documents', folder: 'f1', createdBy: 'agent:default' })
    expect(strict(await open('/test/library/i1?folder=f1'))).toEqual({ folder: 'f1' })
  })

  it('a reserved first segment is not a workspace', async () => {
    for (const slug of ['login', 'api', 'ws', 'assets', 'health']) {
      expect(notFound(await open(`/${slug}/chats`)), slug).toBe(true)
    }
    expect(notFound(await open('/login-co/chats'))).toBe(false)
  })

  it('/login is the web sign-in page; Electron (this build) has none', async () => {
    expect(notFound(await open('/login'))).toBe(true)
  })

  it('translates a legacy ?ws=&route= URL before the first match', async () => {
    expect(where(await open('/?ws=test&route=allSessions%2Fsession%2Fabc'))).toBe('/test/chats/abc')
    expect(where(await open('/?ws=test&route=settings/appearance&workspaceId=ws_1'))).toBe('/test/settings/appearance')
    expect(where(await open('/?workspaceId=ws_1'))).toBe('/')
  })

  it('leaves the root URL for the navigation provider', async () => {
    const router = await open('/')
    expect(where(router)).toBe('/')
    expect(notFound(router)).toBe(false)
  })
})

describe('not found', () => {
  it('a URL that matches no route is not found, and stays where it is', async () => {
    for (const href of ['/test/nope', '/test/chats/a/b', '/test/tasks/a/b', '/a/b/c/d']) {
      const router = await open(href)
      expect(notFound(router), href).toBe(true)
      expect(where(router), href).toBe(href)
    }
  })

  it('an unknown settings page is not found, a known one is not', async () => {
    expect(notFound(await open('/test/settings/nope'))).toBe(true)
    expect(notFound(await open('/test/settings/appearance'))).toBe(false)
  })

  it('a workspace slug is only known to the app: the router still opens its Chats', async () => {
    expect(where(await open('/zzz'))).toBe('/zzz/chats')
    expect(notFound(await open('/zzz/chats'))).toBe(false)
  })

  it('every real view is found', async () => {
    for (const href of ['/test/chats', '/test/chats/abc', '/test/settings', '/test/tasks', '/test/tasks/t1', '/test/projects/p1', '/test/library/i1?folder=f1', '/test/skills/s', '/test/sources/gmail?type=mcp', '/test']) {
      expect(notFound(await open(href)), href).toBe(false)
    }
  })

  it('reads the flags of the matches', () => {
    expect(isRouterNotFound([])).toBe(false)
    expect(isRouterNotFound([{}, { _notFound: false }])).toBe(false)
    expect(isRouterNotFound([{}, { _notFound: true }])).toBe(true)
    expect(isRouterNotFound([{ error: notFoundError() }])).toBe(true)
    expect(isRouterNotFound([{ error: new Error('boom') }])).toBe(false)
  })

  it('a record belongs to the active workspace by its local or remote id, or to any while none is active', () => {
    expect(belongsToWorkspace('ws1', 'ws1')).toBe(true)
    expect(belongsToWorkspace('ws2', 'ws1')).toBe(false)
    expect(belongsToWorkspace(undefined, 'ws1')).toBe(false)
    expect(belongsToWorkspace('remote', 'ws1', 'remote')).toBe(true)
    expect(belongsToWorkspace('remote', 'ws1', null)).toBe(false)
    expect(belongsToWorkspace('ws2', null)).toBe(true)
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
