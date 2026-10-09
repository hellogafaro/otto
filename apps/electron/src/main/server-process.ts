/**
 * The desktop's server: the headless server (`packages/server`) as a child process under Bun (docs/desktop.md).
 * Main has no database; it starts the child, waits until it answers, keeps one connection of its own to it (the
 * workspace list, a few settings, badge and keep-awake events) and stops it on quit. The windows connect to it like
 * the web UI does. The child gets a free 127.0.0.1 port, a per-launch token that acts as the install's one user
 * (`OTTO_LOCAL_USER`), and `ENCRYPTION_KEY` in its environment only.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { Workspace } from '@otto/core/types'
import { RPC_CHANNELS } from '@otto/shared/protocol'
import type { SettingKey, SettingValue } from '@otto/shared/settings'
import { WsRpcClient } from '@otto/server-core/transport'
import { mainLog } from './logger'

export interface ServerConnection {
  url: string
  token: string
}

const READY_TIMEOUT_MS = 60_000
const STOP_TIMEOUT_MS = 8_000
/** What the error window shows of the child's output. */
const KEPT_LINES = 30

let child: ChildProcess | null = null
let connection: ServerConnection | null = null
let client: WsRpcClient | null = null
let stopping = false
let output: string[] = []
let workspaces: Workspace[] = []

/** The child's executable and entry: the bundled `dist/server.js` under the shipped Bun, or the source in dev. */
function getServerCommand(): { bun: string; entry: string } {
  if (app.isPackaged) {
    if (!process.env.OTTO_BUN) throw new Error(`The bundled Bun runtime is missing (vendor/bun in ${process.resourcesPath})`)
    return { bun: process.env.OTTO_BUN, entry: join(__dirname, 'server.js') }
  }
  return { bun: process.env.OTTO_BUN ?? 'bun', entry: join(__dirname, '..', '..', '..', 'packages', 'server', 'src', 'index.ts') }
}

function keepOutput(chunk: Buffer, onUrl: (url: string) => void): void {
  // Without terminal escapes (drizzle-kit draws a spinner while it pushes the schema)
  for (const line of chunk.toString().replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').split('\n')) {
    if (!line.trim()) continue
    // The token line is the child's own echo of what main passed: never logged or shown.
    if (line.startsWith('OTTO_SERVER_TOKEN=')) continue
    const url = line.match(/^OTTO_SERVER_URL=(\S+)/)?.[1]
    if (url) onUrl(url)
    output.push(line)
    if (output.length > KEPT_LINES) output.shift()
    mainLog.info(`[server] ${line}`)
  }
}

/**
 * Start the child and resolve once it answers on its port (main's own connection is up).
 * `onExit` runs when it stops on its own (a crash, a refused start); not when main stops it.
 */
export async function initServer(secrets: { ENCRYPTION_KEY?: string }, onExit: (reason: string, lastLines: string[]) => void): Promise<ServerConnection> {
  const { bun, entry } = getServerCommand()
  if (!existsSync(entry)) throw new Error(`The server is missing at ${entry}`)
  const token = randomBytes(24).toString('hex')
  output = []
  stopping = false
  const proc = spawn(bun, [entry], {
    env: {
      ...process.env,
      ENCRYPTION_KEY: secrets.ENCRYPTION_KEY,
      OTTO_LOCAL_USER: '1',
      OTTO_SERVER_TOKEN: token,
      OTTO_RPC_HOST: '127.0.0.1',
      OTTO_RPC_PORT: '0',
      // Signs sessions this app never opens (the local user has no sign-in)
      BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
      OTTO_BUNDLED_ASSETS_ROOT: __dirname,
      OTTO_RESOURCES_PATH: process.resourcesPath,
      OTTO_VERSION: app.getVersion(),
    },
    // stdin stays open: the child stops when it closes (main gone without a clean quit)
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  child = proc
  proc.once('exit', () => {
    if (child === proc) child = null
  })

  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`The server did not start within ${READY_TIMEOUT_MS / 1000} s`)), READY_TIMEOUT_MS)
    const onUrl = (found: string) => (clearTimeout(timer), resolve(found))
    proc.stdout!.on('data', (chunk: Buffer) => keepOutput(chunk, onUrl))
    proc.stderr!.on('data', (chunk: Buffer) => keepOutput(chunk, () => {}))
    proc.once('error', (error) => (clearTimeout(timer), reject(error)))
    proc.once('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`The server stopped while starting (exit ${code}). Last lines of its log:\n\n${output.slice(-8).join('\n')}`))
    })
  })
  proc.on('exit', (code, signal) => {
    client?.destroy()
    client = null
    connection = null
    if (!stopping) onExit(signal ? `signal ${signal}` : `exit code ${code}`, [...output])
  })

  connection = { url, token }
  client = new WsRpcClient(url, { token, autoReconnect: true, mode: 'local' })
  await new Promise<void>((resolve, reject) => {
    const unsubscribe = client!.onConnectionStateChanged((state) => {
      if (state.status === 'connected') (unsubscribe(), resolve())
      else if (state.status === 'failed') (unsubscribe(), reject(new Error(state.lastError?.message ?? 'The server did not answer')))
    })
    client!.connect()
  })
  return connection
}

/** SIGTERM (the server flushes chats and exits), then SIGKILL after a timeout. */
export async function stopServer(): Promise<void> {
  const proc = child
  if (!proc) return
  stopping = true
  client?.destroy()
  client = null
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      mainLog.warn('[server] did not stop in time, killing it')
      proc.kill('SIGKILL')
    }, STOP_TIMEOUT_MS)
    proc.once('exit', () => (clearTimeout(timer), resolve()))
    proc.kill('SIGTERM')
  })
  child = null
  connection = null
}

/** Where the windows reach the server; null when it is not running (or this app is a thin client). */
export const getServerConnection = (): ServerConnection | null => connection

/** Call a channel on the server as the local user. */
export function invokeServer<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  if (!client) return Promise.reject(new Error('The server is not running'))
  return client.invoke(channel, ...args) as Promise<T>
}

/** Listen to a server push on main's own connection. */
export function onServerEvent(channel: string, callback: (...args: any[]) => void): () => void {
  return client ? client.on(channel, callback) : () => {}
}

export const getInstallSetting = <K extends SettingKey<'install'>>(key: K) =>
  invokeServer<SettingValue<K>>(RPC_CHANNELS.settings.GET_SETTING, 'install', key)

export const updateInstallSetting = <K extends SettingKey<'install'>>(key: K, value: SettingValue<K>) =>
  invokeServer(RPC_CHANNELS.settings.UPDATE_SETTING, 'install', key, value)

/** The local workspaces, asked from the server and remembered for the synchronous callers (window titles, the preload). */
export async function getWorkspaces(): Promise<Workspace[]> {
  workspaces = await invokeServer<Workspace[]>(RPC_CHANNELS.workspaces.GET)
  return workspaces
}

/** A workspace as the server last listed it. */
export const getKnownWorkspace = (id: string): Workspace | undefined => workspaces.find((workspace) => workspace.id === id)
