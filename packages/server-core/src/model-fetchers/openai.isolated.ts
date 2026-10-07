import { afterAll, expect, it } from 'bun:test'
import { fetchOpenAiModels, validateOpenAiConnection } from './openai'
import { registerPiModelResolver } from '@otto/shared/config'

let status = 200
let responseError = false
const calls: { path: string; key: string | null; body?: any }[] = []
const server = Bun.serve({ port: 0, hostname: '127.0.0.1', async fetch(request) {
  const path = new URL(request.url).pathname
  calls.push({ path, key: request.headers.get('authorization'), body: request.method === 'POST' ? await request.json() : undefined })
  if (status !== 200) return new Response('fixture-secret-must-not-be-returned', { status })
  if (path.endsWith('/models')) return Response.json({ data: [{ id: 'gpt-fixture' }, { id: 'gpt-fixture' }, { id: 'text-embedding-fixture' }, { id: 'gpt-audio-fixture' }, { id: 'o3-fixture' }] })
  const parts = responseError
    ? [{ type: 'response.failed', sequence_number: 1, response: { error: { code: 'fixture_error', message: 'fixture-secret-must-not-be-returned' } } }]
    : [{ type: 'response.created', response: { id: 'fixture', created_at: 0, model: 'gpt-fixture' } }, { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'msg' } }, { type: 'response.output_text.delta', item_id: 'msg', delta: 'OK' }, { type: 'response.completed', response: { usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } }]
  return new Response(parts.map((part) => `data: ${JSON.stringify(part)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } })
} })
afterAll(() => server.stop())
const baseUrl = server.url.href + 'v1'

it('discovers account model candidates without importing the Pi catalog and validates completed native Responses', async () => {
  registerPiModelResolver(() => { throw new Error('Pi catalog must not run for OpenAI') })
  const result = await fetchOpenAiModels({ apiKey: 'controlled-key', baseUrl })
  expect(result.models.map((model) => model.id)).toEqual(['gpt-fixture', 'o3-fixture'])
  expect(result.models.every((model) => model.provider === 'openai' && !model.id.startsWith('pi/'))).toBe(true)
  expect(await validateOpenAiConnection({ apiKey: 'controlled-key', baseUrl, model: 'pi/gpt-fixture' })).toEqual({ success: true })
  expect(calls.at(-1)!.body).toMatchObject({ model: 'gpt-fixture', stream: true, store: false })
  expect(calls.at(-1)!.key).toBe('Bearer controlled-key')
})

it('returns safe fixed discovery errors, never provider bodies or keys', async () => {
  for (const code of [401,403,429,500]) {
    status = code
    const error = await fetchOpenAiModels({ apiKey:'controlled-key', baseUrl }).then(() => '', (error) => error.message)
    expect(error).not.toContain('controlled-key')
    expect(error).not.toContain('fixture-secret')
    expect(error.length).toBeGreaterThan(0)
  }
  status = 200
  const before = calls.length
  await expect(fetchOpenAiModels({ apiKey:'', baseUrl })).rejects.toThrow('API key is required')
  expect(calls).toHaveLength(before)
})

it('does not treat catalog access as inference success and sanitizes terminal failure', async () => {
  responseError = true
  const result = await validateOpenAiConnection({ apiKey:'controlled-key', baseUrl, model:'gpt-fixture' })
  expect(result.success).toBe(false)
  expect(result.error).not.toContain('controlled-key')
  expect(result.error).not.toContain('fixture-secret')
  responseError = false
}, 30000)
