import { describe, expect, it } from 'bun:test'
import { isReservedWorkspaceSlug } from '@otto/shared/utils/workspace-slug'
import { VALID_SETTINGS_SUBPAGES } from '../../../shared/settings-registry'
import {
  locationToRouteString,
  parseSearch,
  stringifySearch,
  routeStringToLocation,
  translateLegacyUrl,
  validateChatsSearch,
  validateRoutinesSearch,
  validateSourcesSearch,
  workspaceSlugFromPathname,
} from '../location'

/** Every view route kind route-parser knows, with the URL it gets in workspace `test`. */
const KINDS: Array<[routeString: string, pathname: string, search: Record<string, string | string[] | true>]> = [
  ['allSessions', '/test/chats', {}],
  ['allSessions/session/abc123', '/test/chats/abc123', {}],
  ['allSessions?flagged=1', '/test/chats', { flagged: true }],
  ['allSessions/session/abc123?flagged=1', '/test/chats/abc123', { flagged: true }],
  ['allSessions?archived=1', '/test/chats', { archived: true }],
  ['allSessions/session/abc123?archived=1', '/test/chats/abc123', { archived: true }],
  ['allSessions?status=todo', '/test/chats', { status: ['todo'] }],
  ['allSessions/session/abc123?status=in-progress', '/test/chats/abc123', { status: ['in-progress'] }],
  ['allSessions?label=bug', '/test/chats', { label: ['bug'] }],
  ['allSessions/session/abc123?label=a+b', '/test/chats/abc123', { label: ['a b'] }],
  ['allSessions?status=todo&status=done&label=research&label=design&flagged=1&archived=1', '/test/chats', { status: ['todo', 'done'], label: ['research', 'design'], flagged: true, archived: true }],
  ['allSessions/session/abc123?status=todo&status=done&label=a', '/test/chats/abc123', { status: ['todo', 'done'], label: ['a'] }],
  ['allSessions?label=a%26b%3Dc&label=%C3%A9+x', '/test/chats', { label: ['a&b=c', 'é x'] }],
  ['settings/app', '/test/settings/app', {}],
  ['settings/ai', '/test/settings/ai', {}],
  ['settings/appearance', '/test/settings/appearance', {}],
  ['settings/input', '/test/settings/input', {}],
  ['settings/workspace', '/test/settings/workspace', {}],
  ['settings/members', '/test/settings/members', {}],
  ['settings/permissions', '/test/settings/permissions', {}],
  ['settings/labels', '/test/settings/labels', {}],
  ['settings/shortcuts', '/test/settings/shortcuts', {}],
  ['settings/preferences', '/test/settings/preferences', {}],
  ['tasks', '/test/tasks', {}],
  ['tasks/task/t1', '/test/tasks/t1', {}],
  ['tasks?project=p1&assignee=user%3Au1&status=todo&status=done&archived=1', '/test/tasks', { project: 'p1', assignee: 'user:u1', status: ['todo', 'done'], archived: true }],
  ['tasks/task/t1?project=p1&status=doing', '/test/tasks/t1', { project: 'p1', status: ['doing'] }],
  ['projects', '/test/projects', {}],
  ['projects?status=archived', '/test/projects', { status: 'archived' }],
  ['projects/project/p1', '/test/projects/p1', {}],
  ['projects/project/p1?tab=tasks', '/test/projects/p1', { tab: 'tasks' }],
  ['projects/project/p1?tab=files&status=archived', '/test/projects/p1', { tab: 'files', status: 'archived' }],
  ['automations', '/test/routines', {}],
  ['automations/scheduled', '/test/routines', { type: 'scheduled' }],
  ['automations/event', '/test/routines', { type: 'event' }],
  ['automations/agentic', '/test/routines', { type: 'agentic' }],
  ['automations/automation/a1', '/test/routines/a1', {}],
  ['automations/event/automation/a1', '/test/routines/a1', { type: 'event' }],
  ['library', '/test/library', {}],
  ['library?tab=files&folder=f1&createdBy=agent%3Adefault', '/test/library', { tab: 'files', folder: 'f1', createdBy: 'agent:default' }],
  ['library?tab=documents', '/test/library', { tab: 'documents' }],
  ['library/item/doc-1', '/test/library/doc-1', {}],
  ['library/item/doc-1?folder=f1', '/test/library/doc-1', { folder: 'f1' }],
  ['home', '/test/home', {}],
  ['home/notifications', '/test/home/notifications', {}],
  ['home/notifications?unread=1', '/test/home/notifications', { unread: true }],
  ['skills', '/test/settings/skills', {}],
  ['skills/skill/my-skill', '/test/settings/skills/my-skill', {}],
  ['sources', '/test/settings/sources', {}],
  ['sources/api', '/test/settings/sources', { type: 'api' }],
  ['sources/mcp', '/test/settings/sources', { type: 'mcp' }],
  ['sources/local', '/test/settings/sources', { type: 'local' }],
  ['sources/source/github', '/test/settings/sources/github', {}],
  ['sources/api/source/gmail', '/test/settings/sources/gmail', { type: 'api' }],
  ['sources/mcp/source/linear', '/test/settings/sources/linear', { type: 'mcp' }],
  ['sources/local/source/notes', '/test/settings/sources/notes', { type: 'local' }],
]

