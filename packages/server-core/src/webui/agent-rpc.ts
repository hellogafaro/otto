import type { IncomingMessage, ServerResponse } from 'node:http'
import { getRunByToken } from '@otto/shared/agent'
import { formatAgentCommands, getAgentCommand, RPC_CHANNELS } from '@otto/shared/protocol'
import { getChatWorkspaceId } from '@otto/shared/sessions'
import { isDomainError } from '@otto/shared/utils'
import { WORKSPACE_ARG_CHANNELS } from '../bootstrap/authorize'
import { SESSION_ID_CHANNELS } from '../handlers/rpc/session-guard'
import type { RequestContext } from '../transport/types'

/**
 * `POST /api/agent/rpc`: what an agent's `otto` CLI calls (docs/final-plan.md PT). The bearer is the turn's run token
 * (`@otto/shared/agent` run-tokens), never a user's session. The body is the CLI's argv (`{ argv: [...] }`); the command
 * must be in the agent channel table (`AGENT_COMMANDS`), and it runs through `invoke` (the RPC server's own dispatch:
 * the membership guard, the session guard and the handler) as the run's user in the run's workspace.
 * Answers `{ result }` or `{ error: { code, message } }`, and writes one audit line per call: the run, chat, agent,
 * user and channel, never an argument or the token.
 */

export const AGENT_RPC_PATH = '/api/agent/rpc'

/** A library file of MAX_FILE_BYTES as base64, with its JSON around it. */
const MAX_BODY_BYTES = 70 * 1024 * 1024
/** Calls one run may make per minute. */
export const AGENT_RPC_RATE = { windowMs: 60_000, max: 120 }

type NodeHandler = (req: IncomingMessage, res: ServerResponse) => void
export type AgentRpcInvoke = (ctx: RequestContext, channel: string, args: unknown[]) => Promise<unknown>

const STATUS: Record<string, number> = { unauthorized: 401, forbidden: 403, not_found: 404, unknown_command: 404, invalid: 400, conflict: 409, too_large: 413, rate_limited: 429 }

class AgentRpcError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new AgentRpcError('too_large', 'The request is too large'))
        req.destroy()
      } else chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** A CLI argument: JSON when it starts with `{` or `[`, else the string as typed. */
