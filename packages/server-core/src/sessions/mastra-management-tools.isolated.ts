import { beforeAll, expect, it } from 'bun:test'
import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { z } from 'zod'
import { createAgent, deleteAgent, getAgent, getAgentRunConfig, getAgents, initAgentsSeed, updateAgent } from '@otto/shared/agents'
import { permissionsConfigCache } from '@otto/shared/agent'
import { createRoutine, getRoutine, startRoutineRun, updateRoutine } from '@otto/shared/automations/routines'
import { createConnection, deleteConnection, userScope, workspaceScope } from '@otto/shared/connections'
import { addWorkspace, saveConfig } from '@otto/shared/config'
import { CONFIG_DIR } from '@otto/shared/config/paths'
import { DB_PATH, initDb } from '@otto/shared/db'
import { createLabel } from '@otto/shared/labels/crud'
import { getBundleStore } from '@otto/shared/library'
import { createDiskFileStore } from '../../../shared/src/library/file-store'
import { getChatsFields } from '@otto/shared/sessions'
import { writeChat } from '../../../shared/src/sessions/chats'
import { createSkill, createSkillsStore, getSkill } from '@otto/shared/skills'
import { initSecretsStore } from '@otto/shared/secrets'
import { createSource, createSourcesStore, getSource, getSourceCredential, loadSourceConfig, loadSourceGuide, saveSourceConfig, setSourceCredential, SourceUpdateSchema, syncLocalSource, updateSource } from '@otto/shared/sources'
import { createStatus } from '@otto/shared/statuses'
import { users } from '@otto/shared/users/schema'
import { createWorkspaceMember, deleteWorkspaceMember, loadWorkspaceConfig, saveWorkspaceConfig, updateWorkspaceMemberRole } from '@otto/shared/workspaces'
import { createMastraManagementTools, MANAGEMENT_DESTRUCTIVE_TOOL_NAMES, MANAGEMENT_NOTIFICATION_TOOL_NAMES, MANAGEMENT_READ_TOOL_NAMES, MANAGEMENT_SENSITIVE_TOOL_NAMES, MANAGEMENT_WRITE_TOOL_NAMES } from './mastra-management-tools'

type Tools = ReturnType<typeof createMastraManagementTools>
beforeAll(() => {
  expect(basename(CONFIG_DIR)).toStartWith('otto-test-')
  expect(DB_PATH).toBe(join(CONFIG_DIR, 'otto.db'))
  expect(existsSync(DB_PATH)).toBe(true)
  saveConfig({ workspaces: [] })
})

const call = async (tools: Tools, name: keyof Tools, input: unknown): Promise<any> => {
  const tool = tools[name]
  const parsed = (tool.inputSchema as z.ZodType).parse(input)
  return tool.execute!(parsed as never, {} as never)
}
const rejection = (pending: Promise<unknown>) => pending.then(() => undefined, (error: unknown) => error)

function fixture() {
  expect(basename(CONFIG_DIR)).toStartWith('otto-test-')
  const workspace = addWorkspace({ name: 'Management fixture', rootPath: join(CONFIG_DIR, crypto.randomUUID()) })
  const foreign = addWorkspace({ name: 'Foreign fixture', rootPath: join(CONFIG_DIR, crypto.randomUUID()) })
  const ownerId = crypto.randomUUID(), memberId = crypto.randomUUID(), outsiderId = crypto.randomUUID()
  for (const userId of [ownerId, memberId, outsiderId]) initDb().insert(users).values({ id: userId, name: 'Fixture human', email: `${userId}@example.test`, createdAt: new Date(), updatedAt: new Date() }).run()
  createWorkspaceMember(workspace.id, ownerId, 'owner')
  createWorkspaceMember(workspace.id, memberId, 'member')
  createWorkspaceMember(foreign.id, outsiderId, 'owner')
  const agent = createAgent({ workspaceId: workspace.id, title: 'Protected fixture agent', provider: 'openai', createdBy: `user:${ownerId}` })
  const foreignAgent = createAgent({ workspaceId: foreign.id, title: 'Foreign agent', provider: 'openai', createdBy: `user:${outsiderId}` })
  let userId: string = memberId, accessible = true
  const chats = new Set<string>()
  const runs: { id: string; userId: string }[] = []
  const scope = {
    workspaceId: workspace.id, agentId: agent.id,
    getUserId: () => userId,
    assertAccess: () => { if (!accessible) throw new Error('Access removed') },
    assertChatAccess: (id: string) => { if (!chats.has(id)) throw new Error('Chat inaccessible') },
    runRoutine: async (id: string, currentUserId: string) => { runs.push({ id, userId: currentUserId }); return { id: crypto.randomUUID(), status: 'running', secret: 'never-forward-this-field' } },
  }
  const tools = createMastraManagementTools(scope)
  const connection = createConnection({ scope: userScope(memberId), slug: 'fixture-openai', type: 'openai', authType: 'api_key', title: 'Fixture connection', baseUrl: 'https://provider.example.test/v1', defaultModel: 'fixture-model', models: ['fixture-model', 'fixture-next'], config: { customEndpoint: { api: 'openai-responses' } } }, { apiKey: 'disposable-fixture-credential' })
  const config = { type: 'schedule' as const, schedule: { cron: '0 9 * * *', timezone: 'Europe/Madrid' }, permissionMode: 'safe' as const, actions: [{ type: 'prompt' as const, prompt: 'Draft a summary' }] }
  return { workspace, foreign, ownerId, memberId, outsiderId, agent, foreignAgent, connection, config, scope, tools, chats, runs,
    setUserId: (value: string) => { userId = value }, setAccess: (value: boolean) => { accessible = value } }
}

async function makeSource(f: ReturnType<typeof fixture>, name: string, type: 'api' | 'mcp' | 'local' = 'api', creator = f.memberId) {
  const config = await createSource(f.workspace.rootPath, {
    name, provider: 'custom', type,
    ...(type === 'api' ? { api: { baseUrl: 'https://source.example.test/private-token-path', authType: 'bearer' as const, defaultHeaders: { 'x-private': 'fixture-private-header' } } } : type === 'mcp' ? { mcp: { transport: 'stdio' as const, command: 'fixture-never-execute', env: { TOKEN: 'fixture-private-env' } } } : { local: { path: '/fixture-never-read-host' } }),
  })
  await syncLocalSource(f.workspace.id, config.slug, `user:${creator}`)
  return getSource(f.workspace.id, config.slug)!
}

async function makeSkill(f: ReturnType<typeof fixture>, slug: string, creator = f.memberId) {
  return createSkill({ workspaceId: f.workspace.id, slug, createdBy: `user:${creator}`, files: new Map([
    ['SKILL.md', new TextEncoder().encode(`---\nname: Fixture skill\ndescription: Safe metadata\nprivateConfig: fixture-private-metadata\n---\nUI-visible fixture instructions.\n`)],
    ['scripts/preserve.ts', new TextEncoder().encode('fixture-private-ancillary-script')],
  ]) })
}

it('has exhaustive distinct strict schemas and explicit approval classification, without legacy name collisions', () => {
  const f = fixture()
  expect(Object.keys(f.tools)).toHaveLength(36)
  for (const name of ['create_agent', 'create_routine', 'source_save_credentials', 'connection_create', 'routine_reset_webhook']) expect(f.tools).not.toHaveProperty(name)
  expect(new Set([...MANAGEMENT_READ_TOOL_NAMES, ...MANAGEMENT_WRITE_TOOL_NAMES])).toEqual(new Set(Object.keys(f.tools)))
  for (const name of MANAGEMENT_READ_TOOL_NAMES) expect(MANAGEMENT_WRITE_TOOL_NAMES.has(name)).toBe(false)
  for (const name of [...MANAGEMENT_DESTRUCTIVE_TOOL_NAMES, ...MANAGEMENT_NOTIFICATION_TOOL_NAMES, ...MANAGEMENT_SENSITIVE_TOOL_NAMES]) expect(MANAGEMENT_WRITE_TOOL_NAMES.has(name)).toBe(true)
  for (const name of ['agent_create', 'agent_configure', 'routine_set_paused', 'routine_run', 'status_create', 'label_update', 'source_create']) expect(MANAGEMENT_SENSITIVE_TOOL_NAMES.has(name)).toBe(true)
  for (const tool of Object.values(f.tools)) expect((tool.inputSchema as z.ZodType).safeParse({ workspaceId: f.foreign.id, createdBy: `user:${f.ownerId}`, apiKey: 'insecure', rootPath: '/Users/jg' }).success).toBe(false)
})

it('requires the exact current human and named workspace agent on every read, with no owner/creator fallback', async () => {
  const f = fixture()
  await call(f.tools, 'agent_list', {})
  f.setUserId('')
  await expect(call(f.tools, 'agent_list', {})).rejects.toThrow()
  f.setUserId(f.outsiderId)
  await expect(call(f.tools, 'agent_list', {})).rejects.toThrow('initiating person')
  f.setUserId(f.memberId)
  f.setAccess(false)
  await expect(call(f.tools, 'source_list', {})).rejects.toThrow('Access removed')
  f.setAccess(true)
  const foreignTools = createMastraManagementTools({ ...f.scope, agentId: f.foreignAgent.id })
  await expect(call(foreignTools, 'label_list', {})).rejects.toThrow('named agent')
  await expect(call(f.tools, 'agent_get', { id: f.foreignAgent.id })).rejects.toThrow('not found')
  deleteWorkspaceMember(f.workspace.id, f.memberId)
  await expect(call(f.tools, 'skill_list', {})).rejects.toThrow('initiating person')
})

