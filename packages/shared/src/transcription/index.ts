import { z } from 'zod'
import { getConnection, getCredential, type ConnectionContext } from '../connections/index.ts'
import { domainError } from '../utils/errors.ts'

/**
 * Transcription: dictation audio in, text out. No tables. The audio is only forwarded to the provider, never stored or logged.
 *
 * The key is the `openrouter` connection the caller's context sees (their own, the workspace's, then the install's), read
 * through the connections domain; with none, `runTranscription` throws the typed `not_configured` error. Failures carry a
 * coarse code only (`timeout`, `unavailable`, `failed`): a provider body can echo audio-derived text or credentials.
 */

export const TRANSCRIPTION_CONNECTION_SLUG = 'openrouter'
export const TRANSCRIPTION_MODEL = 'mistralai/voxtral-mini-transcribe'
/** About 0.5 MB a minute of Opus: this is roughly twenty minutes of speech. */
export const TRANSCRIPTION_MAX_BYTES = 10 * 1024 * 1024
export const TRANSCRIPTION_ERROR_CODES = ['not_configured', 'too_large', 'invalid', 'timeout', 'unavailable', 'failed'] as const
export type TranscriptionErrorCode = (typeof TRANSCRIPTION_ERROR_CODES)[number]

const TIMEOUT_MS = 20_000
const HEDGE_AFTER_MS = 1_500
const BASE = 'https://openrouter.ai/api/v1'

type Failure = 'timeout' | 'unavailable' | 'failed'
class ProviderError extends Error {
  constructor(readonly reason: Failure) {
    super(`Transcription ${reason}`)
  }
}
const transient = (error: unknown) => error instanceof ProviderError && error.reason !== 'failed'
const response = z.object({ text: z.string() })

/**
 * Speech to text through an OpenRouter model. A slow first request is hedged with a second one after 1.5 s and a transient
 * failure is retried once; the first success wins and cancels the other.
 */
async function transcribeWithOpenRouter(audio: Blob, config: { apiKey: string; model: string }, request: typeof fetch): Promise<string> {
  async function attempt(signal: AbortSignal) {
    const body = new FormData()
    body.set('model', config.model)
    body.set('file', audio, 'voice-input')
    let reply: Response
    try {
      reply = await request(`${BASE}/audio/transcriptions`, { method: 'POST', redirect: 'error', signal, headers: { Authorization: `Bearer ${config.apiKey}` }, body })
    } catch {
      throw new ProviderError(signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError' ? 'timeout' : 'unavailable')
    }
    if (!reply.ok) {
      await reply.body?.cancel()
      throw new ProviderError(reply.status === 429 || reply.status >= 500 ? 'unavailable' : 'failed')
    }
    const parsed = response.safeParse(await reply.json().catch(() => null))
    if (!parsed.success) throw new ProviderError('failed')
    return parsed.data.text
  }

  const cancel = new AbortController()
  const signal = AbortSignal.any([AbortSignal.timeout(TIMEOUT_MS), cancel.signal])
  let hedge: ReturnType<typeof setTimeout> | undefined
  const slow = new Promise<void>((resolve) => {
    hedge = setTimeout(resolve, HEDGE_AFTER_MS)
  })
  const first = attempt(signal)
  // The second request starts when the first is slow or fails transiently, never after a success.
  const second = Promise.race([
    slow,
    first.then(
      () => new Promise<never>(() => {}),
      (error: unknown) => (transient(error) ? undefined : Promise.reject(error)),
    ),
  ]).then(() => attempt(signal))
  try {
    return await Promise.any([first, second])
  } catch (error) {
    throw error instanceof AggregateError ? error.errors.at(-1) : error
  } finally {
    clearTimeout(hedge)
    cancel.abort()
  }
}

/** The OpenRouter key this context may use, or undefined. */
export function getTranscriptionKey(where: ConnectionContext): string | undefined {
  const connection = getConnection(TRANSCRIPTION_CONNECTION_SLUG, where)
  return connection ? getCredential(connection.slug, connection.scope)?.apiKey || undefined : undefined
}

export type TranscriptionDeps = {
  /** Where the key comes from (default: the connections domain); tests pass a fake. */
  getKey?: (where: ConnectionContext) => string | undefined
  request?: typeof fetch
}

/**
 * Transcribes one recording (the chunks of a take, joined) to text; the text is empty when no speech was found.
 * Throws a `domainError` whose code is one of `TRANSCRIPTION_ERROR_CODES`.
 */
export async function runTranscription(where: ConnectionContext, audio: Uint8Array<ArrayBuffer>, type: string, deps: TranscriptionDeps = {}): Promise<string> {
  if (!type.startsWith('audio/') || audio.byteLength === 0) throw domainError('invalid', 'Send a recording as audio/*')
  if (audio.byteLength > TRANSCRIPTION_MAX_BYTES) throw domainError('too_large', 'The recording is too long')
  const apiKey = (deps.getKey ?? getTranscriptionKey)(where)
  if (!apiKey) throw domainError('not_configured', 'Dictation needs an OpenRouter connection')
  try {
    const text = await transcribeWithOpenRouter(new Blob([audio], { type }), { apiKey, model: TRANSCRIPTION_MODEL }, deps.request ?? fetch)
    return text.trim()
  } catch (error) {
    const reason: Failure = error instanceof ProviderError ? error.reason : 'failed'
    throw domainError(reason, `Transcription ${reason}`)
  }
}
