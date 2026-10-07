import type { IncomingMessage, ServerResponse } from 'node:http'
import { MAX_HOOK_BODY_BYTES, webhookSecretMatches, withWebhookContext } from '@otto/shared/automations/routine-webhook'
import { runRoutine, type RoutineRunnerDeps } from '@otto/shared/automations/routine-runner'
import { ROUTINE_WEBHOOK_PATH } from '@otto/shared/automations/routine-types'
import { getWebhookRoutine } from '@otto/shared/automations/routines'
import { initDb } from '@otto/shared/db'
import { getSecret } from '@otto/shared/secrets'

/**
 * `POST /api/webhooks/<routine_id>/<secret>`: the webhook trigger of a routine (docs/final-plan.md 2.8). The URL
 * is the credential, so there is no session: a wrong secret, an unknown routine and a routine that is not a webhook
 * all answer the same 404, and the secret is compared in constant time. A paused routine answers 409, a body over
 * 256 KB 413, too many calls 429. A call starts a run as the routine's creator on its agent, with the body passed to
 * its prompts as escaped, size-capped data (`withWebhookContext`), and answers 202 `{ id }`, the run's history id.
 * One audit line per call: the routine and the outcome, never the secret.
 */

/** Calls a routine takes per minute, and wrong secrets one address may try per minute. */
export const ROUTINE_HOOK_RATE = { windowMs: 60_000, calls: 60, misses: 30 }

type NodeHandler = (req: IncomingMessage, res: ServerResponse) => void

class TooLarge extends Error {}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

const fail = (res: ServerResponse, status: number, code: string, message: string) => send(res, status, { error: { code, message } })

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_HOOK_BODY_BYTES) {
        reject(new TooLarge())
        req.destroy()
      } else chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** A fixed window per key; `take` is false once the key used up its `max`. */
function windows(max: number) {
  const byKey = new Map<string, { start: number; count: number }>()
  return {
    used: (key: string, now: number) => {
      const window = byKey.get(key)
      return window && now - window.start < ROUTINE_HOOK_RATE.windowMs ? window.count : 0
    },
    take(key: string, now: number): boolean {
      let window = byKey.get(key)
      if (!window || now - window.start >= ROUTINE_HOOK_RATE.windowMs) {
        if (byKey.size > 1000) for (const [other, old] of byKey) if (now - old.start >= ROUTINE_HOOK_RATE.windowMs) byKey.delete(other)
        byKey.set(key, (window = { start: now, count: 0 }))
      }
      return ++window.count <= max
    },
  }
}

/**
 * The HTTP handler for the RPC port: the hook path here, every other request to `next`, else 404. `runner` is read per
 * call (the session manager is built after the HTTP server); its `db` and `getSecret` are what the lookup uses.
 */
export function createRoutineWebhookHandler(opts: { runner: () => RoutineRunnerDeps; audit: (line: string) => void; next?: NodeHandler }): NodeHandler {
  const { runner, audit, next } = opts
  const calls = windows(ROUTINE_HOOK_RATE.calls)
  const misses = windows(ROUTINE_HOOK_RATE.misses)

  async function handle(req: IncomingMessage, res: ServerResponse, routineId: string, given: string): Promise<void> {
    if (req.method !== 'POST') return fail(res, 405, 'method_not_allowed', 'POST only')
    const now = Date.now()
    const from = req.socket.remoteAddress ?? '?'
    // Guessing is capped per address before anything is looked up
    if (misses.used(from, now) >= ROUTINE_HOOK_RATE.misses) return fail(res, 429, 'rate_limited', 'Too many attempts')

    const deps = runner()
    const routine = getWebhookRoutine(routineId, deps.db ?? initDb())
    const expected = routine?.config.webhook ? (deps.getSecret ?? getSecret)(routine.config.webhook.secretId) : undefined
    if (!routine || !webhookSecretMatches(given, expected)) {
      misses.take(from, now)
      audit(`[routine-webhook] routine=${routineId} -> not_found`)
      return fail(res, 404, 'not_found', 'Not Found')
    }
    if (!calls.take(routine.id, now)) {
      audit(`[routine-webhook] routine=${routine.id} -> rate_limited`)
      return fail(res, 429, 'rate_limited', `At most ${ROUTINE_HOOK_RATE.calls} calls a minute`)
    }
    if (routine.pausedAt !== null) {
      audit(`[routine-webhook] routine=${routine.id} -> paused`)
      return fail(res, 409, 'conflict', 'The routine is paused')
    }

    let body: string
    try {
      if (Number(req.headers['content-length'] ?? 0) > MAX_HOOK_BODY_BYTES) throw new TooLarge()
      body = await readBody(req)
    } catch (error) {
      audit(`[routine-webhook] routine=${routine.id} -> ${error instanceof TooLarge ? 'too_large' : 'unreadable'}`)
      return error instanceof TooLarge ? fail(res, 413, 'too_large', `The body is limited to ${MAX_HOOK_BODY_BYTES / 1024} KB`) : fail(res, 400, 'invalid', 'The body could not be read')
    }

    // Runs as the routine's creator on its agent; `scheduledFor` is the request time (one more millisecond when taken)
    const started = runRoutine(withWebhookContext(routine, body), deps)
    if (!started) return fail(res, 409, 'conflict', 'The routine could not start a run')
    void started.done
    audit(`[routine-webhook] routine=${routine.id} run=${started.run.id} bytes=${Buffer.byteLength(body)} -> accepted`)
    send(res, 202, { id: started.run.id })
  }

  return (req, res) => {
    const pathname = (req.url ?? '').split('?')[0]!
    if (!pathname.startsWith(`${ROUTINE_WEBHOOK_PATH}/`)) {
      if (next) return next(req, res)
      return fail(res, 404, 'not_found', 'Not Found')
    }
    const [routineId, given, ...extra] = pathname.slice(ROUTINE_WEBHOOK_PATH.length + 1).split('/')
    if (!routineId || !given || extra.length) return fail(res, 404, 'not_found', 'Not Found')
    handle(req, res, routineId, given).catch((error) => {
      audit(`[routine-webhook] failed: ${error instanceof Error ? error.message : String(error)}`)
      if (!res.headersSent) fail(res, 500, 'error', 'The call failed')
    })
  }
}