it('protects the oldest identity on domain and tool deletion while allowing name/model edits and idempotent seeding', async () => {
  const f = fixture()
  f.setUserId(f.ownerId)
  const extra = createAgent({ workspaceId: f.workspace.id, title: f.agent.title, provider: 'openai', createdBy: `user:${f.ownerId}` })
  const chatId = crypto.randomUUID()
  writeChat(initDb(), { id: chatId, workspaceId: f.workspace.id, workspaceRootPath: f.workspace.rootPath, createdBy: `user:${f.ownerId}`, createdAt: Date.now(), lastUsedAt: Date.now(), agentId: f.agent.id })
  expect(() => deleteAgent(f.workspace.id, f.agent.id)).toThrow('default agent')
  await expect(call(f.tools, 'agent_delete', { id: f.agent.id, expectedUpdatedAt: f.agent.updatedAt })).rejects.toThrow('default agent')
  expect(getChatsFields(f.workspace.id, [chatId]).get(chatId)?.agentId).toBe(f.agent.id)
  const updated = await call(f.tools, 'agent_update', { id: f.agent.id, title: 'Editable renamed default', instructions: 'Editable instructions', expectedUpdatedAt: f.agent.updatedAt })
  expect(updated).toMatchObject({ id: f.agent.id, isDefault: true, instructions: 'Editable instructions' })
  expect(initAgentsSeed(f.workspace.id, `user:${f.ownerId}`)).toBeUndefined()
  expect(getAgents(f.workspace.id)).toHaveLength(2)
  await call(f.tools, 'agent_delete', { id: extra.id, expectedUpdatedAt: extra.updatedAt })
  expect(getAgent(f.workspace.id, f.agent.id)?.isDefault).toBe(true)
})

it('validates actual supported visible models, refuses ambiguity, stale updates and unsupported subscriptions without disclosing configs', async () => {
  const f = fixture()
  const visible = await call(f.tools, 'agent_connections', {})
  expect(visible).toEqual([{ id: f.connection.id, slug: 'fixture-openai', scope: userScope(f.memberId), title: 'Fixture connection', provider: 'openai', models: ['fixture-model', 'fixture-next'], defaultModel: 'fixture-model', updatedAt: f.connection.updatedAt, selectable: true, legacySelectable: true }])
  expect(JSON.stringify(visible)).not.toContain('disposable-fixture-credential')
  expect(JSON.stringify(visible)).not.toContain('provider.example.test')
  const created = await call(f.tools, 'agent_create', { title: 'Human created agent', provider: 'openai', model: 'fixture-model' })
  expect(created.createdBy).toBe(`user:${f.memberId}`)
  expect(created.llmConnectionId).toBe(f.connection.id)
  const configured = await call(f.tools, 'agent_configure', { id: created.id, model: 'fixture-next', thinkingLevel: 'high', expectedUpdatedAt: created.updatedAt })
  expect(getAgent(f.workspace.id, created.id)).toMatchObject({ model: 'fixture-next', thinkingLevel: 'high' })
  await expect(call(f.tools, 'agent_configure', { id: created.id, model: 'fixture-model', expectedUpdatedAt: created.updatedAt })).rejects.toThrow('changed')
  await expect(call(f.tools, 'agent_configure', { id: created.id, model: 'not-visible-model', expectedUpdatedAt: configured.updatedAt })).rejects.toThrow('visible connection model list')
  await expect(call(f.tools, 'agent_update', { id: f.agent.id, title: 'Unauthorized change', expectedUpdatedAt: f.agent.updatedAt })).rejects.toThrow('creator')
  createConnection({ scope: userScope(f.memberId), slug: 'unsupported-subscription', type: 'anthropic', authType: 'oauth', title: 'Stored subscription', models: ['fixture-model'], defaultModel: 'fixture-model' })
  await expect(call(f.tools, 'agent_create', { title: 'No subscription', provider: 'anthropic', model: 'fixture-model' })).rejects.toThrow('supported API-key')
  createConnection({ scope: workspaceScope(f.workspace.id), slug: 'second-openai', type: 'openai', authType: 'api_key', title: 'Shared fixture', models: ['fixture-model'], defaultModel: 'fixture-model' }, { apiKey: 'second-disposable-fixture' })
  await expect(call(f.tools, 'agent_create', { title: 'No ambiguous fallback', provider: 'openai', model: 'fixture-model' })).rejects.toThrow('exactly one')
  expect((await call(f.tools, 'agent_connections', {})).every((value: { selectable: boolean; legacySelectable: boolean }) => value.selectable && !value.legacySelectable)).toBe(true)
})

it('pins exact visible connection IDs across same-slug scopes and refuses missing/inaccessible IDs without fallback or stored-ID rewrites', async () => {
  const f = fixture()
  const legacy = createAgent({ workspaceId: f.workspace.id, title: 'Unbound legacy fixture', provider: 'openai', createdBy: `user:${f.memberId}` })
  expect(legacy.llmConnectionId).toBeNull()
  const pinned = await call(f.tools, 'agent_configure', { id: legacy.id, thinkingLevel: 'high', expectedUpdatedAt: legacy.updatedAt })
  expect(pinned.llmConnectionId).toBe(f.connection.id)
  const shared = createConnection({ scope: workspaceScope(f.workspace.id), slug: f.connection.slug, type: 'openai', authType: 'api_key', title: 'Same-slug shared fixture', baseUrl: 'https://shared-provider.example.test/v1', defaultModel: 'shared-model', models: ['shared-model', 'shared-next'] }, { apiKey: 'disposable-shared-exact-id-key' })
  const foreign = createConnection({ scope: userScope(f.outsiderId), slug: f.connection.slug, type: 'openai', authType: 'api_key', title: 'Foreign private fixture', defaultModel: 'fixture-model', models: ['fixture-model'] }, { apiKey: 'disposable-foreign-exact-id-key' })
  const foreignWorkspace = createConnection({ scope: workspaceScope(f.foreign.id), slug: f.connection.slug, type: 'openai', authType: 'api_key', title: 'Foreign workspace fixture', defaultModel: 'fixture-model', models: ['fixture-model'] }, { apiKey: 'disposable-other-workspace-key' })
  const visible = await call(f.tools, 'agent_connections', {})
  expect(visible.map((value: { id: string }) => value.id)).toEqual([f.connection.id, shared.id])
  expect(visible.every((value: { selectable: boolean; legacySelectable: boolean }) => value.selectable && !value.legacySelectable)).toBe(true)
  for (const secret of ['shared-provider.example.test', 'provider.example.test', 'disposable-shared-exact-id-key', 'disposable-foreign-exact-id-key', 'customEndpoint', 'apiKey']) expect(JSON.stringify(visible)).not.toContain(secret)
  await expect(call(f.tools, 'agent_create', { title: 'No same-slug fallback', provider: 'openai', model: 'fixture-model' })).rejects.toThrow('exactly one')
  const ambiguousLegacy = createAgent({ workspaceId: f.workspace.id, title: 'Ambiguous unbound legacy fixture', provider: 'openai', createdBy: `user:${f.memberId}` })
  await expect(call(f.tools, 'agent_configure', { id: ambiguousLegacy.id, thinkingLevel: 'high', expectedUpdatedAt: ambiguousLegacy.updatedAt })).rejects.toThrow('exactly one')
  expect(getAgent(f.workspace.id, ambiguousLegacy.id)).toEqual(ambiguousLegacy)
  const selected = await call(f.tools, 'agent_create', { title: 'Explicit shared selection', provider: 'openai', model: 'shared-model', llmConnectionId: shared.id })
  expect(selected.llmConnectionId).toBe(shared.id)
  expect(getAgentRunConfig(selected.id, f.workspace.id)?.llmConnectionId).toBe(shared.id)
  const modelEdit = await call(f.tools, 'agent_configure', { id: selected.id, model: 'shared-next', expectedUpdatedAt: selected.updatedAt })
  expect(modelEdit).toMatchObject({ llmConnectionId: shared.id, model: 'shared-next' })
  const capabilityEdit = await call(f.tools, 'agent_configure', { id: selected.id, thinkingLevel: 'max', expectedUpdatedAt: modelEdit.updatedAt })
  expect(capabilityEdit.llmConnectionId).toBe(shared.id)
  let personal = await call(f.tools, 'agent_create', { title: 'Explicit personal selection', provider: 'openai', model: 'fixture-model', llmConnectionId: f.connection.id })
  expect(personal.llmConnectionId).toBe(f.connection.id)
  const switched = await call(f.tools, 'agent_configure', { id: personal.id, model: 'shared-model', llmConnectionId: shared.id, expectedUpdatedAt: personal.updatedAt })
  expect(getAgentRunConfig(personal.id, f.workspace.id)?.llmConnectionId).toBe(shared.id)
  personal = await call(f.tools, 'agent_configure', { id: personal.id, model: 'fixture-model', llmConnectionId: f.connection.id, expectedUpdatedAt: switched.updatedAt })
  expect(personal.llmConnectionId).toBe(f.connection.id)
  await expect(call(f.tools, 'agent_configure', { id: personal.id, llmConnectionId: null, expectedUpdatedAt: personal.updatedAt })).rejects.toThrow('exactly one')
  expect(getAgent(f.workspace.id, personal.id)).toEqual(personal)
  await expect(call(f.tools, 'agent_create', { title: 'Wrong exact catalog', provider: 'openai', model: 'fixture-model', llmConnectionId: shared.id })).rejects.toThrow('visible connection model list')
  await expect(call(f.tools, 'agent_create', { title: 'Wrong exact provider', provider: 'anthropic', model: 'shared-model', llmConnectionId: shared.id })).rejects.toThrow('does not match')
  for (const connectionId of [foreign.id, foreignWorkspace.id, crypto.randomUUID()]) {
    await expect(call(f.tools, 'agent_create', { title: 'Denied exact identity', provider: 'openai', model: 'fixture-model', llmConnectionId: connectionId })).rejects.toThrow('missing or inaccessible')
    await expect(call(f.tools, 'agent_configure', { id: personal.id, llmConnectionId: connectionId, expectedUpdatedAt: personal.updatedAt })).rejects.toThrow('missing or inaccessible')
    expect(getAgent(f.workspace.id, personal.id)?.llmConnectionId).toBe(f.connection.id)
  }
  const storedForeign = createAgent({ workspaceId: f.workspace.id, title: 'Stored unavailable binding', provider: 'openai', llmConnectionId: foreign.id, model: 'fixture-model', createdBy: `user:${f.memberId}` })
  await expect(call(f.tools, 'agent_configure', { id: storedForeign.id, model: 'fixture-next', expectedUpdatedAt: storedForeign.updatedAt })).rejects.toThrow('missing or inaccessible')
  expect(getAgent(f.workspace.id, storedForeign.id)).toEqual(storedForeign)
  const pinnedEdit = await call(f.tools, 'agent_configure', { id: legacy.id, model: 'fixture-next', expectedUpdatedAt: pinned.updatedAt })
  expect(pinnedEdit.llmConnectionId).toBe(f.connection.id)
  deleteConnection(shared.id)
  await expect(call(f.tools, 'agent_configure', { id: selected.id, model: 'fixture-model', expectedUpdatedAt: capabilityEdit.updatedAt })).rejects.toThrow('missing or inaccessible')
  expect(getAgent(f.workspace.id, selected.id)).toEqual(capabilityEdit)
  expect(getAgent(f.workspace.id, personal.id)?.llmConnectionId).toBe(f.connection.id)
})

