import { expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { AGENT_DEFAULT_NAME } from '../branding.ts'
import { openDb } from '../db/index.ts'
import { pushSchema } from '../db/push.ts'
import { library } from '../library/schema.ts'
import { projects } from '../projects/schema.ts'
import { INSTALL, getSetting, updateSetting, workspaceEntity } from '../settings/index.ts'
import { tasks, timesheets } from '../tasks/schema.ts'
import { users } from '../users/schema.ts'
import { workspacesMembers } from '../workspaces/schema.ts'
import {
  AGENT_HOME_ONLY_INSTRUCTION,
  UNATTENDED_RUN_INSTRUCTIONS,
  assembleInstructions,
  canEditAgent,
  createAgent,
  deleteAgent,
  getAgent,
  getAgentRunConfig,
  getAgents,
  getDefaultAgent,
  initAgentsSeed,
  updateAgent,
  updateAgentsUnconnected,
} from './index.ts'
import { initAgentsImport } from './import.ts'

const W = 'ws1'
const ME = 'user:aaaaaaaaaaaa'

async function setup() {
  const db = openDb(':memory:')
  await pushSchema(db)
  return db
}
type Db = Awaited<ReturnType<typeof setup>>

const code = (run: () => unknown) => {
  try {
    run()
  } catch (error) {
    return (error as { code?: string }).code
  }
}

const make = (db: Db, title: string, extra: Partial<Parameters<typeof createAgent>[0]> = {}) =>
  createAgent({ workspaceId: W, title, provider: 'anthropic', createdBy: ME, ...extra }, db)

test('create writes every column and reads back', async () => {
  const db = await setup()
  const agent = make(db, ' Researcher ')
  expect(agent.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  expect(agent).toMatchObject({
    title: 'Researcher',
    instructions: '',
    provider: 'anthropic',
    model: null,
    thinkingLevel: 'medium',
    skills: [],
    sources: [],
    avatar: '',
    createdBy: ME,
    isDefault: true,
  })
  expect(agent.createdAt).toBe(agent.updatedAt)
  expect(getAgent(W, agent.id, db)).toEqual(agent)
  expect(getAgent('other', agent.id, db)).toBeUndefined()
  expect(getAgents('other', db)).toEqual([])
})

test('the default agent is the oldest, even when two are made in one millisecond', async () => {
  const db = await setup()
  const first = make(db, 'First')
  const second = make(db, 'Second')
  const third = make(db, 'Third')
  expect(getAgents(W, db).map((a) => [a.title, a.isDefault])).toEqual([['First', true], ['Second', false], ['Third', false]])
  expect(getDefaultAgent(W, db)?.id).toBe(first.id)
  expect(second.isDefault).toBe(false)
  expect(third.createdAt).toBeGreaterThan(second.createdAt)
  expect(getDefaultAgent('other', db)).toBeUndefined()
})

test('validates every field', async () => {
  const db = await setup()
  expect(code(() => make(db, '  '))).toBe('invalid')
  expect(code(() => make(db, 'x'.repeat(81)))).toBe('invalid')
  expect(code(() => make(db, 'A', { instructions: 'x'.repeat(20_001) }))).toBe('invalid')
  expect(code(() => make(db, 'A', { provider: ' ' }))).toBe('invalid')
  expect(code(() => make(db, 'A', { thinkingLevel: 'wild' as never }))).toBe('invalid')
  expect(code(() => make(db, 'A', { skills: [1] as never }))).toBe('invalid')
  expect(code(() => make(db, 'A', { sources: 'all' as never }))).toBe('invalid')
  expect(code(() => make(db, 'A', { avatar: 'https://x.test/a.png' }))).toBe('invalid')
  expect(code(() => make(db, 'A', { avatar: 'library:short' }))).toBe('invalid')
  expect(code(() => make(db, 'A', { createdBy: '' }))).toBe('invalid')
  expect(getAgents(W, db)).toEqual([])
  expect(make(db, 'B', { skills: ['s1', 's1', 's2'], model: '', avatar: 'library:abcdefghij12' })).toMatchObject({ skills: ['s1', 's2'], model: null, avatar: 'library:abcdefghij12' })
})

test('update changes the given fields, clears the model and refuses a stale save', async () => {
  const db = await setup()
  const agent = make(db, 'A', { model: 'm1', skills: ['s1'] })
  expect(updateAgent(W, agent.id, { avatar: 'library:abcdefghij12' }, db).avatar).toBe('library:abcdefghij12')
  expect(updateAgent(W, agent.id, { avatar: '' }, db).avatar).toBe('')
  agent.updatedAt = getAgent(W, agent.id, db)!.updatedAt
  const updated = updateAgent(W, agent.id, { instructions: 'Be brief', model: null, sources: ['x'], thinkingLevel: 'high', expectedUpdatedAt: agent.updatedAt }, db)
  expect(updated).toMatchObject({ title: 'A', instructions: 'Be brief', model: null, skills: ['s1'], sources: ['x'], thinkingLevel: 'high' })
  expect(updated.updatedAt).toBeGreaterThan(agent.updatedAt)
  expect(updated.createdAt).toBe(agent.createdAt)
  expect(code(() => updateAgent(W, agent.id, { title: 'B', expectedUpdatedAt: agent.updatedAt }, db))).toBe('conflict')
  expect(getAgent(W, agent.id, db)?.title).toBe('A')
  expect(code(() => updateAgent(W, agent.id, { title: '' }, db))).toBe('invalid')
  expect(code(() => updateAgent(W, 'nope', { title: 'B' }, db))).toBe('not_found')
  expect(code(() => updateAgent('other', agent.id, { title: 'B' }, db))).toBe('not_found')
  // two saves in one millisecond still tell apart
  const again = updateAgent(W, agent.id, { instructions: 'd' }, db)
  expect(again.updatedAt).toBeGreaterThan(updated.updatedAt)
})

test('the default agent cannot be deleted, even with other agents, and remains editable', async () => {
  const db = await setup()
  const first = make(db, 'First')
  expect(code(() => deleteAgent(W, first.id, db))).toBe('invalid')
  const second = make(db, 'Second')
  expect(code(() => deleteAgent(W, first.id, db))).toBe('invalid')
  expect(getDefaultAgent(W, db)?.id).toBe(first.id)
  expect(getAgent(W, first.id, db)?.isDefault).toBe(true)
  expect(updateAgent(W, first.id, { title: second.title, instructions: 'Edited instructions', model: 'edited-model' }, db)).toMatchObject({ id: first.id, title: second.title, instructions: 'Edited instructions', model: 'edited-model', isDefault: true })
  expect(initAgentsSeed(W, ME, 'openai', db)).toBeUndefined()
  expect(getAgents(W, db)).toHaveLength(2)
  deleteAgent(W, second.id, db)
  expect(getDefaultAgent(W, db)?.id).toBe(first.id)
  expect(code(() => deleteAgent(W, second.id, db))).toBe('not_found')
  expect(code(() => deleteAgent('other', second.id, db))).toBe('not_found')
  expect(code(() => deleteAgent(W, first.id, db))).toBe('invalid')
})

test('seeding makes one agent per workspace, once', async () => {
  const db = await setup()
  const seeded = initAgentsSeed(W, ME, 'openai', db)
  expect(seeded).toMatchObject({ title: AGENT_DEFAULT_NAME, provider: 'openai', createdBy: ME, isDefault: true })
  expect(initAgentsSeed(W, ME, 'openai', db)).toBeUndefined()
  expect(getAgents(W, db)).toHaveLength(1)
  expect(initAgentsSeed('ws2', ME, undefined, db)?.provider).toBe('anthropic')
})

test('its creator or an owner of the workspace may edit it', async () => {
  const db = await setup()
  db.insert(workspacesMembers).values([
    { id: 'm1', workspaceId: W, userId: 'aaaaaaaaaaaa', role: 'member', createdAt: new Date() },
    { id: 'm2', workspaceId: W, userId: 'bbbbbbbbbbbb', role: 'member', createdAt: new Date() },
    { id: 'm3', workspaceId: W, userId: 'cccccccccccc', role: 'owner', createdAt: new Date() },
  ]).run()
  const agent = make(db, 'A')
  expect(canEditAgent(W, agent, 'aaaaaaaaaaaa', db)).toBe(true)
  expect(canEditAgent(W, agent, 'bbbbbbbbbbbb', db)).toBe(false)
  expect(canEditAgent(W, agent, 'cccccccccccc', db)).toBe(true)
  expect(canEditAgent(W, agent, 'dddddddddddd', db)).toBe(false)
})

test('a new connection takes over the agents whose provider is not connected', async () => {
  const db = await setup()
  const seeded = initAgentsSeed(W, ME, undefined, db)!
  const pinned = make(db, 'Pinned', { model: 'claude-opus-4-7' })
  const connected = make(db, 'Connected', { provider: 'openai' })
  const others = make(db, 'Others', { createdBy: 'user:bbbbbbbbbbbb' })
  const moved = updateAgentsUnconnected(W, 'aaaaaaaaaaaa', 'openrouter', ['openrouter', 'openai'], db)
  expect(moved.map((agent) => agent.id)).toEqual([seeded.id])
  expect(getAgent(W, seeded.id, db)?.provider).toBe('openrouter')
  for (const kept of [pinned, connected, others]) expect(getAgent(W, kept.id, db)?.provider).toBe(kept.provider)
})

test('assembles the groups in order and leaves empty ones out', () => {
  const text = assembleInstructions({
    product: 'Otto',
    rules: ' Never push without being asked. ',
    workspaceInstructions: '  We ship on Fridays.  ',
    agent: { title: 'Ada "the" Researcher & co', instructions: ' Be kind. ', homePath: '/home/agent/memory' },
    toolGuidance: ['Use the otto CLI for tasks.', ' ', 'Prefer grep over find.'],
    sources: [{ slug: 'linear', title: 'Linear', description: 'Issues' }, { slug: 'notion', title: 'Notion' }],
    runMode: 'unattended',
  })
  expect(text).toBe(
    [
      '<otto_rules>\nNever push without being asked.\n</otto_rules>',
      '<otto_workspace>\nWe ship on Fridays.\n</otto_workspace>',
      '<otto_agent name="Ada &quot;the&quot; Researcher &amp; co" home="/home/agent/memory">\nBe kind.\n</otto_agent>',
      '<otto_tools>\nUse the otto CLI for tasks.\n\nPrefer grep over find.\n</otto_tools>',
      '<connected_mcps>\nConnected MCP sources you may use (their tools are named mcp__<slug>__<tool>):\n- linear: Linear - Issues\n- notion: Notion\n</connected_mcps>',
      `<otto_run mode="unattended">\n${UNATTENDED_RUN_INSTRUCTIONS}\n</otto_run>`,
    ].join('\n\n'),
  )
})

test('an agent with no instructions gets a one-line home hint, or no group; everything empty is the empty string', () => {
  const base = { product: 'Otto', workspaceInstructions: '' }
  expect(assembleInstructions({ ...base, agent: { title: 'Ada', instructions: '  ', homePath: '/home/agent/memory' } })).toBe(
    `<otto_agent name="Ada" home="/home/agent/memory">\n${AGENT_HOME_ONLY_INSTRUCTION}\n</otto_agent>`,
  )
  expect(assembleInstructions({ ...base, agent: { title: 'Ada', instructions: 'Be brief' } })).toBe('<otto_agent name="Ada">\nBe brief\n</otto_agent>')
  expect(assembleInstructions({ ...base, agent: { title: 'Ada', instructions: '' }, toolGuidance: [], sources: [], runMode: 'attended' })).toBe('')
  // the prefix follows the product; connected_mcps does not
  expect(assembleInstructions({ product: 'Acme Co', workspaceInstructions: 'x', agent: { title: 'A', instructions: '' } })).toBe('<acme_co_workspace>\nx\n</acme_co_workspace>')
})

test('the run config is the chat\'s agent, else the default one, with the workspace instructions in front', async () => {
  const db = await setup()
  const first = make(db, 'First', { instructions: 'First rules', model: 'm1', thinkingLevel: 'low', skills: ['s1'], sources: ['x1'] })
  const second = make(db, 'Second', { provider: 'openai' })
  expect(getAgentRunConfig(undefined, 'other', db)).toBeUndefined()
  expect(getAgentRunConfig('nope', undefined, db)).toBeUndefined()

  const config = getAgentRunConfig(first.id, W, db)!
  expect(config).toMatchObject({ agent: { id: first.id, title: 'First' }, provider: 'anthropic', model: 'm1', thinkingLevel: 'low', skills: ['s1'], sources: ['x1'] })
  expect(config.instructions).toBe('<otto_agent name="First">\nFirst rules\n</otto_agent>')
  expect(config).toMatchObject({ workspaceInstructions: '', agentInstructions: 'First rules' })

  updateSetting(workspaceEntity(W), 'instructions', 'House rules', db)
  expect(getAgentRunConfig(second.id, W, db)).toMatchObject({ agent: { id: second.id }, provider: 'openai' })
  expect(getAgentRunConfig(second.id, undefined, db)).toMatchObject({ instructions: '<otto_workspace>\nHouse rules\n</otto_workspace>', workspaceInstructions: 'House rules', agentInstructions: '' })

  // no agent named, a deleted one, or one of another workspace: the default agent of the workspace
  expect(getAgentRunConfig(null, W, db)!.agent.id).toBe(first.id)
  deleteAgent(W, second.id, db)
  expect(getAgentRunConfig(second.id, W, db)!.agent.id).toBe(first.id)
  expect(getAgentRunConfig(second.id, undefined, db)).toBeUndefined()
  expect(getAgentRunConfig(first.id, 'other', db)).toBeUndefined()
})

test('the workspace instructions setting is owner text, at most 20,000 characters', async () => {
  const db = await setup()
  expect(getSetting(workspaceEntity(W), 'instructions', db)).toBe('')
  updateSetting(workspaceEntity(W), 'instructions', 'x'.repeat(20_000), db)
  expect(code(() => updateSetting(workspaceEntity(W), 'instructions', 'x'.repeat(20_001), db))).toBeDefined()
  expect(code(() => updateSetting(INSTALL, 'instructions' as never, 'x', db))).toBeDefined()
})

test('the importer seeds each workspace and rewrites agent:default, once', async () => {
  const db = await setup()
  const now = new Date()
  const alice = 'aaaaaaaaaaaa'
  db.insert(users).values({ id: alice, name: 'a', email: 'a@x.test', createdAt: now, updatedAt: now }).run()
  db.insert(workspacesMembers).values([
    { id: 'm1', workspaceId: W, userId: alice, role: 'owner', createdAt: now },
    { id: 'm2', workspaceId: 'ws2', userId: alice, role: 'owner', createdAt: now },
  ]).run()
  const row = { createdAt: now, updatedAt: now }
  db.insert(projects).values([
    { id: 'p1', workspaceId: W, title: 'P', members: ['agent:default', ME], ...row },
    { id: 'p2', workspaceId: 'ws2', title: 'P2', members: ['agent:default'], ...row },
  ]).run()
  db.insert(tasks).values([
    { id: 't1', workspaceId: W, projectId: 'p1', title: 'T', createdBy: 'agent:default', assignees: ['agent:default', ME], ...row },
    { id: 't2', workspaceId: W, projectId: 'p1', title: 'T', createdBy: ME, assignees: [ME, 'agent:other'], ...row },
    { id: 't3', workspaceId: 'ws2', projectId: 'p2', title: 'T', createdBy: ME, assignees: ['agent:default'], ...row },
  ]).run()
  db.insert(timesheets).values({ id: 's1', workspaceId: W, taskId: 't1', createdBy: 'agent:default', createdAt: now, time: 1, notes: '' }).run()
  db.insert(library).values({ id: 'l1', workspaceId: W, type: 'file', title: 'f', createdBy: 'agent:default', ...row }).run()

  const report = initAgentsImport(db, [{ id: W }, { id: 'ws2' }, { id: 'ws3' }], () => 'openai')
  expect(report).toMatchObject({ workspaces: 3, skipped: 0 }) // ws3 has no member: the first user creates its agent
  const [agent] = getAgents(W, db)
  const [agent2] = getAgents('ws2', db)
  expect(agent).toMatchObject({ title: AGENT_DEFAULT_NAME, provider: 'openai', createdBy: `user:${alice}` })
  expect(getAgents('ws3', db)[0]?.createdBy).toBe(`user:${alice}`)

  const mine = `agent:${agent!.id}`
  expect(db.select().from(tasks).where(eq(tasks.id, 't1')).get()).toMatchObject({ createdBy: mine, assignees: [mine, ME] })
  expect(db.select().from(tasks).where(eq(tasks.id, 't2')).get()).toMatchObject({ createdBy: ME, assignees: [ME, 'agent:other'] })
  expect(db.select().from(tasks).where(eq(tasks.id, 't3')).get()?.assignees).toEqual([`agent:${agent2!.id}`]) // each workspace its own
  expect(db.select().from(timesheets).get()?.createdBy).toBe(mine)
  expect(db.select().from(library).get()?.createdBy).toBe(mine)
  expect(db.select().from(projects).orderBy(projects.id).all().map((p) => p.members)).toEqual([[mine, ME], [`agent:${agent2!.id}`]])
  expect(getSetting(INSTALL, 'imports', db)[`agents:${W}`]).toBeGreaterThan(0)

  // idempotent: nothing is made or rewritten again (a task given agent:default afterwards stays)
  db.update(tasks).set({ createdBy: 'agent:default' }).where(eq(tasks.id, 't2')).run()
  expect(initAgentsImport(db, [{ id: W }, { id: 'ws2' }], () => 'x')).toMatchObject({ workspaces: 0, skipped: 0 })
  expect(getAgents(W, db)).toEqual([agent!])
  expect(db.select().from(tasks).where(eq(tasks.id, 't2')).get()?.createdBy).toBe('agent:default')

  // a workspace that got its agent at creation keeps it; the importer only rewrites to it
  const created = initAgentsSeed('ws4', ME, 'p', db)!
  expect(initAgentsImport(db, [{ id: 'ws4' }], () => 'other')).toMatchObject({ workspaces: 1 })
  expect(getAgents('ws4', db).map((a) => a.id)).toEqual([created.id])
})

test('the importer waits for a user when there is nobody to create the first agent', async () => {
  const db = await setup()
  expect(initAgentsImport(db, [{ id: W }], () => 'x')).toMatchObject({ workspaces: 0, skipped: 1 })
  expect(getAgents(W, db)).toEqual([])
  expect(getSetting(INSTALL, 'imports', db)[`agents:${W}`]).toBeUndefined()
})
