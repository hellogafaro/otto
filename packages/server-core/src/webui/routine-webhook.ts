import type { IncomingMessage, ServerResponse } from 'node:http'
import { webhookSecretMatches } from '@otto/shared/automations/routine-webhook'
import { isNativeRoutineConfigSupported, UNSUPPORTED_NATIVE_ROUTINE, type RoutineRunnerDeps } from '@otto/shared/automations/routine-runner'
import { ROUTINE_WEBHOOK_PATH } from '@otto/shared/automations/routine-types'
import { getWebhookRoutine } from '@otto/shared/automations/routines'
import { initDb } from '@otto/shared/db'
import { getSecret } from '@otto/shared/secrets'

/**
 * `POST /api/webhooks/<routine_id>/<secret>`: the webhook trigger of a routine (docs/final-plan.md 2.8). The URL
 * is the credential, so there is no session: a wrong secret, an unknown routine and a routine that is not a webhook
 * all answer the same 404, and the secret is compared in constant time. A paused routine answers 409 and too many
 * calls answer 429. Native webhook activation is unsupported: an authenticated active routine
 * answers 501 without reading its body, creating a run, or executing an action. Stored configuration is retained.
 * One audit line per call: the routine and the outcome, never the secret.
 */

/** Calls a routine takes per minute, and wrong secrets one address may try per minute. */
export const ROUTINE_HOOK_RATE = { windowMs: 60_000, calls: 60, misses: 30 }

type NodeHandler = (req: IncomingMessage, res: ServerResponse) => void

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

const fail = (res: ServerResponse, status: number, code: string, message: string) => send(res, status, { error: { code, message } })

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
    if (!routine || isNativeRoutineConfigSupported(routine.config) || !webhookSecretMatches(given, expected)) {
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

    audit(`[routine-webhook] routine=${routine.id} -> unsupported`)
    return fail(res, 501, 'unsupported', UNSUPPORTED_NATIVE_ROUTINE)
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