it('enforces live source/skill capability scope for reads, deletes, configuration and draft creation', async () => {
  const f = fixture()
  const selectedSkill = await makeSkill(f, 'allowed-skill'), hiddenSkill = await makeSkill(f, 'hidden-skill')
  const selectedSource = await makeSource(f, 'Allowed source'), hiddenSource = await makeSource(f, 'Hidden source')
  updateAgent(f.workspace.id, f.agent.id, { skills: [selectedSkill.id], sources: [selectedSource.slug] })
  expect(await call(f.tools, 'skill_list', {})).toEqual([selectedSkill])
  expect(await call(f.tools, 'source_list', {})).toEqual([selectedSource])
  await expect(call(f.tools, 'skill_get', { slug: hiddenSkill.slug })).rejects.toThrow('agent scope')
  await expect(call(f.tools, 'source_get', { slug: hiddenSource.slug })).rejects.toThrow('agent scope')
  await expect(call(f.tools, 'source_get', { slug: hiddenSource.id })).rejects.toThrow('agent scope')
  await expect(call(f.tools, 'source_get', { slug: loadSourceConfig(f.workspace.rootPath, hiddenSource.slug)!.id })).rejects.toThrow('agent scope')
  await expect(call(f.tools, 'skill_delete', { slug: hiddenSkill.slug, expectedUpdatedAt: hiddenSkill.updatedAt })).rejects.toThrow('agent scope')
  await expect(call(f.tools, 'source_delete', { slug: hiddenSource.slug, expectedUpdatedAt: hiddenSource.updatedAt })).rejects.toThrow('agent scope')
  await expect(call(f.tools, 'source_create', { title: 'No scope expansion', type: 'api', url: 'https://source.example.test' })).rejects.toThrow('restricted agent')
  f.setUserId(f.ownerId)
  const current = getAgent(f.workspace.id, f.agent.id)!
  await expect(call(f.tools, 'agent_configure', { id: f.agent.id, skills: [], expectedUpdatedAt: current.updatedAt })).rejects.toThrow('all workspace capabilities')
  await expect(call(f.tools, 'agent_configure', { id: f.agent.id, sources: [hiddenSource.slug], expectedUpdatedAt: current.updatedAt })).rejects.toThrow('unavailable')
  updateAgent(f.workspace.id, f.agent.id, { skills: [], sources: [] })
  expect(await call(f.tools, 'source_get', { slug: hiddenSource.slug })).toEqual(hiddenSource)
})

it('redacts source and skill configs, rejects insecure source setup and preserves stored local/stdio records', async () => {
  const f = fixture()
  const remote = await makeSource(f, 'Authenticated source'), local = await makeSource(f, 'Stored local', 'local'), stdio = await makeSource(f, 'Stored stdio', 'mcp')
  const skill = await makeSkill(f, 'metadata-only')
  await setSourceCredential(f.workspace.id, remote.slug, 'source_bearer', { value: 'disposable-source-token' })
  const read = JSON.stringify({ sources: await call(f.tools, 'source_list', {}), source: await call(f.tools, 'source_get', { slug: remote.slug }), skill: await call(f.tools, 'skill_get', { slug: skill.slug }) })
  for (const secret of ['disposable-source-token', 'private-token-path', 'fixture-private-header', 'fixture-private-env', '/fixture-never-read-host', 'fixture-private-metadata', 'fixture-private-ancillary-script', 'folderPath', 'rootPath']) expect(read).not.toContain(secret)
  for (const extra of [{ authType: 'bearer' }, { apiKey: 'insecure' }, { headers: { Authorization: 'insecure' } }, { command: 'insecure' }, { local: { path: '/Users/jg' } }]) await expect(call(f.tools, 'source_create', { title: 'Insecure setup', type: 'api', url: 'https://source.example.test', ...extra })).rejects.toThrow()
  for (const url of ['file:///Users/jg', 'https://user:password@example.test', 'https://example.test?token=secret', 'https://example.test#secret']) await expect(call(f.tools, 'source_create', { title: 'Insecure URL', type: 'mcp', url })).rejects.toThrow()
  const draft = await call(f.tools, 'source_create', { title: 'Disabled draft', type: 'mcp', url: 'https://remote.example.test/mcp' })
  expect(draft.createdBy).toBe(`user:${f.memberId}`)
  expect(loadSourceConfig(f.workspace.rootPath, draft.slug)).toMatchObject({ enabled: false, type: 'mcp', mcp: { transport: 'http', authType: 'none' } })
  expect(JSON.stringify(draft)).not.toContain('remote.example.test')
  expect(loadSourceConfig(f.workspace.rootPath, local.slug)).toMatchObject({ type: 'local', local: { path: '/fixture-never-read-host' } })
  expect(loadSourceConfig(f.workspace.rootPath, stdio.slug)).toMatchObject({ mcp: { transport: 'stdio', command: 'fixture-never-execute' } })
  f.setUserId(f.ownerId)
  await expect(call(f.tools, 'agent_configure', { id: f.agent.id, sources: [local.slug], expectedUpdatedAt: f.agent.updatedAt })).rejects.toThrow('Only remote')
  await expect(call(f.tools, 'agent_configure', { id: f.agent.id, sources: [stdio.slug], expectedUpdatedAt: f.agent.updatedAt })).rejects.toThrow('Only remote')
})

