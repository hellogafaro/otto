import { afterEach, expect, it } from 'bun:test'
import { createConnection, deleteConnection, updateConnection, userScope, workspaceScope } from '@otto/shared/connections'
import { resolveBackendContext } from '@otto/shared/agent/connection-context'

const ids: string[] = []
afterEach(() => { for (const id of ids.splice(0)) deleteConnection(id) })

function connection(scope: string, defaultModel: string) {
  const row = createConnection({ scope, slug: 'next-turn', type: 'openai', authType: 'api_key', title: scope, defaultModel,
    models: ['gpt-first', 'gpt-second'], baseUrl: 'https://example.test/v1' })
  ids.push(row.id)
  return row
}

it('resolves saved connection edits afresh for the next native turn without a subprocess hot reload', () => {
  const row = connection(userScope('next-turn-owner'), 'gpt-first')
  const args = { sessionConnectionSlug: row.slug, where: { userId: 'next-turn-owner' }, agent: { title: 'Agent', provider: 'openai' } }
  const previous = resolveBackendContext(args)
  expect(previous.resolvedModel).toBe('gpt-first')
  updateConnection(row.id, { defaultModel: 'gpt-second', baseUrl: 'https://changed.example.test/v1' })
  const next = resolveBackendContext(args)
  expect(next.resolvedModel).toBe('gpt-second')
  expect(next.connection?.baseUrl).toBe('https://changed.example.test/v1')
  expect(previous.resolvedModel).toBe('gpt-first')
  expect(resolveBackendContext({ ...args, managedModel: 'gpt-first' }).resolvedModel).toBe('gpt-first')
  updateConnection(row.id, { models: ['gpt-second'] })
  expect(resolveBackendContext({ ...args, managedModel: 'gpt-first' }).resolvedModel).toBe('gpt-second')
})

it('a scoped edit never changes another creator or workspace connection with the same slug', () => {
  const owner = connection(userScope('next-turn-owner'), 'gpt-first')
  connection(userScope('next-turn-other'), 'gpt-first')
  connection(workspaceScope('next-turn-workspace'), 'gpt-first')
  const resolve = (userId: string) => resolveBackendContext({ sessionConnectionSlug: owner.slug, where: { userId, workspaceId: 'next-turn-workspace' }, agent: { title: 'Agent', provider: 'openai' } })
  updateConnection(owner.id, { defaultModel: 'gpt-second' })
  expect(resolve('next-turn-owner').resolvedModel).toBe('gpt-second')
  expect(resolve('next-turn-other').resolvedModel).toBe('gpt-first')
  expect(resolve('workspace-member').resolvedModel).toBe('gpt-first')
})
