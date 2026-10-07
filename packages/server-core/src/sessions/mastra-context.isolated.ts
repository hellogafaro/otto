import { expect, it } from 'bun:test'
import { join } from 'node:path'
import { createAgent, updateAgent } from '@otto/shared/agents'
import { addWorkspace, saveConfig } from '@otto/shared/config'
import { CONFIG_DIR } from '@otto/shared/config/paths'
import { createSkill } from '@otto/shared/skills'
import { updateSetting, workspaceEntity } from '@otto/shared/settings'
import { streamMastraChat } from './mastra-chat.ts'
import { getMastraContext } from './mastra-context.ts'
import type { LanguageModelV2, LanguageModelV2StreamPart, LanguageModelV2CallOptions } from '@ai-sdk/provider-v5'

it('loads only selected workspace skill instructions through installed native discovery tools', async () => {
  saveConfig({ workspaces: [] })
  const workspace = addWorkspace({ name: 'Authorized', rootPath: join(CONFIG_DIR, 'authorized') })
  const other = addWorkspace({ name: 'Other human', rootPath: join(CONFIG_DIR, 'other-human') })
  const enc = (value: string) => new TextEncoder().encode(value)
  const skill = async (workspaceId: string, slug: string, body: string) => createSkill({ workspaceId, slug, createdBy: 'user:anaaaaaaaaaa', files: new Map([['SKILL.md', enc(`---\nname: ${slug}\ndescription: ${slug} procedure\n---\n${body}`)]]) })
  const selected = await skill(workspace.id, 'brief', 'AUTHORIZED_BRIEF_BODY: use existing documents and report evidence.')
  await skill(workspace.id, 'excluded', 'EXCLUDED_SKILL_BODY')
  await skill(other.id, 'private', 'OTHER_HUMAN_PRIVATE_SKILL')
  updateSetting(workspaceEntity(workspace.id), 'instructions', 'AUTHORIZED_WORKSPACE_RULES')
  updateSetting(workspaceEntity(other.id), 'instructions', 'OTHER_HUMAN_WORKSPACE_RULES')
  const agent = createAgent({ workspaceId: workspace.id, title: 'Planner', provider: 'openai', instructions: 'SELECTED_AGENT_RULES', skills: [selected.id], createdBy: 'user:anaaaaaaaaaa' })
  createAgent({ workspaceId: other.id, title: 'Private agent', provider: 'openai', instructions: 'OTHER_AGENT_PRIVATE_RULES', createdBy: 'user:benbbbbbbbbb' })
  let access = true
  const assertAccess = () => { if (!access) throw new Error('Access removed') }
  const context = getMastraContext({ workspaceId: workspace.id, agentId: agent.id, writesAllowed: false, unattended: false, assertAccess })
  expect(context.instructions).toContain('coding and nontechnical work')
  expect(context.instructions).toContain('AUTHORIZED_WORKSPACE_RULES')
  expect(context.instructions).toContain('SELECTED_AGENT_RULES')
  expect(context.instructions).toContain('Explore mode is read-only')
  expect(context.instructions).not.toContain('your own Linux computer')
  expect(context.instructions).not.toContain('To hand something to another agent')
  expect(context.instructions).not.toContain('OTHER_HUMAN')
  expect(context.skills().map((skill) => skill.name)).toEqual(['brief'])
  const calls: LanguageModelV2CallOptions[] = []
  const model: LanguageModelV2 = {
    specificationVersion: 'v2', provider: 'controlled-fixture', modelId: 'fixture', supportedUrls: {},
    doGenerate: async () => { throw new Error('stream only') },
    doStream: async (options) => {
      calls.push(options)
      const parts: LanguageModelV2StreamPart[] = calls.length === 1
        ? [{ type: 'tool-call', toolCallId: 'loadbrief', toolName: 'skill', input: JSON.stringify({ name: 'brief' }) }, { type: 'finish', finishReason: 'tool-calls', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }]
        : [{ type: 'text-start', id: 'text' }, { type: 'text-delta', id: 'text', delta: 'Scoped procedure loaded.' }, { type: 'text-end', id: 'text' }, { type: 'finish', finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }]
      return { stream: new ReadableStream({ start(controller) { controller.enqueue({ type: 'stream-start', warnings: [] }); for (const part of parts) controller.enqueue(part); controller.close() } }) }
    },
  }
  const events = []
  for await (const event of streamMastraChat({ agentId: agent.id, name: agent.title, instructions: context.instructions, messages: [{ role: 'user', content: 'Use the brief procedure.' }], model, skills: context.skills, signal: new AbortController().signal })) events.push(event)
  expect(calls).toHaveLength(2)
  expect(calls[0].tools?.map((tool) => tool.name)).toContain('skill')
  expect(calls[0].tools?.map((tool) => tool.name)).toContain('skill_search')
  expect(JSON.stringify(calls[0].prompt)).not.toContain('AUTHORIZED_BRIEF_BODY')
  expect(JSON.stringify(calls[1].prompt)).toContain('AUTHORIZED_BRIEF_BODY')
  expect(JSON.stringify(calls)).not.toContain('EXCLUDED_SKILL_BODY')
  expect(JSON.stringify(calls)).not.toContain('OTHER_HUMAN_PRIVATE_SKILL')
  expect(JSON.stringify(calls)).not.toContain('OTHER_AGENT_PRIVATE_RULES')
  expect(calls[0].tools?.map((tool) => tool.name)).not.toContain('executeCommand')
  expect(calls[0].tools?.map((tool) => tool.name)).not.toContain('create_document')
  expect(events.some((event) => event.type === 'tool_result' && !event.isError)).toBe(true)
  updateAgent(workspace.id, agent.id, { skills: ['excluded'] })
  expect(context.skills().map((skill) => skill.name)).toEqual(['excluded'])
  access = false
  expect(() => context.skills()).toThrow('Access removed')
  expect(() => getMastraContext({ workspaceId: workspace.id, agentId: agent.id, writesAllowed: true, unattended: false, assertAccess })).toThrow('Access removed')
  access = true
  await skill(workspace.id, 'brief--review', 'Existing compatible Otto domain, incompatible native name')
  await skill(workspace.id, 'brief-', 'Existing trailing hyphen')
  await createSkill({ workspaceId: workspace.id, slug: 'long-description', createdBy: 'user:anaaaaaaaaaa', files: new Map([['SKILL.md', enc(`---\nname: long-description\ndescription: ${'x'.repeat(1025)}\n---\nBody`)]]) })
  updateAgent(workspace.id, agent.id, { skills: [] })
  const excluded: string[] = []
  const compatible = getMastraContext({ workspaceId: workspace.id, agentId: agent.id, writesAllowed: true, unattended: false, assertAccess, onUnavailableSkill: (slug) => excluded.push(slug) })
  expect(compatible.skills().map((skill) => skill.name).sort()).toEqual(['brief', 'excluded'])
  expect(excluded.sort()).toEqual(['brief-', 'brief--review', 'long-description'].sort())
})