it('accepts source slugs, row IDs and different stored config IDs without rekeying references or returning private configs', async () => {
  const f = fixture()
  const source = await makeSource(f, 'Distinct identifier source')
  const config = loadSourceConfig(f.workspace.rootPath, source.slug)!
  expect(config.id).not.toBe(source.id)
  const target = createAgent({ workspaceId: f.workspace.id, title: 'Alias configuration target', provider: 'openai', createdBy: `user:${f.memberId}` })
  for (const allowedRef of [source.slug, source.id, config.id]) {
    updateAgent(f.workspace.id, f.agent.id, { sources: [allowedRef] })
    expect(await call(f.tools, 'source_list', {})).toEqual([source])
    for (const selectedRef of [source.slug, source.id, config.id]) {
      const read = await call(f.tools, 'source_get', { slug: selectedRef })
      expect(read).toEqual(source)
      const current = getAgent(f.workspace.id, target.id)!
      await call(f.tools, 'agent_configure', { id: target.id, sources: [selectedRef], expectedUpdatedAt: current.updatedAt })
      expect(getAgent(f.workspace.id, target.id)?.sources).toEqual([selectedRef])
      expect(loadSourceConfig(f.workspace.rootPath, source.slug)?.id).toBe(config.id)
      expect(JSON.stringify(read)).not.toContain('private-token-path')
      expect(JSON.stringify(read)).not.toContain('fixture-private-header')
    }
  }
  updateAgent(f.workspace.id, f.agent.id, { sources: [config.id] })
  const skill = await call(f.tools, 'skill_create', { slug: 'source-alias-skill', title: 'Alias skill', description: 'Alias fixture', instructions: 'Alias instructions', requiredSources: [config.id] })
  expect((await call(f.tools, 'skill_get', { slug: skill.slug })).requiredSources).toEqual([config.id])
  const legacy = await makeSource(f, 'Legacy config alias')
  const legacyConfig = loadSourceConfig(f.workspace.rootPath, legacy.slug)!
  legacyConfig.id = 'legacy-source_a1b2'
  saveSourceConfig(f.workspace.rootPath, legacyConfig)
  await syncLocalSource(f.workspace.id, legacy.slug, `user:${f.memberId}`)
  updateAgent(f.workspace.id, f.agent.id, { sources: [legacyConfig.id] })
  const legacyRead = await call(f.tools, 'source_get', { slug: legacyConfig.id })
  expect(legacyRead.id).toBe(legacy.id)
  const current = getAgent(f.workspace.id, target.id)!
  await call(f.tools, 'agent_configure', { id: target.id, sources: [legacyConfig.id], expectedUpdatedAt: current.updatedAt })
  expect(getAgent(f.workspace.id, target.id)?.sources).toEqual([legacyConfig.id])
  expect(loadSourceConfig(f.workspace.rootPath, legacy.slug)?.id).toBe('legacy-source_a1b2')
  updateAgent(f.workspace.id, f.agent.id, { sources: [config.id] })
  saveWorkspaceConfig(f.workspace.rootPath, { id: f.workspace.id, name: f.workspace.name, slug: f.workspace.slug, createdAt: Date.now(), updatedAt: Date.now(), defaults: { enabledSourceSlugs: [source.id, config.id, source.slug, legacy.slug] } })
  await call(f.tools, 'source_delete', { slug: config.id, expectedUpdatedAt: source.updatedAt })
  expect(getSource(f.workspace.id, source.slug)).toBeUndefined()
  expect(loadWorkspaceConfig(f.workspace.rootPath)?.defaults?.enabledSourceSlugs).toEqual([legacy.slug])
  expect(getSource(f.workspace.id, legacy.slug)).toBeDefined()
  const foreignConfig = await createSource(f.foreign.rootPath, { name: 'Foreign alias source', provider: 'custom', type: 'api', api: { baseUrl: 'https://foreign.example.test', authType: 'none' } })
  await syncLocalSource(f.foreign.id, foreignConfig.slug, `user:${f.outsiderId}`)
  const foreignSource = getSource(f.foreign.id, foreignConfig.slug)!
  for (const ref of [foreignSource.id, foreignConfig.id]) {
    await expect(call(f.tools, 'source_get', { slug: ref })).rejects.toThrow('agent scope')
    await expect(call(f.tools, 'source_delete', { slug: ref, expectedUpdatedAt: foreignSource.updatedAt })).rejects.toThrow('agent scope')
  }
  expect(getSource(f.foreign.id, foreignSource.slug)).toEqual(foreignSource)
})

it('creates and updates SKILL.md through canonical bundles, preserves ancillary/private fields and checks post-await versions and identity', async () => {
  const f = fixture()
  const source = await makeSource(f, 'Skill required source')
  const created = await call(f.tools, 'skill_create', { slug: 'created-skill', title: 'Created skill', description: 'UI metadata', instructions: 'UI-visible instructions', requiredSources: [source.slug], alwaysAllow: ['read_only_tool'] })
  expect(created.createdBy).toBe(`user:${f.memberId}`)
  expect(await call(f.tools, 'skill_get', { slug: created.slug })).toMatchObject({ title: 'Created skill', instructions: 'UI-visible instructions', requiredSources: [source.slug], alwaysAllow: ['read_only_tool'] })
  const stored = await makeSkill(f, 'editable-skill')
  const store = getBundleStore(f.workspace.rootPath, f.workspace.id, 'skills')
  const updated = await call(f.tools, 'skill_update', { slug: stored.slug, title: 'Edited skill title', instructions: 'Updated instructions', requiredSources: [source.slug], expectedUpdatedAt: stored.updatedAt })
  expect(updated.updatedAt).toBeGreaterThan(stored.updatedAt)
  expect(new TextDecoder().decode((await store.get(`${stored.slug}/scripts/preserve.ts`))!)).toBe('fixture-private-ancillary-script')
  const raw = new TextDecoder().decode((await store.get(`${stored.slug}/SKILL.md`))!)
  expect(raw).toContain('fixture-private-metadata')
  expect(raw).toContain('requiredSources')
  expect(raw).toContain('Updated instructions')
  const read = await call(f.tools, 'skill_get', { slug: stored.slug })
  expect(read).toMatchObject({ title: 'Edited skill title', instructions: 'Updated instructions' })
  expect(JSON.stringify(read)).not.toContain('fixture-private')
  await expect(call(f.tools, 'skill_update', { slug: stored.slug, title: 'Stale edit', expectedUpdatedAt: stored.updatedAt })).rejects.toThrow('changed')
  const pending = call(f.tools, 'skill_update', { slug: stored.slug, title: 'Identity switched before write', expectedUpdatedAt: updated.updatedAt })
  f.setUserId(f.ownerId)
  await expect(pending).rejects.toThrow('initiating person changed')
  expect(getSkill(f.workspace.id, stored.slug)).toMatchObject({ title: 'Edited skill title', updatedAt: updated.updatedAt })
  const ownerSkill = await makeSkill(f, 'owner-skill-edit', f.ownerId)
  f.setUserId(f.memberId)
  await expect(call(f.tools, 'skill_update', { slug: ownerSkill.slug, title: 'Unauthorized', expectedUpdatedAt: ownerSkill.updatedAt })).rejects.toThrow('creator')
  const foreign = await createSkill({ workspaceId: f.foreign.id, slug: 'foreign-only-skill', createdBy: `user:${f.outsiderId}`, files: new Map([['SKILL.md', new TextEncoder().encode('---\nname: Foreign\ndescription: Foreign\n---\nForeign instructions')]]) })
  await expect(call(f.tools, 'skill_get', { slug: foreign.slug })).rejects.toThrow('agent scope')
})

it('updates only public remote-source metadata/guide and owner-scoped permissions while preserving secure state and ancillary bytes', async () => {
  const f = fixture()
  let source = await makeSource(f, 'Editable remote source')
  const store = getBundleStore(f.workspace.rootPath, f.workspace.id, 'sources')
  const originalConfig = loadSourceConfig(f.workspace.rootPath, source.slug)!
  const frontmatter = '---\ncache:\n  private: fixture-private-guide-cache\n---\n'
  const originalPermissions = { version: '2026-10-08', allowedApiEndpoints: [{ method: 'GET', path: '^/old$' }], allowedBashPatterns: ['fixture-preserved-bash'], allowedWritePaths: ['fixture-preserved-path'], blockedTools: ['fixture-preserved-block'], blockedCommandHints: [{ command: 'fixture', reason: 'Preserved hint' }], privateConfig: { value: 'fixture-private-permission-value' } }
  await store.put(`${source.slug}/guide.md`, new TextEncoder().encode(frontmatter + '# Old public guide'))
  await store.put(`${source.slug}/permissions.json`, new TextEncoder().encode(JSON.stringify(originalPermissions)))
  await store.put(`${source.slug}/scripts/keep.ts`, new TextEncoder().encode('fixture-script-never-executed'))
  await store.put(`${source.slug}/icon.png`, new Uint8Array([1, 3, 5, 7]))
  await syncLocalSource(f.workspace.id, source.slug, `user:${f.memberId}`)
  source = getSource(f.workspace.id, source.slug)!
  await setSourceCredential(f.workspace.id, source.slug, 'source_bearer', { value: 'disposable-update-token' })
  saveWorkspaceConfig(f.workspace.rootPath, { id: f.workspace.id, name: f.workspace.name, slug: f.workspace.slug, createdAt: Date.now(), updatedAt: Date.now(), defaults: { enabledSourceSlugs: [source.slug], defaultLlmConnection: f.connection.slug } })
  const defaults = loadWorkspaceConfig(f.workspace.rootPath)
  const renamed = await call(f.tools, 'source_update', { slug: originalConfig.id, title: ' Updated public title ', tagline: 'Public tagline', guide: '# New public guide\nPublic instructions.', expectedUpdatedAt: source.updatedAt })
  expect(renamed).toMatchObject({ id: source.id, slug: source.slug, title: 'Updated public title', type: 'api', createdBy: `user:${f.memberId}`, authStatus: source.authStatus })
  expect(renamed.updatedAt).toBeGreaterThan(source.updatedAt)
  const metadataConfig = loadSourceConfig(f.workspace.rootPath, source.slug)!
  const beforeSecure = { ...originalConfig, name: undefined, tagline: undefined, updatedAt: undefined }
  const afterSecure = { ...metadataConfig, name: undefined, tagline: undefined, updatedAt: undefined }
  expect(afterSecure).toEqual(beforeSecure)
  expect(metadataConfig.tagline).toBe('Public tagline')
  expect(new TextDecoder().decode((await store.get(`${source.slug}/guide.md`))!)).toBe(frontmatter + '# New public guide\nPublic instructions.')
  expect(new TextDecoder().decode((await store.get(`${source.slug}/scripts/keep.ts`))!)).toBe('fixture-script-never-executed')
  expect(await store.get(`${source.slug}/icon.png`)).toEqual(new Uint8Array([1, 3, 5, 7]))
  expect(getSourceCredential(f.workspace.id, source.slug, 'source_bearer')?.value).toBe('disposable-update-token')
  expect(loadWorkspaceConfig(f.workspace.rootPath)).toEqual(defaults)
  for (const privateText of ['private-token-path', 'fixture-private-header', 'fixture-private-guide-cache', 'fixture-private-permission-value', 'disposable-update-token', 'New public guide', 'Public tagline']) {
    expect(JSON.stringify(renamed)).not.toContain(privateText)
  }
  await expect(call(f.tools, 'source_update', { slug: source.id, permissions: { allowedApiEndpoints: [{ method: 'GET', path: '^/public$' }] }, expectedUpdatedAt: renamed.updatedAt })).rejects.toThrow('workspace owner')
  expect(getSource(f.workspace.id, source.slug)?.updatedAt).toBe(renamed.updatedAt)
  f.setUserId(f.ownerId)
  const cached = permissionsConfigCache.getMergedConfig({ workspaceRootPath: f.workspace.rootPath, activeSourceSlugs: [source.slug] })
  const permitted = await call(f.tools, 'source_update', { slug: source.id, permissions: { allowedApiEndpoints: [{ method: 'GET', path: '^/public$' }] }, expectedUpdatedAt: renamed.updatedAt })
  const permissionFile = JSON.parse(new TextDecoder().decode((await store.get(`${source.slug}/permissions.json`))!))
  expect(permissionFile).toEqual({ ...originalPermissions, allowedApiEndpoints: [{ method: 'GET', path: '^/public$' }] })
  const refreshed = permissionsConfigCache.getMergedConfig({ workspaceRootPath: f.workspace.rootPath, activeSourceSlugs: [source.slug] })
  expect(refreshed).not.toBe(cached)
  expect(refreshed.allowedApiEndpoints.some((rule) => rule.method === 'GET' && rule.pathPattern.source === new RegExp('^/public$').source)).toBe(true)
  const cleared = await call(f.tools, 'source_update', { slug: source.slug, title: null, tagline: '', guide: '', permissions: { allowedApiEndpoints: [] }, expectedUpdatedAt: permitted.updatedAt })
  expect(cleared.title).toBe('Updated public title')
  expect(loadSourceConfig(f.workspace.rootPath, source.slug)?.tagline).toBe('')
  expect(new TextDecoder().decode((await store.get(`${source.slug}/guide.md`))!)).toBe(frontmatter)
  expect(JSON.parse(new TextDecoder().decode((await store.get(`${source.slug}/permissions.json`))!)).allowedApiEndpoints).toEqual([])
})

