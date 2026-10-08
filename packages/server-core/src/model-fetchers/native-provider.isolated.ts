import { afterAll, expect, it } from 'bun:test'
import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { fetchNativeModels, validateNativeConnection } from './native-provider'
import { createMastraChatModel } from '../sessions/mastra-chat'
import { runMastraSession } from '../sessions/mastra-session'
import { closeMastraHistory } from '../sessions/mastra-history'
import type { AgentEvent } from '@otto/core/types'

const calls: { path: string; key: string | null; auth: string | null; body: any }[] = []
let step = 0, malformed = false
const endpoint = Bun.serve({ port: 0, hostname: '127.0.0.1', async fetch(request) {
  const path = new URL(request.url).pathname
  const body = request.method === 'POST' ? await request.json() as any : undefined
  calls.push({ path, key: request.headers.get('x-api-key'), auth: request.headers.get('authorization'), body })
  if (path.endsWith('/models')) return malformed ? new Response('private-provider-body-controlled-key', { headers: { 'content-type': 'application/json' } }) : Response.json({ data: path.startsWith('/anthropic') ? [null, { id: 'claude-fixture', display_name: 'unsafe display ignored' }] : [{ id: 'vendor/model-fixture' }] })
  const tool = step++ % 2 === 0 && body.tools?.length
  if (path.endsWith('/messages')) {
    const block = tool ? { type: 'tool_use', id: 'tool-fixture', name: 'inspect_fixture', input: {} } : { type: 'text', text: '' }
    const parts = [
      ['message_start', { type: 'message_start', message: { id: 'msg-fixture', type: 'message', role: 'assistant', model: 'claude-fixture', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 2, output_tokens: 0 } } }],
      ['content_block_start', { type: 'content_block_start', index: 0, content_block: block }],
      ['content_block_delta', { type: 'content_block_delta', index: 0, delta: tool ? { type: 'input_json_delta', partial_json: '{"title":"fixture"}' } : { type: 'text_delta', text: 'Native fixture response.' } }],
      ['content_block_stop', { type: 'content_block_stop', index: 0 }],
      ['message_delta', { type: 'message_delta', delta: { stop_reason: tool ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 3 } }],
      ['message_stop', { type: 'message_stop' }],
    ]
    return new Response(parts.map(([name, value]) => `event: ${name}\ndata: ${JSON.stringify(value)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } })
  }
  if (path.endsWith('/chat/completions')) {
    const parts = [
      { id: 'completion-fixture', object: 'chat.completion.chunk', created: 0, model: 'vendor/model-fixture', choices: [{ index: 0, delta: tool ? { role: 'assistant', tool_calls: [{ index: 0, id: 'tool-fixture', type: 'function', function: { name: 'inspect_fixture', arguments: '{"title":"fixture"}' } }] } : { role: 'assistant', content: 'Native fixture response.' }, finish_reason: null }] },
      { id: 'completion-fixture', object: 'chat.completion.chunk', created: 0, model: 'vendor/model-fixture', choices: [{ index: 0, delta: {}, finish_reason: tool ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } },
    ]
    return new Response(parts.map((part) => `data: ${JSON.stringify(part)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
  }
  return new Response('Wrong provider contract', { status: 404 })
} })
afterAll(async () => { endpoint.stop(true); await closeMastraHistory() })

it('native Anthropic and explicit Chat Completions use isolated keys, actual Session tool loops and completed usage', async () => {
  for (const provider of ['anthropic', 'custom'] as const) {
    const baseUrl = endpoint.url.href + (provider === 'anthropic' ? 'anthropic/v1' : 'compat/v1')
    const api = provider === 'custom' ? 'openai-completions' : undefined
    const catalog = await fetchNativeModels({ provider, apiKey: `controlled-${provider}-key`, baseUrl, api })
    const model = catalog.models[0]!.id
    expect(model).toBe(provider === 'anthropic' ? 'claude-fixture' : 'vendor/model-fixture')
    const events: AgentEvent[] = []
    let effects = 0
    step = 0
    await runMastraSession({ chatId: crypto.randomUUID(), workspaceId: 'fixture-workspace', ownerId: 'fixture-owner', agentId: 'fixture-agent', name: 'Fixture', instructions: 'Inspect fixture only.', messages: [{ role: 'user', content: 'Inspect it.' }], model: createMastraChatModel({ provider, api, model, apiKey: `controlled-${provider}-key`, baseUrl }), tools: { inspect_fixture: createTool({ id: 'inspect_fixture', description: 'Inspect fixture', inputSchema: z.object({ title: z.string() }).strict(), execute: async () => { effects++; return { inspected: true } } }) }, signal: new AbortController().signal, assertAccess: () => {}, policy: () => 'allow', onReady: () => {}, onApproval: () => {}, emit: async (event) => { events.push(event) } })
    expect(effects).toBe(1)
    expect(events.find((event) => event.type === 'tool_result')).toMatchObject({ isError: false })
    expect(events.find((event) => event.type === 'text_complete')).toMatchObject({ text: 'Native fixture response.' })
    expect(events.find((event) => event.type === 'complete')).toBeDefined()
    const inference = calls.filter((call) => call.path.startsWith(provider === 'anthropic' ? '/anthropic' : '/compat') && call.body)
    expect(inference.length).toBe(2)
    expect(inference.every((call) => provider === 'anthropic' ? call.key === 'controlled-anthropic-key' && call.auth === null : call.auth === 'Bearer controlled-custom-key' && call.key === null)).toBe(true)
    expect(JSON.stringify(events)).not.toContain(`controlled-${provider}-key`)
  }
})

it('Anthropic invalid catalog/null rows use safe fixed errors and custom unsupported protocols are refused', async () => {
  malformed = true
  const baseUrl = endpoint.url.href + 'anthropic/v1'
  const error = await fetchNativeModels({ provider: 'anthropic', apiKey: 'controlled-anthropic-key', baseUrl }).catch((error: Error) => error.message)
  expect(error).toBe('Anthropic returned an invalid model catalog.')
  expect(JSON.stringify(error)).not.toContain('private-provider-body')
  expect(await validateNativeConnection({ provider: 'anthropic', apiKey: 'controlled-anthropic-key', baseUrl })).toMatchObject({ success: false })
  malformed = false
  expect(() => createMastraChatModel({ provider: 'custom', model: 'fixture', apiKey: 'controlled-key', baseUrl: endpoint.url.href, api: 'anthropic-messages' })).toThrow('explicit supported OpenAI protocol')
})