describe('routeStringToLocation / locationToRouteString', () => {
  for (const [routeString, pathname, search] of KINDS) {
    it(`${routeString} <-> ${pathname}`, () => {
      expect(routeStringToLocation(routeString, 'test')).toEqual({ pathname, search })
      expect(locationToRouteString(pathname, search)).toEqual({ routeString, workspaceSlug: 'test' })
    })
  }

  it('round-trips every settings page of the registry', () => {
    for (const page of VALID_SETTINGS_SUBPAGES) {
      expect(routeStringToLocation(`settings/${page}`, 'test')).toEqual({ pathname: `/test/settings/${page}`, search: {} })
      expect(locationToRouteString(`/test/settings/${page}`, {})?.routeString).toBe(`settings/${page}`)
    }
  })

  it('has no Settings index: the bare route string and URL are General', () => {
    expect(routeStringToLocation('settings', 'test')).toEqual({ pathname: '/test/settings/app', search: {} })
    expect(locationToRouteString('/test/settings', {})?.routeString).toBe('settings/app')
  })

  it('uses the given workspace slug, percent-encoded', () => {
    expect(routeStringToLocation('settings/ai', 'my-team')?.pathname).toBe('/my-team/settings/ai')
    expect(routeStringToLocation('allSessions', 'a b')?.pathname).toBe('/a%20b/chats')
    expect(locationToRouteString('/a%20b/chats', {})).toEqual({ routeString: 'allSessions', workspaceSlug: 'a b' })
  })

  it('encodes and decodes ids with reserved characters', () => {
    const location = routeStringToLocation('allSessions/session/a%b', 'test')
    expect(location?.pathname).toBe('/test/chats/a%25b')
    expect(locationToRouteString(location!.pathname, {})?.routeString).toBe('allSessions/session/a%b')
  })

  it('has no URL for an action or an invalid route', () => {
    expect(routeStringToLocation('action/new-session', 'test')).toBeNull()
    expect(routeStringToLocation('settings/nope', 'test')).toBeNull()
    expect(routeStringToLocation('nope', 'test')).toBeNull()
  })

  it('has no route for an unknown or incomplete URL', () => {
    for (const pathname of ['/', '/test', '/test/', '/test/nope', '/test/settings/nope', '/test/chats/a/b', '/test/chats/a/b/c', '/test/tasks/t1/x', '/test/home/x', '/test/home/notifications/x']) {
      expect(locationToRouteString(pathname, {}), pathname).toBeNull()
    }
  })

  it('drops invalid Tasks, Projects and Library search', () => {
    expect(locationToRouteString('/test/tasks', { status: ['nope', 'done'], x: '1' })?.routeString).toBe('tasks?status=done')
    expect(locationToRouteString('/test/projects/p1', { tab: 'nope' })?.routeString).toBe('projects/project/p1')
    expect(locationToRouteString('/test/library', { tab: 'all', folder: '' })?.routeString).toBe('library?tab=all')
  })

  it('treats a trailing slash as the same URL', () => {
    expect(locationToRouteString('/test/chats/abc/', {})?.routeString).toBe('allSessions/session/abc')
  })

  it('reads a single value given as a string, a number or a list', () => {
    expect(locationToRouteString('/test/chats', { label: 123 })?.routeString).toBe('allSessions?label=123')
    expect(locationToRouteString('/test/chats', { status: 'todo' })?.routeString).toBe('allSessions?status=todo')
    expect(locationToRouteString('/test/chats', { status: ['a', 'b'], flagged: '1' })?.routeString).toBe('allSessions?status=a&status=b&flagged=1')
  })

  it('has no route under a reserved workspace slug', () => {
    for (const slug of ['assets', 'api', 'ws', 'login', 'health', 'index.html', 'favicon.ico', 'manifest.json']) {
      expect(locationToRouteString(`/${slug}/chats`, {}), slug).toBeNull()
      expect(workspaceSlugFromPathname(`/${slug}/chats`), slug).toBeNull()
    }
  })
})