it('refuses source update credential/origin/host fields, unsafe permission scope, unsupported records and stale or foreign versions', async () => {
  const f = fixture()
  const source = await makeSource(f, 'Source update boundary')
  const snapshot = loadSourceConfig(f.workspace.rootPath, source.slug)
  for (const extra of [{ url: 'https://other.example.test' }, { api: { baseUrl: 'https://other.example.test' } }, { auth: 'insecure' }, { credential: 'insecure' }, { enabled: false }, { provider: 'other' }, { type: 'local' }, { id: crypto.randomUUID() }, { icon: 'https://other.example.test/icon' }, { rootPath: '/Users/jg' }, { files: [] }, { workspaceId: f.foreign.id }]) {
    await expect(call(f.tools, 'source_update', { slug: source.slug, title: 'Rejected update', expectedUpdatedAt: source.updatedAt, ...extra })).rejects.toThrow()
  }
  for (const permissions of [
    { allowedBashPatterns: ['.*'] }, { allowedWritePaths: ['/**'] }, { blockedCommandHints: [] }, { blockedTools: [] },
    { allowedMcpPatterns: ['get|mcp__other__send'] }, { allowedMcpPatterns: ['.*'] }, { allowedMcpPatterns: ['mcp__other__send'] },
    { allowedApiEndpoints: [{ method: 'GET', path: 'https://other.example.test/private' }] },
    { allowedApiEndpoints: [{ method: 'GET', path: '^https?:\\/\\/other.example.test/private' }] },
    { allowedApiEndpoints: [{ method: 'GET', path: '^//other.example.test/private' }] },
    { allowedApiEndpoints: [{ method: 'GET', path: 'file:///Users/jg/private' }] },
    { allowedApiEndpoints: [{ method: 'GET', path: '[' }] },
    { allowedApiEndpoints: [{ method: 'GET', path: '^/public$', headers: { Authorization: 'insecure' } }] },
  ]) await expect(call(f.tools, 'source_update', { slug: source.slug, permissions, expectedUpdatedAt: source.updatedAt })).rejects.toThrow()
  await expect(call(f.tools, 'source_update', { slug: source.slug, guide: '---\ncache:\n  secret: replaced\n---\nBody', expectedUpdatedAt: source.updatedAt })).rejects.toThrow('public guide body')
  await expect(call(f.tools, 'source_update', { slug: source.slug, title: null, guide: null, tagline: null, permissions: null, expectedUpdatedAt: source.updatedAt })).rejects.toThrow('field to update')
  await expect(call(f.tools, 'source_update', { slug: source.slug, title: 'Stale', expectedUpdatedAt: source.updatedAt + 1 })).rejects.toThrow('changed')
  const owned = await makeSource(f, 'Other human owned source', 'api', f.ownerId)
  await expect(call(f.tools, 'source_update', { slug: owned.slug, title: 'No authority', expectedUpdatedAt: owned.updatedAt })).rejects.toThrow('creator')
  const local = await makeSource(f, 'Stored unsupported local update', 'local'), stdio = await makeSource(f, 'Stored unsupported stdio update', 'mcp')
  for (const stored of [local, stdio]) await expect(call(f.tools, 'source_update', { slug: stored.slug, title: 'Never convert', expectedUpdatedAt: stored.updatedAt })).rejects.toThrow('Only existing remote')
  expect(loadSourceConfig(f.workspace.rootPath, source.slug)).toEqual(snapshot)
  expect(getSource(f.workspace.id, source.slug)).toEqual(source)
  await expect(updateSource(f.workspace.id, source.slug, { title: 'Direct insecure patch', api: {} } as never, source.updatedAt, { userId: f.memberId, authorize: () => {} })).rejects.toThrow()
  await expect(updateSource(f.workspace.id, source.slug, { title: 'No member fallback' }, source.updatedAt, { userId: f.outsiderId, authorize: () => {} })).rejects.toThrow('workspace member')
  f.setUserId(f.ownerId)
  await expect(call(f.tools, 'source_update', { slug: source.slug, permissions: { allowedMcpPatterns: ['get'] }, expectedUpdatedAt: source.updatedAt })).rejects.toThrow('API sources')
  const foreign = await createSource(f.foreign.rootPath, { name: 'Foreign source update', provider: 'custom', type: 'api', api: { baseUrl: 'https://foreign.example.test', authType: 'none' } })
  await syncLocalSource(f.foreign.id, foreign.slug, `user:${f.outsiderId}`)
  await expect(call(f.tools, 'source_update', { slug: foreign.id, title: 'No foreign edit', expectedUpdatedAt: source.updatedAt })).rejects.toThrow('agent scope')
})

it('keeps source_update row/files unchanged when human, capability or owner authority changes during asynchronous reads', async () => {
  const f = fixture()
  const source = await makeSource(f, 'Queued source update'), allowed = await makeSource(f, 'Other source update capability')
  const originalConfig = loadSourceConfig(f.workspace.rootPath, source.slug)
  const switched = call(f.tools, 'source_update', { slug: source.slug, title: 'Must not commit', expectedUpdatedAt: source.updatedAt })
  f.setUserId(f.ownerId)
  await expect(switched).rejects.toThrow('initiating person changed')
  expect(getSource(f.workspace.id, source.slug)).toEqual(source)
  expect(loadSourceConfig(f.workspace.rootPath, source.slug)).toEqual(originalConfig)
  f.setUserId(f.memberId)
  const restricted = call(f.tools, 'source_update', { slug: source.slug, guide: 'Must not replace guide', expectedUpdatedAt: source.updatedAt })
  updateAgent(f.workspace.id, f.agent.id, { sources: [allowed.id] })
  await expect(restricted).rejects.toThrow('agent scope')
  expect(getSource(f.workspace.id, source.slug)).toEqual(source)
  updateAgent(f.workspace.id, f.agent.id, { sources: [] })
  updateWorkspaceMemberRole(f.workspace.id, f.memberId, 'owner')
  f.setUserId(f.ownerId)
  const lostOwner = call(f.tools, 'source_update', { slug: source.slug, permissions: { allowedApiEndpoints: [{ method: 'GET', path: '^/private$' }] }, expectedUpdatedAt: source.updatedAt })
  updateWorkspaceMemberRole(f.workspace.id, f.ownerId, 'member')
  await expect(lostOwner).rejects.toThrow('creator')
  expect(getSource(f.workspace.id, source.slug)).toEqual(source)
  expect(loadSourceConfig(f.workspace.rootPath, source.slug)).toEqual(originalConfig)
  updateWorkspaceMemberRole(f.workspace.id, f.ownerId, 'owner')
  f.setUserId(f.memberId)
  const creatorOwner = call(f.tools, 'source_update', { slug: source.slug, permissions: { allowedApiEndpoints: [{ method: 'GET', path: '^/creator$' }] }, expectedUpdatedAt: source.updatedAt })
  updateWorkspaceMemberRole(f.workspace.id, f.memberId, 'member')
  await expect(creatorOwner).rejects.toThrow('workspace owner')
  expect(getSource(f.workspace.id, source.slug)).toEqual(source)
  const removed = call(f.tools, 'source_update', { slug: source.slug, title: 'No revoked-member write', expectedUpdatedAt: source.updatedAt })
  deleteWorkspaceMember(f.workspace.id, f.memberId)
  await expect(removed).rejects.toThrow('workspace member')
  expect(getSource(f.workspace.id, source.slug)).toEqual(source)
})

