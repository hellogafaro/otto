import { createHash } from 'node:crypto'
import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { isMap, parseDocument, stringify } from 'yaml'
import { userActor } from '@otto/shared/actors'
import { canEditAgent, createAgent, deleteAgent, getAgent, getAgents, MAX_INSTRUCTIONS, MAX_LIST, MAX_TITLE, updateAgent } from '@otto/shared/agents'
import { canEditRoutine, createRoutine, deleteRoutine, getRoutine, getRoutines, updateRoutine } from '@otto/shared/automations/routines'
import { MAX_ROUTINE_ACTIONS, MAX_ROUTINE_TITLE, type Routine } from '@otto/shared/automations/routine-types'
import { dropWebhookSecret } from '@otto/shared/automations/routine-webhook'
import { getConnectionById, getVisibleConnections, type Connection } from '@otto/shared/connections'
import type { EntityColor } from '@otto/shared/colors'
import { getWorkspaceByNameOrId } from '@otto/shared/config'
import { createLabel, deleteLabel, moveLabel, reorderLabels, updateLabel } from '@otto/shared/labels/crud'
import { getLabels } from '@otto/shared/labels/storage'
import { getBundleStore } from '@otto/shared/library'
import { createSkill, deleteSkill, getSkill, getSkills, parseSkillFile, updateBundle, type BundleFiles } from '@otto/shared/skills'
import { createSource, deleteSource, getLoadedSources, getSources, SourceUpdateSchema, updateSource } from '@otto/shared/sources'
import { createStatus, deleteStatus, getStatuses, reorderStatuses, setDefaultStatus, updateStatus } from '@otto/shared/statuses'
import { domainError } from '@otto/shared/utils'
import { getMemberRole, isWorkspaceMember, loadWorkspaceConfig, saveWorkspaceConfig } from '@otto/shared/workspaces'

export const MANAGEMENT_READ_TOOL_NAMES = new Set([
  'agent_list', 'agent_get', 'agent_connections', 'routine_list', 'routine_get', 'skill_list', 'skill_get', 'source_list', 'source_get', 'status_list', 'label_list',
])
export const MANAGEMENT_WRITE_TOOL_NAMES = new Set([
  'agent_create', 'agent_update', 'agent_configure', 'agent_delete', 'routine_create', 'routine_update', 'routine_set_paused', 'routine_delete', 'routine_run',
  'skill_create', 'skill_update', 'skill_delete', 'source_create', 'source_update', 'source_delete', 'status_create', 'status_update', 'status_delete', 'status_reorder', 'status_set_default',
  'label_create', 'label_update', 'label_delete', 'label_move', 'label_reorder',
])
export const MANAGEMENT_DESTRUCTIVE_TOOL_NAMES = new Set(['agent_delete', 'routine_delete', 'skill_delete', 'source_delete', 'status_delete', 'label_delete'])
export const MANAGEMENT_SENSITIVE_TOOL_NAMES = new Set([
  ...MANAGEMENT_WRITE_TOOL_NAMES,
])
export const MANAGEMENT_NOTIFICATION_TOOL_NAMES = new Set(['routine_run', 'agent_delete', 'status_delete', 'label_delete'])
export const MANAGEMENT_COVERAGE_GAPS = [
  'Native registration, approval (including Allow-all), effective-actor binding and domain-change publication are supplied by SessionManager, not this factory.',
  'routine_run requires the optional trusted server-owned runRoutine(id, userId) callback; it must revalidate scope at execution, resolve workspace paths internally and use the exact current human.',
  'Agent configuration persists an exact visible connection ID; legacy unbound agents require one unique visible provider connection or an explicit ID. Missing/inaccessible stored IDs, unsupported subscriptions and unlisted models never fall back.',
  'Management accepts source slugs, row IDs and existing config IDs without rewriting references; native source execution must accept the same aliases when SessionManager registers these tools.',
  'Agent avatar editing and connection/credential creation, authentication, testing and secret rotation remain in their existing secure UI flows.',
  'Source updates cover public title/tagline, guide body (preserving frontmatter and Cache sections) and owner-approved literal MCP/relative API permission lists. Endpoint/auth/enable/test/provider/icon changes, arbitrary MCP regexes and global Bash/write-path/hint rules remain secure UI fields.',
  'Routine creation/editing accepts only schedule/event prompt actions in safe/ask mode; conditions, matcher, semantic condition, label/project/model overrides and script/webhook configurations are preserved but not converted or executed through these tools.',
  'Skill edits cover SKILL.md name/description/instructions/requiredSources/alwaysAllow, preserving other metadata and ancillary files; arbitrary bundle files, scripts, icons and host operations are not editable tools.',
  'Bundle authorization is checked synchronously after the queue wait, immediately before mutation starts. SQLite rows and filesystem/object-store writes are not one atomic transaction; revocation after that authorized commit point cannot retroactively cancel an in-flight storage effect.',
] as const

