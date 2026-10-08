import { afterAll, expect, it } from 'bun:test'
import { z } from 'zod'
import { createTool } from '@mastra/core/tools'
import { createMastraChatModel } from './mastra-chat'
import { runMastraSession } from './mastra-session'
import { closeMastraHistory } from './mastra-history'
import type { AgentEvent } from '@otto/core/types'

afterAll(() => closeMastraHistory())

it('native wire schema matches execution for empty and nonempty tools, and invalid envelopes are errors in events/model feedback', async () => {
  let phase = 0, requests = 0, effects = 0
  const bodies: any[] = []
  const endpoint = Bun.serve({ port: 0, hostname: '127.0.0.1', async fetch(request) {
    const body = await request.json() as any
    bodies.push(body)
    const tool = body.tools.find((tool: any) => tool.name === (phase === 0 ? 'list_work' : 'inspect_title'))
    const arguments_ = phase === 0 ? Object.fromEntries(Object.keys(tool.parameters.properties).map((key) => [key, 'advertised metadata'])) : phase === 1 ? { title: 'controlled fixture' } : { title: 'controlled fixture', unexpected: 'controlled invalid field' }
    const call = requests++ % 2 === 0
    const item = call ? { type: 'function_call', id: 'fc', call_id: `call-${phase}`, name: tool.name, arguments: JSON.stringify(arguments_), status: 'completed' } : { type: 'message', id: 'msg' }
    const parts = [{ type: 'response.created', response: { id: `fixture-${requests}`, created_at: 0, model: 'fixture' } }, { type: 'response.output_item.added', output_index: 0, item },
      ...(call ? [{ type: 'response.function_call_arguments.delta', item_id: 'fc', output_index: 0, delta: JSON.stringify(arguments_) }, { type: 'response.function_call_arguments.done', item_id: 'fc', output_index: 0, arguments: JSON.stringify(arguments_) }, { type: 'response.output_item.done', output_index: 0, item }] : [{ type: 'response.output_text.delta', item_id: 'msg', delta: 'Controlled final answer.' }]), { type: 'response.completed', response: { usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } }]
    return new Response(parts.map((part) => `data: ${JSON.stringify(part)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } })
  } })
  try {
    const tools = {
      list_work: createTool({ id: 'list_work', description: 'Read fixture work', inputSchema: z.object({}).strict(), execute: async () => { effects++; return { projects: [], tasks: [], documents: [] } } }),
      inspect_title: createTool({ id: 'inspect_title', description: 'Inspect title', inputSchema: z.object({ title: z.string() }).strict(), execute: async (input) => { effects++; return { title: input.title } } }),
    }
    for (phase = 0; phase < 3; phase++) {
      const events: AgentEvent[] = []
      await runMastraSession({ chatId: crypto.randomUUID(), workspaceId: 'fixture-workspace', ownerId: 'fixture-owner', agentId: 'fixture-agent', name: 'Fixture', instructions: 'Use provided tools only.', messages: [{ role: 'user', content: 'Inspect fixture' }], model: createMastraChatModel({ provider: 'openai', model: 'fixture', apiKey: 'controlled-fixture-key', baseUrl: endpoint.url.href + 'v1' }), tools, signal: new AbortController().signal, assertAccess: () => {}, policy: () => 'allow', onReady: () => {}, onApproval: () => {}, emit: async (event) => { events.push(event) } })
      const result = events.find((event) => event.type === 'tool_result')!
      expect(result.type === 'tool_result' && result.isError).toBe(phase === 2)
      if (phase === 0) expect(result.type === 'tool_result' && JSON.parse(result.result)).toEqual({ projects: [], tasks: [], documents: [] })
      if (phase === 2) {
        expect(result.type === 'tool_result' && result.result).toContain('Tool input validation failed')
        expect(result.type === 'tool_result' && result.result).not.toContain('controlled invalid field')
        expect(JSON.stringify(bodies.at(-1).input)).toContain('validation')
      }
    }
    expect(effects).toBe(2)
    expect(bodies[0].tools.find((tool: any) => tool.name === 'list_work').parameters.properties).toEqual({})
    expect(Object.keys(bodies[0].tools.find((tool: any) => tool.name === 'inspect_title').parameters.properties)).toEqual(['title'])
    expect(JSON.stringify(bodies)).not.toContain('_intent')
    expect(JSON.stringify(bodies)).not.toContain('_displayName')
  } finally { endpoint.stop(true) }
})