it('applies only source-scoped literal MCP rules and refuses API or regex-prefix escape fields on a remote MCP source', async () => {
  const f = fixture()
  const created = await call(f.tools, 'source_create', { title: 'Remote MCP permission fixture', type: 'mcp', url: 'https://mcp.example.test/server' })
  f.setUserId(f.ownerId)
  const updated = await call(f.tools, 'source_update', { slug: created.id, permissions: { allowedMcpPatterns: [{ pattern: 'get_item', comment: 'Public read action' }] }, expectedUpdatedAt: created.updatedAt })
  const merged = permissionsConfigCache.getMergedConfig({ workspaceRootPath: f.workspace.rootPath, activeSourceSlugs: [created.slug] })
  expect(merged.readOnlyMcpPatterns.some((pattern) => pattern.test(`mcp__${created.slug}__get_item`) && !pattern.test('mcp__other__get_item'))).toBe(true)
  expect(merged.readOnlyMcpPatterns.some((pattern) => pattern.test(`mcp__other__mcp__${created.slug}__get_item`))).toBe(false)
  await expect(call(f.tools, 'source_update', { slug: created.id, permissions: { allowedApiEndpoints: [{ method: 'GET', path: '^/public$' }] }, expectedUpdatedAt: updated.updatedAt })).rejects.toThrow('MCP sources')
  for (const escape of ['get|mcp__other__send', '(?:get)|.*', 'mcp__other__send', '.*']) await expect(call(f.tools, 'source_update', { slug: created.id, permissions: { allowedMcpPatterns: [escape] }, expectedUpdatedAt: updated.updatedAt })).rejects.toThrow()
  expect(getSource(f.workspace.id, created.slug)).toEqual(updated)
})

it('preserves literal private guide Cache metadata on body edits without accepting model-authored cache replacement', async () => {
  const f = fixture()
  const source = await makeSource(f, 'Private cached guide update')
  const store = getBundleStore(f.workspace.rootPath, f.workspace.id, 'sources')
  const cache = '## Cache\n```json\n{"private":"fictional-preserved-cache-sentinel"}\n```\n'
  await store.put(`${source.slug}/guide.md`, new TextEncoder().encode('# Original public guide\n\n' + cache + '\n## Guidelines\nOriginal public instruction.'))
  await syncLocalSource(f.workspace.id, source.slug, `user:${f.memberId}`)
  const before = getSource(f.workspace.id, source.slug)!
  const updated = await call(f.tools, 'source_update', { slug: source.id, guide: '# Replacement public guide\nPublic instruction retained.', expectedUpdatedAt: before.updatedAt })
  const raw = new TextDecoder().decode((await store.get(`${source.slug}/guide.md`))!)
  expect(raw).toContain(cache)
  expect(raw).toContain('Public instruction retained.')
  expect(loadSourceGuide(f.workspace.rootPath, source.slug)?.cache).toEqual({ private: 'fictional-preserved-cache-sentinel' })
  expect(JSON.stringify(updated)).not.toContain('fictional-preserved-cache-sentinel')
  await expect(call(f.tools, 'source_update', { slug: source.id, guide: '# Public\n\n## Cache\n```json\n{"private":"replacement"}\n```', expectedUpdatedAt: updated.updatedAt })).rejects.toThrow('public guide body')
})

it('rejects source_update at the real bundle queue before a row/file effect, including unindexed secure-form changes', async () => {
  for (const changed of ['human', 'secure-config'] as const) {
    const f = fixture()
    const dir = join(f.workspace.rootPath, 'sources')
    const disk = createDiskFileStore(dir, { paths: true })
    let entered!: () => void, release!: () => void, readComplete!: () => void
    const enteredQueue = new Promise<void>((resolve) => { entered = resolve })
    const resumeQueue = new Promise<void>((resolve) => { release = resolve })
    const finishedReads = new Promise<void>((resolve) => { readComplete = resolve })
    let blockList = true
    const store = { ...disk, list: async (prefix?: string) => { if (blockList) { blockList = false; entered(); await resumeQueue }; return disk.list(prefix) } }
    const domain = createSourcesStore(initDb(), initSecretsStore(), () => ({ store, dir, remote: false }))
    const slug = 'guarded-source-update'
    const config = { id: crypto.randomUUID(), slug, name: 'Initial source title', enabled: false, provider: 'custom', type: 'api', api: { baseUrl: 'https://remote.example.test/v1', authType: 'none' } }
    const files = new Map([
      ['config.json', new TextEncoder().encode(JSON.stringify(config))],
      ['guide.md', new TextEncoder().encode('# Initial guide')],
    ])
    const holding = domain.createSourceBundle({ workspaceId: f.workspace.id, slug, files, createdBy: `user:${f.memberId}` })
    await enteredQueue
    const before = domain.getSource(f.workspace.id, slug)!
    let checks = 0
    const pending = domain.updateSource(f.workspace.id, slug, { title: 'Denied queued title' }, before.updatedAt, { userId: f.memberId, authorize: () => {
      if (f.scope.getUserId() !== f.memberId) throw new Error('Immutable human changed during queued source update')
      if (++checks === files.size + 2) readComplete()
    } })
    const denied = rejection(pending)
    await finishedReads
    expect(domain.getSource(f.workspace.id, slug)).toEqual(before)
    if (changed === 'human') f.setUserId(f.ownerId)
    else await disk.put(`${slug}/config.json`, new TextEncoder().encode(JSON.stringify({ ...config, api: { ...config.api, baseUrl: 'https://changed-secure-form.example.test/v2' } })))
    const expectedConfig = await disk.get(`${slug}/config.json`)
    release()
    await holding
    const error = await denied
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain(changed === 'human' ? 'Immutable human changed' : 'secure source configuration changed')
    expect(domain.getSource(f.workspace.id, slug)).toEqual(before)
    expect(await disk.get(`${slug}/config.json`)).toEqual(expectedConfig)
    expect(new TextDecoder().decode((await disk.get(`${slug}/guide.md`))!)).toBe('# Initial guide')
  }
})

it('treats only advertised optional provider null as omission while preserving meaningful agent model/connection nulls', async () => {
  const f = fixture()
  const created = await call(f.tools, 'agent_create', { title: 'Provider omission fixture', provider: 'openai', model: 'fixture-next', llmConnectionId: f.connection.id })
  const omitted = await call(f.tools, 'agent_configure', { id: created.id, provider: null, model: null, expectedUpdatedAt: created.updatedAt })
  expect(omitted).toMatchObject({ provider: 'openai', model: null, llmConnectionId: f.connection.id })
  const cleared = await call(f.tools, 'agent_configure', { id: created.id, provider: null, llmConnectionId: null, expectedUpdatedAt: omitted.updatedAt })
  expect(cleared.llmConnectionId).toBe(f.connection.id)
  expect((f.tools.agent_configure.inputSchema as z.ZodType).safeParse({ id: created.id, provider: null, expectedUpdatedAt: cleared.updatedAt }).success).toBe(false)
  expect(MANAGEMENT_WRITE_TOOL_NAMES.has('source_update')).toBe(true)
  expect(MANAGEMENT_SENSITIVE_TOOL_NAMES.has('source_update')).toBe(true)
  expect(SourceUpdateSchema.safeParse({ title: null, guide: '' }).success).toBe(true)
})

it('requires creator/owner rights and versions for bundle deletion and rechecks the human after awaits', async () => {
  const f = fixture()
  const skill = await makeSkill(f, 'owned-skill', f.ownerId), source = await makeSource(f, 'Owner source', 'api', f.ownerId)
  await expect(call(f.tools, 'skill_delete', { slug: skill.slug, expectedUpdatedAt: skill.updatedAt })).rejects.toThrow('creator')
  await expect(call(f.tools, 'source_delete', { slug: source.slug, expectedUpdatedAt: source.updatedAt })).rejects.toThrow('creator')
  f.setUserId(f.ownerId)
  await expect(call(f.tools, 'skill_delete', { slug: skill.slug, expectedUpdatedAt: skill.updatedAt + 1 })).rejects.toThrow('changed')
  await expect(call(f.tools, 'source_delete', { slug: source.slug, expectedUpdatedAt: source.updatedAt + 1 })).rejects.toThrow('changed')
  await call(f.tools, 'skill_delete', { slug: skill.slug, expectedUpdatedAt: skill.updatedAt })
  expect(getSkill(f.workspace.id, skill.slug)).toBeUndefined()
  const selected = await makeSource(f, 'Default source cleanup', 'api', f.ownerId)
  saveWorkspaceConfig(f.workspace.rootPath, { id: f.workspace.id, name: f.workspace.name, slug: f.workspace.slug, createdAt: Date.now(), updatedAt: Date.now(), defaults: { enabledSourceSlugs: [source.slug, selected.slug] } })
  await call(f.tools, 'source_delete', { slug: selected.slug, expectedUpdatedAt: selected.updatedAt })
  expect(loadWorkspaceConfig(f.workspace.rootPath)?.defaults?.enabledSourceSlugs).toEqual([source.slug])
  const pending = call(f.tools, 'source_delete', { slug: source.slug, expectedUpdatedAt: source.updatedAt })
  f.setUserId(f.memberId)
  await expect(pending).rejects.toThrow('initiating person changed')
  expect(getSource(f.workspace.id, source.slug)).toEqual(source)
  expect(loadSourceConfig(f.workspace.rootPath, source.slug)).not.toBeNull()
  expect(loadWorkspaceConfig(f.workspace.rootPath)?.defaults?.enabledSourceSlugs).toEqual([source.slug])
})