describe('legacy single-value route strings', () => {
  const LEGACY: Array<[legacy: string, canonical: string]> = [
    ['flagged', 'allSessions?flagged=1'],
    ['flagged/session/abc', 'allSessions/session/abc?flagged=1'],
    ['archived', 'allSessions?archived=1'],
    ['state/todo', 'allSessions?status=todo'],
    ['state/todo/session/abc', 'allSessions/session/abc?status=todo'],
    ['label/bug', 'allSessions?label=bug'],
    ['label/a%20b/session/abc', 'allSessions/session/abc?label=a+b'],
    ['allSessions/state/todo', 'allSessions?status=todo'],
    ['allSessions/label/bug', 'allSessions?label=bug'],
    ['allSessions/flagged', 'allSessions?flagged=1'],
    ['allSessions/state/todo/label/bug/flagged/session/abc', 'allSessions/session/abc?status=todo&label=bug&flagged=1'],
    ['state/todo?status=done&label=x', 'allSessions?status=todo&status=done&label=x'],
    ['flagged?archived=1', 'allSessions?flagged=1&archived=1'],
  ]
  for (const [legacy, canonical] of LEGACY) {
    it(`${legacy} -> ${canonical}`, () => {
      const location = routeStringToLocation(legacy, 'test')!
      expect(location).not.toBeNull()
      expect(locationToRouteString(location.pathname, location.search)?.routeString).toBe(canonical)
      expect(routeStringToLocation(canonical, 'test')).toEqual(location)
    })
  }
})

describe('chats filter search', () => {
  it('combines filters, keeps lists, drops duplicates', () => {
    expect(validateChatsSearch({ status: ['todo', 'done', 'todo'], label: 'a', flagged: '1', archived: true }))
      .toEqual({ status: ['todo', 'done'], label: ['a'], flagged: true, archived: true })
  })

  it('accepts 1 and true as flags', () => {
    for (const flagged of [true, '1', 'true', 1]) expect(validateChatsSearch({ flagged }), String(flagged)).toEqual({ flagged: true })
  })

  it('drops empty, false and unknown params', () => {
    expect(validateChatsSearch({ status: ['', 3, 'x'], label: [], flagged: false, archived: '0', other: 1 })).toEqual({ status: ['3', 'x'] })
    expect(validateChatsSearch({})).toEqual({})
  })
})