function parseArg(arg: string, index: number): unknown {
  if (!/^\s*[[{]/.test(arg)) return arg
  try {
    return JSON.parse(arg)
  } catch {
    throw new AgentRpcError('invalid', `Argument ${index + 1} starts like JSON but is not valid JSON`)
  }
}

/** The channel and its arguments for an argv, bound to the run's workspace and chat. */
function resolveCall(argv: unknown, run: { workspaceId: string; chatId: string }): { name: string; channel: string; args: unknown[] } {
  if (!Array.isArray(argv) || argv.some((arg) => typeof arg !== 'string')) throw new AgentRpcError('invalid', 'argv must be a list of strings')
  const found = getAgentCommand(argv as string[])
  if (!found) throw new AgentRpcError('unknown_command', `Unknown command. Run \`otto help\` for the list.`)
  const { name, command } = found
  const required = command.args.filter((arg) => arg.startsWith('<')).length
  if (found.args.length < required || found.args.length > command.args.length) {
    throw new AgentRpcError('invalid', `Usage: otto ${[name, ...command.args].join(' ')}`)
  }
  const args = found.args.map(parseArg)
  const only = command.only
  if (only && args[0] !== undefined) {
    if (typeof args[0] !== 'object' || args[0] === null || Array.isArray(args[0])) throw new AgentRpcError('invalid', 'The first argument must be a JSON object')
    args[0] = Object.fromEntries(Object.entries(args[0]).filter(([key]) => only.includes(key)))
  }
  const channel = command.channel
  // The agent never names a workspace: a channel that takes one gets the run's.
  if (WORKSPACE_ARG_CHANNELS.get(channel) === 0) args.unshift(run.workspaceId)
  if (SESSION_ID_CHANNELS.has(channel)) {
    // Chats of another workspace look like chats that do not exist (the session guard answers the same for another user's).
    if (typeof args[0] !== 'string' || getChatWorkspaceId(args[0]) !== run.workspaceId) throw new AgentRpcError('not_found', `Session not found: ${String(args[0])}`)
    if (channel === RPC_CHANNELS.sessions.SEND_MESSAGE && args[0] === run.chatId) throw new AgentRpcError('invalid', 'An agent cannot send a message to its own chat')
  }
  return { name, channel, args }
}

/**
 * The HTTP handler for the RPC port: `AGENT_RPC_PATH` here, every other request to `next` (the web UI, when served),
 * else 404. `invoke` is the RPC server's dispatch (`WsRpcServer.invoke`); `audit` writes the server's log.
 */
export function createAgentRpcHandler(opts: { invoke: AgentRpcInvoke; audit: (line: string) => void; next?: NodeHandler }): NodeHandler {
  const { invoke, audit, next } = opts
  const windows = new Map<string, { start: number; count: number }>()

  /** False once the run used up its calls of the current minute. */
  const takeCall = (runId: string, now: number): boolean => {
    let window = windows.get(runId)
    if (!window || now - window.start >= AGENT_RPC_RATE.windowMs) {
      if (windows.size > 1000) for (const [id, old] of windows) if (now - old.start >= AGENT_RPC_RATE.windowMs) windows.delete(id)
      windows.set(runId, (window = { start: now, count: 0 }))
    }
    return ++window.count <= AGENT_RPC_RATE.max
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST') return send(res, 405, { error: { code: 'method_not_allowed', message: 'POST only' } })
    const header = req.headers.authorization
    const run = getRunByToken(typeof header === 'string' && header.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined)
    // Refused before the body is read; the token is never echoed or logged.
    if (!run) return send(res, 401, { error: { code: 'unauthorized', message: 'Invalid or expired run token' } })
    if (!takeCall(run.id, Date.now())) {
      audit(`[agent-rpc] run=${run.id} chat=${run.chatId} user=${run.userId} -> rate_limited`)
      return send(res, 429, { error: { code: 'rate_limited', message: `At most ${AGENT_RPC_RATE.max} calls a minute` } })
    }

    let call: { name: string; channel: string } | undefined
    let outcome = 'ok'
    try {
      if (Number(req.headers['content-length'] ?? 0) > MAX_BODY_BYTES) throw new AgentRpcError('too_large', 'The request is too large')
      const body = await readBody(req)
      let argv: unknown
      try {
        argv = (JSON.parse(body) as { argv?: unknown }).argv
      } catch {
        throw new AgentRpcError('invalid', 'The body must be JSON: { "argv": [...] }')
      }
      if (Array.isArray(argv) && (argv.length === 0 || argv[0] === 'help')) return send(res, 200, { result: formatAgentCommands() })
      const resolved = resolveCall(argv, run)
      call = resolved
      const ctx: RequestContext = { clientId: `agent-run:${run.id}`, userId: run.userId, workspaceId: run.workspaceId, webContentsId: null }
      const result = await invoke(ctx, resolved.channel, resolved.args)
      send(res, 200, { result: result ?? null })
    } catch (error) {
      const code = error instanceof AgentRpcError || isDomainError(error) ? (error as { code: string }).code : 'error'
      outcome = code
      send(res, STATUS[code] ?? 500, { error: { code, message: error instanceof Error ? error.message : 'The call failed' } })
    } finally {
      audit(`[agent-rpc] run=${run.id} chat=${run.chatId} agent=${run.agentId ?? '-'} user=${run.userId} command="${call?.name ?? '?'}" channel=${call?.channel ?? '-'} -> ${outcome}`)
    }
  }

  return (req, res) => {
    if ((req.url ?? '').split('?')[0] !== AGENT_RPC_PATH) {
      if (next) return next(req, res)
      return send(res, 404, { error: { code: 'not_found', message: 'Not Found' } })
    }
    handle(req, res).catch((error) => {
      audit(`[agent-rpc] failed: ${error instanceof Error ? error.message : String(error)}`)
      if (!res.headersSent) send(res, 500, { error: { code: 'error', message: 'The call failed' } })
    })
  }
}