it('rejects revoked skill/source creation before rows or physical folders exist, including an absent human or removed named agent', async () => {
  const f = fixture()
  const source = call(f.tools, 'source_create', { title: 'Denied source draft', type: 'api', url: 'https://remote.example.test/v1' })
  const skill = call(f.tools, 'skill_create', { slug: 'denied-skill-draft', title: 'Denied skill', description: 'Denied fixture', instructions: 'Must never be written' })
  const denials = Promise.all([rejection(source), rejection(skill)])
  f.setUserId(f.ownerId)
  for (const error of await denials) {
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain('initiating person changed')
  }
  expect(getSource(f.workspace.id, 'denied-source-draft')).toBeUndefined()
  expect(getSkill(f.workspace.id, 'denied-skill-draft')).toBeUndefined()
  expect(existsSync(join(f.workspace.rootPath, 'sources', 'denied-source-draft'))).toBe(false)
  expect(existsSync(join(f.workspace.rootPath, 'skills', 'denied-skill-draft'))).toBe(false)
  f.setUserId(f.memberId)
  const deniedMember = call(f.tools, 'source_create', { title: 'Denied membership draft', type: 'mcp', url: 'https://remote.example.test/mcp' })
  deleteWorkspaceMember(f.workspace.id, f.memberId)
  await expect(deniedMember).rejects.toThrow('initiating person')
  expect(existsSync(join(f.workspace.rootPath, 'sources', 'denied-membership-draft'))).toBe(false)
  createWorkspaceMember(f.workspace.id, f.memberId, 'member')
  const executionAgent = createAgent({ workspaceId: f.workspace.id, title: 'Removable named agent', provider: 'openai', createdBy: `user:${f.memberId}` })
  const tools = createMastraManagementTools({ ...f.scope, agentId: executionAgent.id })
  const deniedAgent = call(tools, 'source_create', { title: 'Denied agent draft', type: 'api', url: 'https://remote.example.test/v1' })
  deleteAgent(f.workspace.id, executionAgent.id)
  await expect(deniedAgent).rejects.toThrow('named agent')
  expect(existsSync(join(f.workspace.rootPath, 'sources', 'denied-agent-draft'))).toBe(false)
})

it('authorizes source and skill create/update/delete after a real blocked bundle queue, before any denied row or file effect', async () => {
  const f = fixture()
  for (const kind of ['skills', 'sources'] as const) {
    const dir = join(f.workspace.rootPath, `${kind}-guarded-queue`)
    const disk = createDiskFileStore(dir, { paths: true })
    let begin!: () => void, release!: () => void
    let blocked = false
    const entered = new Promise<void>((resolve) => { begin = resolve })
    const resume = new Promise<void>((resolve) => { release = resolve })
    const store = {
      ...disk,
      put: async (key: string, bytes: Uint8Array) => {
        if (blocked) { blocked = false; begin(); await resume }
        await disk.put(key, bytes)
      },
    }
    const domain = kind === 'skills'
      ? createSkillsStore(initDb(), () => ({ store, dir, remote: false }))
      : createSourcesStore(initDb(), initSecretsStore(), () => ({ store, dir, remote: false }))
    const create = 'createSkill' in domain ? domain.createSkill : domain.createSourceBundle
    const update = 'updateBundle' in domain ? domain.updateBundle : undefined
    const remove = 'deleteSkill' in domain ? domain.deleteSkill : domain.deleteSource
    const get = 'getSkill' in domain ? domain.getSkill : domain.getSource
    const slug = `guarded-${kind}`
    const main = kind === 'skills' ? 'SKILL.md' : 'config.json'
    const files = (title: string) => new Map([[main, new TextEncoder().encode(kind === 'skills'
      ? `---\nname: ${title}\ndescription: Guard fixture\n---\nInstructions`
      : JSON.stringify({ id: crypto.randomUUID(), name: title, slug, enabled: false, type: 'api', provider: 'custom', api: { baseUrl: 'https://remote.example.test', authType: 'none' } }))]])
    let guardChecks = 0, authorized = true
    const guard = () => { guardChecks++; if (!authorized) throw new Error('Queue authorization revoked') }
    blocked = true
    const holding = create({ workspaceId: f.workspace.id, slug, files: files('Authorized holding creation'), createdBy: `user:${f.memberId}` })
    await entered
    const created = get(f.workspace.id, slug)!
    const queuedDelete = remove(f.workspace.id, slug, guard)
    const queuedCreate = create({ workspaceId: f.workspace.id, slug, files: files('Denied creation'), createdBy: `user:${f.memberId}` }, guard)
    const queuedUpdate = update?.(f.workspace.id, slug, files('Denied update'), created.updatedAt, guard)
    const denials = Promise.all([rejection(queuedDelete), rejection(queuedCreate), ...(queuedUpdate ? [rejection(queuedUpdate)] : [])])
    expect(guardChecks).toBe(0)
    authorized = false
    release()
    await holding
    const afterHolding = get(f.workspace.id, slug)
    const afterFiles = await disk.list(`${slug}/`)
    const afterBytes = await disk.get(`${slug}/${main}`)
    for (const error of await denials) {
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toContain('Queue authorization revoked')
    }
    expect(guardChecks).toBe(kind === 'skills' ? 3 : 2)
    expect(get(f.workspace.id, slug)).toEqual(afterHolding)
    expect(await disk.list(`${slug}/`)).toEqual(afterFiles)
    expect(await disk.get(`${slug}/${main}`)).toEqual(afterBytes)
    if (update) {
      const expectedUpdatedAt = afterHolding!.updatedAt
      const changed = update(f.workspace.id, slug, files('Committed newer version'), expectedUpdatedAt)
      const staleDelete = remove(f.workspace.id, slug, () => {
        if (get(f.workspace.id, slug)?.updatedAt !== expectedUpdatedAt) throw new Error('Queued configuration changed')
      })
      const staleDenied = rejection(staleDelete)
      await changed
      expect(await staleDenied).toBeInstanceOf(Error)
      expect(((await staleDenied) as Error).message).toContain('Queued configuration changed')
      expect(get(f.workspace.id, slug)?.title).toBe('Committed newer version')
      expect(await disk.get(`${slug}/${main}`)).toBeDefined()
    }
  }
})

it('rechecks creator/owner authority and capability limits at the native queued mutation boundary', async () => {
  const f = fixture()
  const source = await makeSource(f, 'Capability deletion guard'), otherSource = await makeSource(f, 'Other allowed source')
  const skill = await makeSkill(f, 'capability-deletion-guard'), otherSkill = await makeSkill(f, 'other-allowed-skill')
  const sourceDelete = call(f.tools, 'source_delete', { slug: source.slug, expectedUpdatedAt: source.updatedAt })
  const skillDelete = call(f.tools, 'skill_delete', { slug: skill.slug, expectedUpdatedAt: skill.updatedAt })
  const denials = Promise.all([rejection(sourceDelete), rejection(skillDelete)])
  updateAgent(f.workspace.id, f.agent.id, { sources: [otherSource.slug], skills: [otherSkill.slug] })
  for (const error of await denials) {
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain('agent scope')
  }
  expect(getSource(f.workspace.id, source.slug)).toEqual(source)
  expect(getSkill(f.workspace.id, skill.slug)).toEqual(skill)
  expect(existsSync(join(f.workspace.rootPath, 'sources', source.slug, 'config.json'))).toBe(true)
  expect(existsSync(join(f.workspace.rootPath, 'skills', skill.slug, 'SKILL.md'))).toBe(true)
  updateAgent(f.workspace.id, f.agent.id, { sources: [], skills: [] })
  f.setUserId(f.ownerId)
  updateWorkspaceMemberRole(f.workspace.id, f.memberId, 'owner')
  const roleDelete = call(f.tools, 'source_delete', { slug: source.slug, expectedUpdatedAt: source.updatedAt })
  const roleDenied = rejection(roleDelete)
  updateWorkspaceMemberRole(f.workspace.id, f.ownerId, 'member')
  expect(await roleDenied).toBeInstanceOf(Error)
  expect(((await roleDenied) as Error).message).toContain('creator')
  expect(getSource(f.workspace.id, source.slug)).toEqual(source)
  expect(existsSync(join(f.workspace.rootPath, 'sources', source.slug, 'config.json'))).toBe(true)
})