describe('search strings', () => {
  it('repeats the key of a list and writes true as 1', () => {
    expect(stringifySearch({ status: ['todo', 'done'], label: ['a b'], flagged: true, type: 'mcp' })).toBe('?status=todo&status=done&label=a+b&flagged=1&type=mcp')
    expect(stringifySearch({})).toBe('')
    expect(stringifySearch({ status: [], flagged: false, x: undefined })).toBe('')
  })

  it('reads a repeated key as a list and a single key as a string', () => {
    expect(parseSearch('?status=todo&status=done&label=a%26b&flagged=1')).toEqual({ status: ['todo', 'done'], label: 'a&b', flagged: '1' })
    expect(parseSearch('')).toEqual({})
  })

  it('round-trips', () => {
    const search = { status: ['a', 'b c'], label: 'é&=?' }
    expect(parseSearch(stringifySearch(search))).toEqual(search)
  })
})

describe('type search', () => {
  it('accepts only the known types', () => {
    expect(validateSourcesSearch({ type: 'mcp' })).toEqual({ type: 'mcp' })
    expect(validateSourcesSearch({ type: 'scheduled' })).toEqual({})
    expect(validateRoutinesSearch({ type: 'agentic' })).toEqual({ type: 'agentic' })
    expect(validateRoutinesSearch({ type: 'mcp' })).toEqual({})
  })
})

describe('reserved workspace slugs', () => {
  it('covers what the servers own', () => {
    for (const slug of ['assets', 'api', 'ws', 'login', 'health', 'favicon.ico', 'favicon.svg', 'manifest.json', 'index.html']) {
      expect(isReservedWorkspaceSlug(slug), slug).toBe(true)
    }
    for (const slug of ['test', 'my-team', 'api-team', 'wsl', 'login-co', 'assetsx']) {
      expect(isReservedWorkspaceSlug(slug), slug).toBe(false)
    }
  })
})

describe('translateLegacyUrl', () => {
  it('translates ?ws=&route= on the root path', () => {
    expect(translateLegacyUrl('/', '?ws=test&route=allSessions')).toBe('/test/chats')
    expect(translateLegacyUrl('/', '?ws=test&route=allSessions%2Fsession%2Fabc')).toBe('/test/chats/abc')
    expect(translateLegacyUrl('/', '?ws=test&route=settings/appearance&workspaceId=ws_1')).toBe('/test/settings/appearance')
    expect(translateLegacyUrl('/', '?ws=test&route=flagged')).toBe('/test/chats?flagged=1')
    expect(translateLegacyUrl('/', '?ws=test&route=state/todo/session/abc')).toBe('/test/chats/abc?status=todo')
    expect(translateLegacyUrl('/', '?ws=test&route=allSessions%3Fstatus%3Dtodo%26status%3Ddone')).toBe('/test/chats?status=todo&status=done')
  })

  it('translates a saved file:// style URL whose path was an install directory', () => {
    expect(translateLegacyUrl('/', '?workspaceId=ws_1&ws=my-team&route=sources/api/source/gmail')).toBe('/my-team/settings/sources/gmail?type=api')
  })

  it('drops the transitional workspaceId and keeps the path and other params', () => {
    expect(translateLegacyUrl('/test/chats/abc', '?workspaceId=ws_1')).toBe('/test/chats/abc')
    expect(translateLegacyUrl('/', '?workspaceId=ws_1')).toBe('/')
    expect(translateLegacyUrl('/test/chats', '?workspaceId=ws_1&x=1')).toBe('/test/chats?x=1')
  })

  it('falls back to the root when the legacy route is invalid or has no workspace', () => {
    expect(translateLegacyUrl('/', '?ws=test&route=nope')).toBe('/')
    expect(translateLegacyUrl('/', '?route=allSessions')).toBe('/')
    expect(translateLegacyUrl('/', '?ws=test')).toBe('/')
  })

  it('leaves a current URL alone', () => {
    expect(translateLegacyUrl('/', '')).toBeNull()
    expect(translateLegacyUrl('/test/chats', '?flagged=1')).toBeNull()
    expect(translateLegacyUrl('/test/chats', '?workspace=ws_1')).toBeNull()
  })
})