export function createMastraManagementTools(scope: {
  workspaceId: string
  agentId: string
  assertAccess: () => void
  getUserId: () => string
  assertChatAccess: (id: string) => void
  runRoutine?: (id: string, userId: string) => Promise<{ id: string; status: string }>
}) {
  const workspaceId = scope.workspaceId
  const id = z.string().regex(/^(?:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[a-z0-9]{12})$/)
  const slug = z.string().min(1).max(200).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  const sourceRef = z.string().min(1).max(200).describe('An existing workspace source slug, row ID or stored config ID')
  const version = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
  const revision = z.string().regex(/^[a-f0-9]{64}$/)
  const title = z.string().trim().min(1).max(MAX_TITLE)
  const instructions = z.string().max(MAX_INSTRUCTIONS)
  const thinkingLevel = z.enum(['off', 'low', 'medium', 'high', 'xhigh', 'max'])
  const refs = z.array(z.string().min(1).max(200)).max(MAX_LIST).refine((values) => new Set(values).size === values.length, 'Duplicate references')
  const skillFields = {
    title, description: z.string().trim().min(1).max(2000), instructions,
    requiredSources: refs.optional(), alwaysAllow: z.array(z.string().min(1).max(200)).max(200).optional(),
  }
  const color = z.union([
    z.string().regex(/^(?:accent|info|success|destructive|foreground)(?:\/(?:100|[1-9]?\d))?$/),
    z.object({ light: z.string().regex(/^#[a-fA-F0-9]{6}$/), dark: z.string().regex(/^#[a-fA-F0-9]{6}$/).optional() }).strict(),
  ]).transform((value) => value as EntityColor)
  const safeUrl = z.string().max(2048).refine((value) => {
    try {
      const url = new URL(value)
      return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash
    } catch { return false }
  }, 'Use a remote HTTP(S) endpoint without credentials, query parameters or fragments; configure authentication in the secure form')
  const promptAction = z.object({ type: z.literal('prompt'), prompt: z.string().trim().min(1).max(20_000) }).strict()
  const routineConfig = z.discriminatedUnion('type', [
    z.object({ type: z.literal('schedule'), schedule: z.object({ cron: z.string().min(1).max(200), timezone: z.string().min(1).max(100).optional() }).strict(), permissionMode: z.enum(['safe', 'ask']).default('safe'), actions: z.array(promptAction).min(1).max(MAX_ROUTINE_ACTIONS) }).strict(),
    z.object({ type: z.literal('event'), event: z.string().min(1).max(100), permissionMode: z.enum(['safe', 'ask']).default('safe'), actions: z.array(promptAction).min(1).max(MAX_ROUTINE_ACTIONS) }).strict(),
  ])
  const statusInput = z.object({ label: z.string().trim().min(1).max(120), color: color.optional(), icon: z.string().max(16_384).optional(), category: z.enum(['open', 'closed']) }).strict()
  const labelFields = {
    name: z.string().trim().min(1).max(120), color: color.optional(), valueType: z.enum(['string', 'number', 'date', 'link']).optional(),
    autoRules: z.array(z.union([
      z.object({ pattern: z.string().min(1).max(2000), flags: z.string().max(10).optional(), valueTemplate: z.string().max(2000).optional(), description: z.string().max(1000).optional() }).strict(),
      z.object({ semantic: z.string().trim().min(1).max(500), threshold: z.number().gt(0).lte(1).optional(), value: z.string().max(2000).optional(), description: z.string().max(1000).optional() }).strict(),
    ])).max(20).optional(),
  }

  const access = () => {
    scope.assertAccess()
    const userId = id.parse(scope.getUserId())
    if (!isWorkspaceMember(workspaceId, userId)) throw domainError('forbidden', 'The initiating person is not a workspace member')
    const agent = getAgent(workspaceId, scope.agentId)
    if (!agent) throw domainError('forbidden', 'The named agent is not in this workspace')
    return { userId, actor: userActor(userId), agent }
  }
  const afterAwait = (userId: string) => {
    if (access().userId !== userId) throw domainError('forbidden', 'The initiating person changed during the operation')
  }
  const owner = () => {
    const person = access()
    if (getMemberRole(workspaceId, person.userId) !== 'owner') throw domainError('forbidden', 'Only a workspace owner can change statuses or labels')
    return person
  }
  const agent = (agentId: string) => {
    const value = getAgent(workspaceId, agentId)
    if (!value) throw domainError('not_found', 'Agent not found in this workspace')
    return value
  }
  const editableAgent = (agentId: string) => {
    const person = access(), value = agent(agentId)
    if (!canEditAgent(workspaceId, value, person.userId)) throw domainError('forbidden', 'Only the agent creator or a workspace owner can change this agent')
    return value
  }
  const assertVersion = (value: { updatedAt: number }, expected: number) => {
    if (value.updatedAt !== expected) throw domainError('conflict', 'The item changed since it was loaded')
  }
  const sourceAliases = (value: { id: string; slug: string }) => {
    const loaded = getLoadedSources(workspaceId).find((source) => source.config.slug === value.slug)
    return [value.id, value.slug, ...(loaded?.config.id ? [loaded.config.id] : [])]
  }
  const allowed = (kind: 'skills' | 'sources', value: { id: string; slug: string }) => {
    const limits = access().agent[kind]
    if (!limits.length || limits.includes(value.id) || limits.includes(value.slug)) return true
    return kind === 'sources' && sourceAliases(value).some((ref) => limits.includes(ref))
  }
  const skill = (value: string) => {
    const item = getSkill(workspaceId, value)
    if (!item || !allowed('skills', item)) throw domainError('not_found', 'Skill is unavailable in this agent scope')
    return item
  }
  const source = (value: string) => {
    const matches = getSources(workspaceId).filter((item) => sourceAliases(item).includes(value))
    if (matches.length > 1) throw domainError('invalid', 'The source identifier is ambiguous in this workspace')
    const item = matches[0]
    if (!item || !allowed('sources', item)) throw domainError('not_found', 'Source is unavailable in this agent scope')
    return item
  }
  const assertCreator = (createdBy: string) => {
    const person = access()
    if (createdBy !== person.actor && getMemberRole(workspaceId, person.userId) !== 'owner') throw domainError('forbidden', 'Only the creator or a workspace owner can change this item')
    return person
  }
  const workspace = () => {
    const value = getWorkspaceByNameOrId(workspaceId)
    if (!value || value.id !== workspaceId || value.remoteServer) throw domainError('invalid', 'The server-owned workspace path is unavailable')
    return value
  }
  const skillFiles = async (value: string, userId: string) => {
    const store = getBundleStore(workspace().rootPath, workspaceId, 'skills')
    const keys = await store.list(`${value}/`)
    afterAwait(userId)
    skill(value)
    const files: BundleFiles = new Map()
    for (const key of keys) {
      if (!key.startsWith(`${value}/`)) throw domainError('invalid', 'The skill bundle contains an invalid key')
      const bytes = await store.get(key)
      afterAwait(userId)
      skill(value)
      if (!bytes) throw domainError('conflict', 'The skill bundle changed while reading it')
      files.set(key.slice(value.length + 1), bytes)
    }
    if (!files.has('SKILL.md')) throw domainError('invalid', 'The skill bundle is unavailable')
    return files
  }
  const assertCapabilities = (kind: 'skills' | 'sources', values: string[]) => {
    const limits = access().agent[kind]
    if (!values.length && limits.length) throw domainError('forbidden', 'A restricted agent cannot grant all workspace capabilities')
    const items = kind === 'skills' ? getSkills(workspaceId) : getSources(workspaceId)
    for (const ref of values) {
      const matches = items.filter((value) => kind === 'sources' ? sourceAliases(value).includes(ref) : value.id === ref || value.slug === ref)
      const item = matches.length === 1 ? matches[0] : undefined
      if (!item || !allowed(kind, item)) throw domainError('forbidden', 'A selected capability is unavailable in this agent scope')
      if (kind === 'sources') {
        const loaded = getLoadedSources(workspaceId).find((value) => value.config.slug === item.slug)
        if (!loaded || !['mcp', 'api'].includes(loaded.config.type) || loaded.config.mcp?.transport === 'stdio') throw domainError('invalid', 'Only remote HTTP/cloud MCP or API sources can be configured; stored unsupported records are preserved')
      }
    }
  }
  const supportedConnection = (connection: Connection) => {
    if (connection.authType !== 'api_key' || !connection.hasSecret || !['openai', 'anthropic', 'custom'].includes(connection.type)) return false
    if (connection.baseUrl && !safeUrl.safeParse(connection.baseUrl).success) return false
    return connection.type !== 'custom' || (!!connection.baseUrl && ['openai-completions', 'openai-responses'].includes(connection.config.customEndpoint?.api ?? ''))
  }
  const connections = () => {
    const { userId } = access()
    return getVisibleConnections({ workspaceId, userId })
  }
  const assertModel = (provider: string, model: string | null, connectionId?: string | null) => {
    const { userId } = access()
    const matches = connectionId ? [] : connections().filter((value) => value.type === provider)
    if (!connectionId && matches.length !== 1) throw domainError('invalid', 'Agent provider must resolve to exactly one visible connection when no exact connection ID is supplied')
    const connection = connectionId ? getConnectionById(connectionId, { workspaceId, userId }) : matches[0]
    if (!connection) throw domainError('forbidden', 'The selected connection is missing or inaccessible to the initiating person; no fallback is allowed')
    if (connection.type !== provider) throw domainError('invalid', 'The selected connection does not match the selected provider')
    if (!supportedConnection(connection)) throw domainError('invalid', 'Use a supported API-key connection configured through the secure form')
    const models = (connection.models ?? []).map((value) => typeof value === 'string' ? value : value.id)
    const selected = model ?? connection.defaultModel
    if (!selected || !models.includes(selected)) throw domainError('invalid', 'The selected model must be in the visible connection model list; refresh it in the secure connection form')
    return connection.id
  }
  const routine = (routineId: string) => {
    const value = getRoutine(workspaceId, routineId)
    if (!value) throw domainError('not_found', 'Routine not found in this workspace')
    if (value.agentId) agent(value.agentId)
    return value
  }
  const editableRoutine = (routineId: string) => {
    const person = access(), value = routine(routineId)
    if (!canEditRoutine(workspaceId, value, person.userId)) throw domainError('forbidden', 'Only the routine creator or a workspace owner can change this routine')
    return value
  }
  const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
  const routineVersion = (value: Routine) => digest({ title: value.title, config: value.config, agentId: value.agentId, pausedAt: value.pausedAt, createdBy: value.createdBy })
  const assertRevision = (actual: string, expected: string) => {
    if (actual !== expected) throw domainError('conflict', 'The configuration changed since it was loaded')
  }
  const safeRoutine = (value: Routine) => {
    const editable = routineConfig.safeParse(value.config)
    return {
      id: value.id, title: value.title, agentId: value.agentId, createdBy: value.createdBy, createdAt: value.createdAt, pausedAt: value.pausedAt,
      version: routineVersion(value), editable: editable.success,
      ...(editable.success ? { config: editable.data } : { type: value.config.type, actionTypes: value.config.actions.map((action) => action.type) }),
      runs: value.runs.filter((run) => {
        if (!run.chatId) return true
        try { scope.assertChatAccess(run.chatId); return true } catch { return false }
      }).map((run) => ({ id: run.id, scheduledFor: run.scheduledFor, status: run.status, chatId: run.chatId, startedAt: run.startedAt })),
    }
  }
  const statuses = () => { const values = getStatuses(workspaceId); return { statuses: values, version: digest(values) } }
  const labels = () => { const values = getLabels(workspaceId); return { labels: values, version: digest(values) } }

  return {
    agent_list: createTool({ id: 'agent_list', description: 'List workspace agents and read versions. The isDefault identity is protected independently of its editable name.', inputSchema: z.object({}).strict(), execute: async () => { access(); return getAgents(workspaceId) } }),
    agent_get: createTool({ id: 'agent_get', description: 'Read one agent in this workspace and its updatedAt version.', inputSchema: z.object({ id }).strict(), execute: async (input) => { access(); return agent(input.id) } }),
    agent_connections: createTool({ id: 'agent_connections', description: 'List all visible supported connection IDs and metadata, including same-slug rows in different scopes. Select exact IDs; legacy provider-only selection requires legacySelectable. Never returns credentials, endpoints or raw authentication config.', inputSchema: z.object({}).strict(), execute: async () => {
      const visible = connections()
      return visible.filter(supportedConnection).map((value) => ({ id: value.id, slug: value.slug, scope: value.scope, title: value.title, provider: value.type, defaultModel: value.defaultModel, models: (value.models ?? []).map((model) => typeof model === 'string' ? model : model.id), updatedAt: value.updatedAt, selectable: true, legacySelectable: visible.filter((connection) => connection.type === value.type).length === 1 }))
    } }),
    agent_create: createTool({
      id: 'agent_create', description: 'Create a workspace agent after explicit approval, even in Allow-all, persisting an exact visible supported connection ID and model. An omitted/null ID requires one unique visible provider connection. Use secure forms for credentials; does not assign work or attach capabilities.',
      inputSchema: z.object({ title, instructions: instructions.optional(), provider: z.enum(['openai', 'anthropic', 'custom']), model: z.string().min(1).max(200).nullable(), llmConnectionId: id.nullable().optional(), thinkingLevel: thinkingLevel.optional() }).strict(),
      execute: async (input) => {
        const person = access()
        if (person.agent.skills.length || person.agent.sources.length) throw domainError('forbidden', 'A restricted agent cannot create an agent with all workspace capabilities')
        const llmConnectionId = assertModel(input.provider, input.model, input.llmConnectionId)
        return createAgent({ ...input, llmConnectionId, workspaceId, createdBy: person.actor })
      },
    }),
    agent_update: createTool({
      id: 'agent_update', description: 'Edit an agent name or instructions after explicit approval, even in Allow-all, with creator/owner authority and its read version. The default agent remains editable.',
      inputSchema: z.object({ id, title: title.optional(), instructions: instructions.optional(), expectedUpdatedAt: version }).strict().refine((value) => value.title !== undefined || value.instructions !== undefined, 'Provide a field to update'),
      execute: async ({ id, ...patch }) => { editableAgent(id); return updateAgent(workspaceId, id, patch) },
    }),
    agent_configure: createTool({
      strict: false,
      id: 'agent_configure', description: 'Configure actual model, exact connection ID, thinking level or capabilities after explicit approval, even in Allow-all. Stored connection IDs must remain visible; missing/inaccessible IDs never fall back. Legacy unbound agents require one unique visible provider connection or an explicit ID. Capability lists replace complete lists; empty means all. Unsupported records are not converted.',
      inputSchema: z.object({ id, provider: z.enum(['openai', 'anthropic', 'custom']).nullish().transform((value) => value ?? undefined), model: z.string().min(1).max(200).nullable().optional(), llmConnectionId: id.nullable().optional(), thinkingLevel: thinkingLevel.optional(), skills: refs.optional(), sources: refs.optional(), expectedUpdatedAt: version }).strict().refine((value) => ['provider', 'model', 'llmConnectionId', 'thinkingLevel', 'skills', 'sources'].some((field) => value[field as keyof typeof value] !== undefined), 'Provide a configuration field'),
      execute: async ({ id, ...patch }) => {
        const before = editableAgent(id)
        assertVersion(before, patch.expectedUpdatedAt)
        if (patch.skills !== undefined) assertCapabilities('skills', patch.skills)
        if (patch.sources !== undefined) assertCapabilities('sources', patch.sources)
        const llmConnectionId = assertModel(patch.provider ?? before.provider, patch.model === undefined ? before.model : patch.model, patch.llmConnectionId === undefined ? before.llmConnectionId : patch.llmConnectionId)
        return updateAgent(workspaceId, id, { ...patch, llmConnectionId })
      },
    }),
    agent_delete: createTool({ id: 'agent_delete', description: 'Delete a non-default agent after explicit approval, even in Allow-all, with creator/owner authority and its read version. The server refuses deleting the default identity.', inputSchema: z.object({ id, expectedUpdatedAt: version }).strict(), execute: async (input) => { assertVersion(editableAgent(input.id), input.expectedUpdatedAt); deleteAgent(workspaceId, input.id); return { deleted: true } } }),
    routine_list: createTool({ id: 'routine_list', description: 'List routines with redacted configuration versions. Unsupported script/webhook configs are metadata-only and never executed or converted; secret URLs and raw run errors are omitted.', inputSchema: z.object({}).strict(), execute: async () => { access(); return getRoutines(workspaceId).map(safeRoutine) } }),
    routine_get: createTool({ id: 'routine_get', description: 'Read a routine safely with its configuration version; inaccessible run chats are omitted.', inputSchema: z.object({ id }).strict(), execute: async (input) => { access(); return safeRoutine(routine(input.id)) } }),
    routine_create: createTool({
      id: 'routine_create', description: 'Create a paused schedule/event prompt routine after explicit approval, even in Allow-all. Drafting never activates or runs it. Scripts, webhook URLs, auth, model overrides and notification actions are not accepted.',
      inputSchema: z.object({ title: z.string().trim().min(1).max(MAX_ROUTINE_TITLE), agentId: id.optional(), config: routineConfig }).strict(),
      execute: async (input) => { const person = access(); if (input.agentId) agent(input.agentId); return safeRoutine(createRoutine({ ...input, workspaceId, agentId: input.agentId ?? scope.agentId, createdBy: person.actor, paused: true })) },
    }),
    routine_update: createTool({
      strict: false,
      id: 'routine_update', description: 'Update explicit supported routine fields after approval, even in Allow-all, preserving paused state and transferring execution ownership to the current human. Unsupported stored configs can only be paused or deleted, not edited or converted through this tool.',
      inputSchema: z.object({ id, title: z.string().trim().min(1).max(MAX_ROUTINE_TITLE).optional(), agentId: id.nullable().optional(), config: routineConfig.optional(), expectedVersion: revision }).strict().refine((value) => value.title !== undefined || value.agentId !== undefined || value.config !== undefined, 'Provide a field to update'),
      execute: async ({ id, expectedVersion, ...patch }) => {
        const before = editableRoutine(id)
        assertRevision(routineVersion(before), expectedVersion)
        if (patch.agentId) agent(patch.agentId)
        if (!routineConfig.safeParse(before.config).success) throw domainError('invalid', 'Use the secure routine form to edit this unsupported stored configuration')
        return safeRoutine(updateRoutine(workspaceId, id, { ...patch, by: access().actor }))
      },
    }),
    routine_set_paused: createTool({ id: 'routine_set_paused', description: 'Pause or explicitly activate a routine after approval, even in Allow-all. Activation accepts only supported prompt configurations, executes as the current human, and never runs immediately.', inputSchema: z.object({ id, paused: z.boolean(), expectedVersion: revision }).strict(), execute: async (input) => { const before = editableRoutine(input.id); assertRevision(routineVersion(before), input.expectedVersion); if (!input.paused && !routineConfig.safeParse(before.config).success) throw domainError('invalid', 'This stored configuration cannot be activated through management tools'); return safeRoutine(updateRoutine(workspaceId, input.id, { paused: input.paused, by: access().actor })) } }),
    routine_delete: createTool({ id: 'routine_delete', description: 'Delete a routine and its runs after explicit approval, even in Allow-all. Does not execute actions or disclose incoming webhook secrets.', inputSchema: z.object({ id, expectedVersion: revision }).strict(), execute: async (input) => { const before = editableRoutine(input.id); assertRevision(routineVersion(before), input.expectedVersion); deleteRoutine(workspaceId, input.id); dropWebhookSecret(before.config.webhook?.secretId); return { deleted: true } } }),
    routine_run: createTool({ id: 'routine_run', description: 'Run a supported prompt routine once after explicit approval, even in Allow-all, as the exact initiating human. Requires a server-owned runner; no script, webhook or alternate-owner fallback.', inputSchema: z.object({ id, expectedVersion: revision }).strict(), execute: async (input) => { const before = editableRoutine(input.id), person = access(); assertRevision(routineVersion(before), input.expectedVersion); if (!routineConfig.safeParse(before.config).success) throw domainError('invalid', 'This stored configuration cannot run through management tools'); if (!scope.runRoutine) throw domainError('invalid', 'The server-owned management routine runner is unavailable'); const run = await scope.runRoutine(input.id, person.userId); afterAwait(person.userId); editableRoutine(input.id); return { id: run.id, status: run.status } } }),
    skill_list: createTool({ id: 'skill_list', description: 'List workspace skill metadata allowed for this agent, without host paths or private bundle configuration.', inputSchema: z.object({}).strict(), execute: async () => { access(); return getSkills(workspaceId).filter((value) => allowed('skills', value)) } }),
    skill_get: createTool({ id: 'skill_get', description: 'Read allowed skill instructions and public metadata with its updatedAt version. Does not return private frontmatter, host paths, ancillary files or script contents.', inputSchema: z.object({ slug }).strict(), execute: async (input) => {
      const person = access(), before = skill(input.slug)
      const files = await skillFiles(input.slug, person.userId)
      afterAwait(person.userId)
      const current = skill(input.slug)
      assertVersion(current, before.updatedAt)
      const parsed = parseSkillFile(new TextDecoder().decode(files.get('SKILL.md')))
      if (!parsed) throw domainError('invalid', 'The skill instructions cannot be parsed')
      const sources = getSources(workspaceId).filter((value) => allowed('sources', value))
      return {
        ...current, instructions: parsed.body,
        requiredSources: (parsed.metadata.requiredSources ?? []).filter((ref) => sources.some((value) => sourceAliases(value).includes(ref))),
        alwaysAllow: Array.isArray(parsed.metadata.alwaysAllow) ? parsed.metadata.alwaysAllow.filter((value) => typeof value === 'string') : [],
      }
    } }),
    skill_create: createTool({
      id: 'skill_create', description: 'Create a workspace SKILL.md after explicit approval, even in Allow-all. Source/permission metadata is capability-sensitive; no scripts, arbitrary files, host paths or credentials are accepted.',
      inputSchema: z.object({ slug: slug.max(64), ...skillFields }).strict(),
      execute: async (input) => {
        const person = access()
        if (person.agent.skills.length) throw domainError('forbidden', 'A restricted agent cannot create a skill outside its allowed capabilities')
        if (input.requiredSources) assertCapabilities('sources', input.requiredSources)
        const metadata = { name: input.title, description: input.description, ...(input.requiredSources ? { requiredSources: input.requiredSources } : {}), ...(input.alwaysAllow ? { alwaysAllow: input.alwaysAllow } : {}) }
        const files: BundleFiles = new Map([['SKILL.md', new TextEncoder().encode(`---\n${stringify(metadata)}---\n${input.instructions}`)]])
        const created = await createSkill({ workspaceId, slug: input.slug, files, createdBy: person.actor }, () => {
          afterAwait(person.userId)
          workspace()
          if (access().agent.skills.length) throw domainError('forbidden', 'A restricted agent cannot create a skill outside its allowed capabilities')
          if (input.requiredSources) assertCapabilities('sources', input.requiredSources)
        })
        afterAwait(person.userId)
        return skill(created.slug)
      },
    }),
    skill_update: createTool({
      id: 'skill_update', description: 'Edit allowed skill instructions or explicit metadata after approval, even in Allow-all, with creator/owner rights and a read version. Preserves every ancillary file and unedited frontmatter field; does not execute scripts.',
      inputSchema: z.object({ slug, ...skillFields, title: title.optional(), description: skillFields.description.optional(), instructions: instructions.optional(), expectedUpdatedAt: version }).strict().refine((value) => ['title', 'description', 'instructions', 'requiredSources', 'alwaysAllow'].some((field) => value[field as keyof typeof value] !== undefined), 'Provide a skill field to update'),
      execute: async (input) => {
        const before = skill(input.slug), person = assertCreator(before.createdBy)
        assertVersion(before, input.expectedUpdatedAt)
        if (input.requiredSources) assertCapabilities('sources', input.requiredSources)
        const files = await skillFiles(input.slug, person.userId)
        afterAwait(person.userId)
        const current = skill(input.slug)
        assertCreator(current.createdBy)
        assertVersion(current, input.expectedUpdatedAt)
        if (input.requiredSources) assertCapabilities('sources', input.requiredSources)
        const content = new TextDecoder().decode(files.get('SKILL.md'))
        const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)
        if (!frontmatter) throw domainError('invalid', 'The skill frontmatter cannot be edited safely')
        const document = parseDocument(frontmatter[1]!)
        if (document.errors.length || !isMap(document.contents)) throw domainError('invalid', 'The skill frontmatter cannot be edited safely')
        if (input.title !== undefined) document.set('name', input.title)
        if (input.description !== undefined) document.set('description', input.description)
        if (input.requiredSources !== undefined) document.set('requiredSources', input.requiredSources)
        if (input.alwaysAllow !== undefined) document.set('alwaysAllow', input.alwaysAllow)
        files.set('SKILL.md', new TextEncoder().encode(`---\n${document.toString()}---\n${input.instructions ?? content.slice(frontmatter[0].length)}`))
        await updateBundle(workspaceId, input.slug, files, input.expectedUpdatedAt, () => {
          afterAwait(person.userId)
          workspace()
          const live = skill(input.slug)
          assertCreator(live.createdBy)
          assertVersion(live, input.expectedUpdatedAt)
          if (input.requiredSources) assertCapabilities('sources', input.requiredSources)
        })
        afterAwait(person.userId)
        return skill(input.slug)
      },
    }),
    skill_delete: createTool({ id: 'skill_delete', description: 'Delete an allowed workspace skill bundle after explicit approval, even in Allow-all, with creator/owner authority and the read version rechecked after the bundle queue wait.', inputSchema: z.object({ slug, expectedUpdatedAt: version }).strict(), execute: async (input) => {
      const value = skill(input.slug), person = assertCreator(value.createdBy)
      assertVersion(value, input.expectedUpdatedAt)
      await deleteSkill(workspaceId, input.slug, () => {
        afterAwait(person.userId)
        workspace()
        const live = skill(input.slug)
        assertCreator(live.createdBy)
        assertVersion(live, input.expectedUpdatedAt)
      })
      afterAwait(person.userId)
      return { deleted: true }
    } }),
    source_list: createTool({ id: 'source_list', description: 'List allowed source row metadata only. Existing local/stdio records are preserved, not converted or executed; credentials, guides, raw configs and endpoints are never returned.', inputSchema: z.object({}).strict(), execute: async () => { access(); return getSources(workspaceId).filter((value) => allowed('sources', value)) } }),
    source_get: createTool({ id: 'source_get', description: 'Read allowed source row metadata and its updatedAt version by slug, row ID or stored config ID; never returns endpoints, private auth configs or secrets.', inputSchema: z.object({ slug: sourceRef }).strict(), execute: async (input) => { access(); return source(input.slug) } }),
    source_create: createTool({
      id: 'source_create', description: 'Draft a disabled remote HTTP/cloud MCP or API source after explicit approval, even in Allow-all. Only unauthenticated endpoint metadata is accepted; use secure forms for credentials and enable/test. No network request or automatic agent attachment.',
      inputSchema: z.object({ title: z.string().trim().min(1).max(120), type: z.enum(['mcp', 'api']), url: safeUrl }).strict(),
      execute: async (input) => {
        const person = access()
        if (person.agent.sources.length) throw domainError('forbidden', 'A restricted agent cannot create a source outside its allowed capabilities')
        const created = await createSource(workspace().rootPath, { name: input.title, provider: 'custom', type: input.type, enabled: false, ...(input.type === 'mcp' ? { mcp: { transport: 'http', url: input.url, authType: 'none' } } : { api: { baseUrl: input.url, authType: 'none' } }) }, {
          workspaceId, createdBy: person.actor, authorize: () => {
            afterAwait(person.userId)
            workspace()
            if (access().agent.sources.length) throw domainError('forbidden', 'A restricted agent cannot create a source outside its allowed capabilities')
          },
        })
        afterAwait(person.userId)
        return source(created.slug)
      },
    }),
    source_update: createTool({
      id: 'source_update', description: 'Update an allowed existing remote source title/tagline, public guide body or source permission lists after explicit approval, even in Allow-all, using its read version. Creator/owner authority is required; permission changes require a workspace owner. Preserves IDs, type, origin, authentication, enabled state, secrets, defaults, guide frontmatter and ancillary files. Null means omitted for these editable fields; empty strings clear tagline/guide and [] clears a permission list. Never returns guides, URLs or private configs and never enables, tests or executes a source.',
      inputSchema: SourceUpdateSchema.safeExtend({ slug: sourceRef, expectedUpdatedAt: version }),
      execute: async ({ slug, expectedUpdatedAt, ...patch }) => {
        const value = source(slug), person = assertCreator(value.createdBy)
        assertVersion(value, expectedUpdatedAt)
        workspace()
        return updateSource(workspaceId, value.slug, patch, expectedUpdatedAt, { userId: person.userId, authorize: () => {
          afterAwait(person.userId)
          workspace()
          const live = source(slug)
          if (live.id !== value.id) throw domainError('conflict', 'The source identity changed since it was loaded')
        } })
      },
    }),
    source_delete: createTool({ id: 'source_delete', description: 'Delete an allowed source by slug, row ID or stored config ID after explicit approval, even in Allow-all, with creator/owner authority and the read version. Removes its workspace default selection; never runs or converts unsupported stored records.', inputSchema: z.object({ slug: sourceRef, expectedUpdatedAt: version }).strict(), execute: async (input) => {
      const value = source(input.slug), person = assertCreator(value.createdBy)
      assertVersion(value, input.expectedUpdatedAt)
      const aliases = sourceAliases(value)
      const rootPath = workspace().rootPath
      await deleteSource(workspaceId, value.slug, () => {
        afterAwait(person.userId)
        const live = source(input.slug)
        if (live.id !== value.id) throw domainError('conflict', 'The source identity changed since it was loaded')
        assertCreator(live.createdBy)
        assertVersion(live, input.expectedUpdatedAt)
        workspace()
      })
      afterAwait(person.userId)
      const config = loadWorkspaceConfig(rootPath)
      if (config?.defaults?.enabledSourceSlugs?.some((value) => aliases.includes(value))) {
        config.defaults.enabledSourceSlugs = config.defaults.enabledSourceSlugs.filter((value) => !aliases.includes(value))
        saveWorkspaceConfig(rootPath, config)
      }
      return { deleted: true }
    } }),
    status_list: createTool({ id: 'status_list', description: 'List workspace statuses and the configuration version, including fixed/default protections.', inputSchema: z.object({}).strict(), execute: async () => { access(); return statuses() } }),
    status_create: createTool({ id: 'status_create', description: 'Create an open/closed status after explicit owner approval, even in Allow-all. Does not change any chat status.', inputSchema: statusInput.extend({ expectedVersion: revision }).strict(), execute: async ({ expectedVersion, ...input }) => { owner(); assertRevision(statuses().version, expectedVersion); const status = createStatus(workspaceId, input); return { status, version: statuses().version } } }),
    status_update: createTool({ id: 'status_update', description: 'Edit a status after explicit owner approval, even in Allow-all; fixed status identity/category constraints remain enforced by the domain.', inputSchema: statusInput.partial().extend({ id: slug, expectedVersion: revision }).strict().refine((value) => ['label', 'color', 'icon', 'category'].some((field) => value[field as keyof typeof value] !== undefined), 'Provide a field to update'), execute: async ({ id, expectedVersion, ...input }) => { owner(); assertRevision(statuses().version, expectedVersion); const status = updateStatus(workspaceId, id, input); return { status, version: statuses().version } } }),
    status_delete: createTool({ id: 'status_delete', description: 'Delete a custom non-default status after explicit owner approval, even in Allow-all. Its chats move to the domain fallback status.', inputSchema: z.object({ id: slug, expectedVersion: revision }).strict(), execute: async (input) => { owner(); assertRevision(statuses().version, input.expectedVersion); deleteStatus(workspaceId, input.id); return statuses() } }),
    status_reorder: createTool({ id: 'status_reorder', description: 'Reorder workspace statuses after explicit owner approval, even in Allow-all, using the configuration read version.', inputSchema: z.object({ ids: z.array(slug).min(1).max(200).refine((values) => new Set(values).size === values.length, 'Duplicate IDs'), expectedVersion: revision }).strict(), execute: async (input) => { owner(); assertRevision(statuses().version, input.expectedVersion); reorderStatuses(workspaceId, input.ids); return statuses() } }),
    status_set_default: createTool({ id: 'status_set_default', description: 'Select the status for future chats after explicit owner approval, even in Allow-all. Existing chat statuses do not change.', inputSchema: z.object({ id: slug, expectedVersion: revision }).strict(), execute: async (input) => { owner(); assertRevision(statuses().version, input.expectedVersion); setDefaultStatus(workspaceId, input.id); return statuses() } }),
    label_list: createTool({ id: 'label_list', description: 'List the workspace label tree and its configuration read version.', inputSchema: z.object({}).strict(), execute: async () => { access(); return labels() } }),
    label_create: createTool({ id: 'label_create', description: 'Create a label after explicit owner approval, even in Allow-all. Auto-label rules affect future messages and may trigger existing routines; approval is mandatory.', inputSchema: z.object({ ...labelFields, parentId: slug.optional(), expectedVersion: revision }).strict(), execute: async ({ expectedVersion, ...input }) => { owner(); assertRevision(labels().version, expectedVersion); const label = createLabel(workspaceId, input); return { label, version: labels().version } } }),
    label_update: createTool({ id: 'label_update', description: 'Edit a label or its future auto-label behavior after explicit owner approval, even in Allow-all. Clearing rules is explicit; identity and hierarchy remain unchanged.', inputSchema: z.object({ ...labelFields, name: labelFields.name.optional(), valueType: z.enum(['string', 'number', 'date', 'link', '']).optional(), id: slug, expectedVersion: revision }).strict().refine((value) => ['name', 'color', 'valueType', 'autoRules'].some((field) => value[field as keyof typeof value] !== undefined), 'Provide a field to update'), execute: async ({ id, expectedVersion, ...input }) => { owner(); assertRevision(labels().version, expectedVersion); const label = updateLabel(workspaceId, id, input); return { label, version: labels().version } } }),
    label_delete: createTool({ id: 'label_delete', description: 'Delete a label and its descendants after explicit owner approval, even in Allow-all. Existing entity labels are stripped by the domain.', inputSchema: z.object({ id: slug, expectedVersion: revision }).strict(), execute: async (input) => { owner(); assertRevision(labels().version, input.expectedVersion); const result = deleteLabel(workspaceId, input.id); return { ...result, ...labels() } } }),
    label_move: createTool({ id: 'label_move', description: 'Move an existing label under another label or to the root after explicit owner approval, even in Allow-all.', inputSchema: z.object({ id: slug, parentId: slug.nullable(), expectedVersion: revision }).strict(), execute: async (input) => { owner(); assertRevision(labels().version, input.expectedVersion); moveLabel(workspaceId, input.id, input.parentId); return labels() } }),
    label_reorder: createTool({ id: 'label_reorder', description: 'Reorder labels within one parent after explicit owner approval, even in Allow-all; cross-parent moves use label_move.', inputSchema: z.object({ parentId: slug.nullable(), ids: z.array(slug).min(1).max(200).refine((values) => new Set(values).size === values.length, 'Duplicate IDs'), expectedVersion: revision }).strict(), execute: async (input) => { owner(); assertRevision(labels().version, input.expectedVersion); reorderLabels(workspaceId, input.parentId, input.ids); return labels() } }),
  }
}
