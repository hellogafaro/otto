import { describe, expect, it } from 'bun:test'
import { TRANSCRIPTION_MAX_BYTES, TRANSCRIPTION_MODEL, runTranscription } from './index.ts'

/** A local peer standing in for OpenRouter; each reply is decided per request number. */
function peer(reply: (n: number) => Promise<Response>) {
  const seen: { auth: string | null; model: unknown; size: number }[] = []
  const sink = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const form = await request.formData()
      const file = form.get('file')
      seen.push({ auth: request.headers.get('authorization'), model: form.get('model'), size: file instanceof Blob ? file.size : -1 })
      return reply(seen.length)
    },
  })
  const request: typeof fetch = Object.assign((_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => fetch(sink.url, init), { preconnect: fetch.preconnect })
  return { seen, request, stop: () => sink.stop(true) }
}
const ok = (text: string) => Promise.resolve(Response.json({ text }))
const audio = new Uint8Array(64)
const key = crypto.randomUUID() // a fake, never a real key
const where = { userId: 'u', workspaceId: 'w' }
const codeOf = (promise: Promise<unknown>) => promise.then(() => 'ok', (error: { code?: string; message: string }) => error.code)

describe('runTranscription', () => {
  it('sends the model and file with the bearer key found for this context, and trims the text', async () => {
    const p = peer(() => ok('  hello \n'))
    try {
      const asked: unknown[] = []
      const text = await runTranscription(where, audio, 'audio/webm', { getKey: (w) => (asked.push(w), key), request: p.request })
      expect(text).toBe('hello')
      expect(asked).toEqual([where])
      expect(p.seen).toEqual([{ auth: `Bearer ${key}`, model: TRANSCRIPTION_MODEL, size: 64 }])
    } finally {
      await p.stop()
    }
  })

  it('is typed not_configured without a key, and never calls the provider', async () => {
    const p = peer(() => ok('x'))
    try {
      expect(await codeOf(runTranscription(where, audio, 'audio/webm', { getKey: () => undefined, request: p.request }))).toBe('not_configured')
      expect(p.seen).toEqual([])
    } finally {
      await p.stop()
    }
  })

  it('refuses a recording that is empty, not audio or too large before looking for a key', async () => {
    const getKey = () => {
      throw new Error('asked for a key')
    }
    expect(await codeOf(runTranscription(where, new Uint8Array(0), 'audio/webm', { getKey }))).toBe('invalid')
    expect(await codeOf(runTranscription(where, audio, 'text/plain', { getKey }))).toBe('invalid')
    expect(await codeOf(runTranscription(where, new Uint8Array(TRANSCRIPTION_MAX_BYTES + 1), 'audio/webm', { getKey }))).toBe('too_large')
  })

  it('retries a transient failure once, does not retry a rejected request, and leaks no provider body', async () => {
    const flaky = peer((n) => (n === 1 ? Promise.resolve(new Response('provider detail', { status: 503 })) : ok('second')))
    const rejected = peer(() => Promise.resolve(new Response('provider detail', { status: 400 })))
    const down = peer(() => Promise.resolve(new Response('provider detail', { status: 429 })))
    try {
      expect(await runTranscription(where, audio, 'audio/webm', { getKey: () => key, request: flaky.request })).toBe('second')
      expect(flaky.seen.length).toBe(2)
      const error = await runTranscription(where, audio, 'audio/webm', { getKey: () => key, request: rejected.request }).catch((caught: unknown) => caught)
      expect((error as { code: string }).code).toBe('failed')
      expect((error as Error).message).not.toContain('provider detail')
      expect(rejected.seen.length).toBe(1)
      expect(await codeOf(runTranscription(where, audio, 'audio/webm', { getKey: () => key, request: down.request }))).toBe('unavailable')
    } finally {
      await Promise.all([flaky.stop(), rejected.stop(), down.stop()])
    }
  })

  it('hedges a slow first request and the faster second wins', async () => {
    const p = peer((n) => (n === 1 ? new Promise<Response>(() => {}) : ok('fast')))
    try {
      const started = Date.now()
      expect(await runTranscription(where, audio, 'audio/webm', { getKey: () => key, request: p.request })).toBe('fast')
      expect(p.seen.length).toBe(2)
      expect(Date.now() - started).toBeLessThan(5000)
    } finally {
      await p.stop()
    }
  })
})