it('creates routines paused, preserves pause state on updates, validates revisions and runs as the exact human through the callback', async () => {
  const f = fixture()
  const created = await call(f.tools, 'routine_create', { title: 'Drafted routine', config: f.config })
  expect(created).toMatchObject({ agentId: f.agent.id, createdBy: `user:${f.memberId}`, config: f.config })
  expect(created.pausedAt).not.toBeNull()
  expect(f.runs).toEqual([])
  expect(getRoutine(f.workspace.id, created.id)?.pausedAt).not.toBeNull()
  const renamed = await call(f.tools, 'routine_update', { id: created.id, title: 'Edited paused draft', expectedVersion: created.version })
  expect(renamed.pausedAt).toBe(created.pausedAt)
  await expect(call(f.tools, 'routine_set_paused', { id: created.id, paused: false, expectedVersion: created.version })).rejects.toThrow('changed')
  const activated = await call(f.tools, 'routine_set_paused', { id: created.id, paused: false, expectedVersion: renamed.version })
  expect(activated.pausedAt).toBeNull()
  expect(f.runs).toEqual([])
  const edited = await call(f.tools, 'routine_update', { id: created.id, title: 'Edited active routine', expectedVersion: activated.version })
  expect(edited.pausedAt).toBeNull()
  f.setUserId(f.ownerId)
  const run = await call(f.tools, 'routine_run', { id: created.id, expectedVersion: edited.version })
  expect(f.runs).toEqual([{ id: created.id, userId: f.ownerId }])
  expect(run).toEqual({ id: expect.any(String), status: 'running' })
  expect(getRoutine(f.workspace.id, created.id)?.createdBy).toBe(`user:${f.memberId}`)
  const paused = await call(f.tools, 'routine_set_paused', { id: created.id, paused: true, expectedVersion: edited.version })
  expect(paused.createdBy).toBe(`user:${f.ownerId}`)
  expect(paused.pausedAt).not.toBeNull()
  f.setUserId(f.memberId)
  await expect(call(f.tools, 'routine_delete', { id: created.id, expectedVersion: paused.version })).rejects.toThrow('creator')
})

it('never accepts script/webhook/credential overrides, never executes unsupported stored routines and hides secrets and inaccessible chats', async () => {
  const f = fixture()
  for (const config of [
    { ...f.config, actions: [{ type: 'script', script: 'fixture-never-execute' }] },
    { ...f.config, actions: [{ type: 'webhook', url: 'https://example.test/private-secret' }] },
    { ...f.config, actions: [{ type: 'prompt', prompt: 'No override', llmConnection: 'other-human' }] },
    { ...f.config, webhook: { secretId: 'private-secret' } },
    { ...f.config, permissionMode: 'allow-all' },
  ]) await expect(call(f.tools, 'routine_create', { title: 'Invalid draft', config })).rejects.toThrow()
  const foreign = createRoutine({ workspaceId: f.foreign.id, title: 'Foreign routine', config: f.config, createdBy: `user:${f.outsiderId}`, paused: true })
  await expect(call(f.tools, 'routine_get', { id: foreign.id })).rejects.toThrow('not found')
  const stored = createRoutine({ workspaceId: f.workspace.id, title: 'Stored webhook action', config: { ...f.config, actions: [{ type: 'webhook', url: 'https://external.example.test/private-secret-url', secretId: 'private-secret-reference' }] }, createdBy: `user:${f.memberId}`, paused: true })
  const read = await call(f.tools, 'routine_get', { id: stored.id })
  expect(read.editable).toBe(false)
  expect(JSON.stringify(read)).not.toContain('private-secret')
  await expect(call(f.tools, 'routine_run', { id: stored.id, expectedVersion: read.version })).rejects.toThrow('cannot run')
  await expect(call(f.tools, 'routine_set_paused', { id: stored.id, paused: false, expectedVersion: read.version })).rejects.toThrow('cannot be activated')
  await expect(call(f.tools, 'routine_update', { id: stored.id, config: f.config, expectedVersion: read.version })).rejects.toThrow('unsupported stored')
  await expect(call(f.tools, 'routine_update', { id: stored.id, title: 'No implicit ownership/effect change', expectedVersion: read.version })).rejects.toThrow('unsupported stored')
  expect(getRoutine(f.workspace.id, stored.id)?.config.actions).toEqual(stored.config.actions)
  expect(f.runs).toEqual([])
  const oldScript = createRoutine({ workspaceId: f.workspace.id, title: 'Stored script action', config: { ...f.config, actions: [{ type: 'script', script: 'fixture-never-execute' }] }, createdBy: `user:${f.memberId}`, paused: true })
  const scriptRead = await call(f.tools, 'routine_get', { id: oldScript.id })
  await expect(call(f.tools, 'routine_run', { id: oldScript.id, expectedVersion: scriptRead.version })).rejects.toThrow('cannot run')
  expect(JSON.stringify(scriptRead)).not.toContain('fixture-never-execute')
  const safe = createRoutine({ workspaceId: f.workspace.id, title: 'Safe stored', config: f.config, createdBy: `user:${f.memberId}`, paused: true })
  const run = startRoutineRun({ ...safe, workspaceId: f.workspace.id }, Date.now())!
  const { updateRoutineRun } = await import('@otto/shared/automations/routines')
  updateRoutineRun(run.id, { status: 'error', chatId: 'private-chat', error: 'private-secret-error' })
  expect((await call(f.tools, 'routine_get', { id: safe.id })).runs).toEqual([])
  f.chats.add('private-chat')
  const accessible = await call(f.tools, 'routine_get', { id: safe.id })
  expect(accessible.runs).toHaveLength(1)
  expect(JSON.stringify(accessible)).not.toContain('private-secret-error')
})

it('refuses missing runner and checks identity and access after awaited callbacks', async () => {
  const f = fixture()
  const routine = createRoutine({ workspaceId: f.workspace.id, title: 'Callback fixture', config: f.config, createdBy: `user:${f.memberId}`, paused: true })
  const read = await call(f.tools, 'routine_get', { id: routine.id })
  const missing = createMastraManagementTools({ ...f.scope, runRoutine: undefined })
  await expect(call(missing, 'routine_run', { id: routine.id, expectedVersion: read.version })).rejects.toThrow('runner is unavailable')
  const pending = call(f.tools, 'routine_run', { id: routine.id, expectedVersion: read.version })
  f.setUserId(f.ownerId)
  await expect(pending).rejects.toThrow('initiating person changed')
  f.setUserId(f.memberId)
  const revoked = call(f.tools, 'routine_run', { id: routine.id, expectedVersion: read.version })
  f.setAccess(false)
  await expect(revoked).rejects.toThrow('Access removed')
})

it('keeps statuses and labels owner-only, checks configuration revisions and preserves fixed/default constraints', async () => {
  const f = fixture()
  const statusRead = await call(f.tools, 'status_list', {}), labelRead = await call(f.tools, 'label_list', {})
  await expect(call(f.tools, 'status_create', { label: 'Custom', category: 'open', expectedVersion: statusRead.version })).rejects.toThrow('workspace owner')
  await expect(call(f.tools, 'label_create', { name: 'Custom', expectedVersion: labelRead.version })).rejects.toThrow('workspace owner')
  f.setUserId(f.ownerId)
  const status = await call(f.tools, 'status_create', { label: 'Custom', category: 'open', expectedVersion: statusRead.version })
  await expect(call(f.tools, 'status_create', { label: 'Stale custom', category: 'closed', expectedVersion: statusRead.version })).rejects.toThrow('changed')
  const statusUpdated = await call(f.tools, 'status_update', { id: status.status.id, label: 'Renamed', category: 'closed', expectedVersion: status.version })
  const statusDefault = await call(f.tools, 'status_set_default', { id: status.status.id, expectedVersion: statusUpdated.version })
  await expect(call(f.tools, 'status_delete', { id: status.status.id, expectedVersion: statusDefault.version })).rejects.toThrow('default')
  await expect(call(f.tools, 'status_delete', { id: 'todo', expectedVersion: statusDefault.version })).rejects.toThrow()
  await expect(call(f.tools, 'status_update', { id: 'todo', category: 'closed', expectedVersion: statusDefault.version })).rejects.toThrow('category of fixed status')
  const reordered = await call(f.tools, 'status_reorder', { ids: [status.status.id, 'todo'], expectedVersion: statusDefault.version })
  expect(reordered.statuses[0].id).toBe(status.status.id)
  const label = await call(f.tools, 'label_create', { name: 'Parent', valueType: 'string', expectedVersion: labelRead.version })
  const child = await call(f.tools, 'label_create', { name: 'Child', parentId: label.label.id, expectedVersion: label.version })
  await expect(call(f.tools, 'label_update', { id: label.label.id, name: 'Stale overwrite', expectedVersion: label.version })).rejects.toThrow('changed')
  const updated = await call(f.tools, 'label_update', { id: child.label.id, name: 'Renamed child', autoRules: [{ pattern: 'fixture', flags: 'i' }], expectedVersion: child.version })
  const moved = await call(f.tools, 'label_move', { id: child.label.id, parentId: null, expectedVersion: updated.version })
  const ordered = await call(f.tools, 'label_reorder', { ids: [child.label.id, label.label.id], parentId: null, expectedVersion: moved.version })
  expect(ordered.labels[0].id).toBe(child.label.id)
  const removed = await call(f.tools, 'label_delete', { id: child.label.id, expectedVersion: ordered.version })
  expect(removed.labels.map((value: { id: string }) => value.id)).not.toContain(child.label.id)
  createStatus(f.foreign.id, { label: 'Foreign status', category: 'open' })
  const foreignLabel = createLabel(f.foreign.id, { name: 'Foreign only label' })
  await expect(call(f.tools, 'label_update', { id: foreignLabel.id, name: 'Not visible', expectedVersion: removed.version })).rejects.toThrow('not found')
})
