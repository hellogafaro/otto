/**
 * The agent's browser: always Fortress (fortress.ts), one per agent, driven over CDP from the server.
 * - With a box (`DockerComputer`): the Fortress `start.sh` runs in the box, its CDP published on the server's
 *   127.0.0.1 only (`hostPort(CDP_PORT)`).
 * - Without one: a Fortress process on the server host (`OTTO_FORTRESS_PATH` or `fortress` on the PATH), headless,
 *   CDP on a free loopback port, the agent's profile under `CONFIG_DIR/agents/<id>/fortress-profile`.
 * Each chat gets its own browser context and page (the `--session <chat_id>` rule): chats browse in parallel without
 * sharing cookies or tabs.
 */

import { join } from 'node:path'
import { resolveConfigDir } from '../config/paths.ts'
import { CDP_PORT } from '../computer/docker.ts'
import type { Computer } from '../computer/types.ts'
import { CdpConnection, getBrowserWsUrl } from './cdp.ts'
import { FortressNotInstalledError, findFortress, launchFortress, type LocalFortress } from './fortress.ts'
import { BrowserPage } from './page.ts'

interface ChatPage {
  contextId: string
  targetId: string
  sessionId: string
  page: BrowserPage
}

/** Where the browser's CDP HTTP endpoint is; may start the box or the local Fortress. */
export type BrowserEndpoint = () => Promise<string>

export class AgentBrowser {
  private conn: CdpConnection | null = null
  private connecting: Promise<CdpConnection> | null = null
  private readonly chats = new Map<string, ChatPage>()
  private readonly opening = new Map<string, Promise<ChatPage>>()
  private readonly commands = new Map<string, Promise<unknown>>()
  private readonly blocked = new Set<string>()
  private readonly contexts = new Map<string, string>()

  constructor(private readonly endpoint: BrowserEndpoint) {}

  private async connection(): Promise<CdpConnection> {
    if (this.conn && !this.conn.closed) return this.conn
    if (this.conn?.closed && this.contexts.size) {
      for (const chatId of this.contexts.keys()) this.blocked.add(chatId)
      throw new Error('The browser connection closed with live contexts; scoped disposal was not confirmed.')
    }
    this.connecting ??= (async () => {
      const conn = await CdpConnection.connect(await getBrowserWsUrl(await this.endpoint()))
      // A new browser (the box restarted, Fortress crashed): every chat's context is gone with the old one.
      this.chats.clear()
      conn.on('Target.detachedFromTarget', (params: { sessionId?: string }) => {
        for (const [chatId, chat] of this.chats) if (chat.sessionId === params.sessionId) this.chats.delete(chatId)
      })
      this.conn = conn
      return conn
    })().finally(() => { this.connecting = null })
    return this.connecting
  }

  /** The chat's page, created on first use in its own browser context. */
  async page(chatId: string): Promise<BrowserPage> {
    if (this.blocked.has(chatId)) throw new Error('This chat browser is blocked because context disposal failed.')
    const conn = await this.connection()
    const known = this.chats.get(chatId)
    if (known) return known.page
    let opening = this.opening.get(chatId)
    if (!opening) {
      opening = (async () => {
        const { browserContextId } = await conn.send<{ browserContextId: string }>('Target.createBrowserContext', { disposeOnDetach: false })
        this.contexts.set(chatId, browserContextId)
        const { targetId } = await conn.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank', browserContextId, newWindow: true })
        const { sessionId } = await conn.send<{ sessionId: string }>('Target.attachToTarget', { targetId, flatten: true })
        const page = new BrowserPage({
          send: (method, params, timeoutMs, signal) => conn.send(method, params ?? {}, sessionId, timeoutMs, signal),
          on: (method, listener) => conn.on(method, (params, sid) => { if (sid === sessionId) listener(params) }),
        })
        const chat = { contextId: browserContextId, targetId, sessionId, page }
        this.chats.set(chatId, chat)
        await page.init()
        return chat
      })().finally(() => this.opening.delete(chatId))
      this.opening.set(chatId, opening)
    }
    return (await opening).page
  }

  hasPage(chatId: string): boolean {
    return this.chats.has(chatId)
  }

  async run<T>(chatId: string, execution: { signal: AbortSignal; assertAccess: () => void }, action: (page: BrowserPage) => Promise<T>): Promise<T> {
    const previous = this.commands.get(chatId) ?? Promise.resolve()
    const running = previous.catch(() => {}).then(async () => {
      execution.signal.throwIfAborted()
      execution.assertAccess()
      try {
        const page = await this.page(chatId)
        return await page.runGuarded(execution, () => action(page))
      } catch (error) {
        await this.close(chatId)
        throw error
      }
    })
    this.commands.set(chatId, running)
    try {
      return await running
    } finally {
      if (this.commands.get(chatId) === running) this.commands.delete(chatId)
    }
  }

  /** Closes the chat's context (its tabs, cookies and storage). */
  async close(chatId: string): Promise<boolean> {
    await this.opening.get(chatId)?.catch(() => {})
    const contextId = this.contexts.get(chatId)
    if (!contextId) return false
    try {
      if (!this.conn || this.conn.closed) throw new Error('The browser connection closed before context disposal was confirmed.')
      await this.conn.send('Target.disposeBrowserContext', { browserContextId: contextId })
      this.chats.delete(chatId)
      this.contexts.delete(chatId)
    } catch {
      this.blocked.add(chatId)
      throw new Error('Browser context disposal failed; this chat browser is blocked. The action may have run.')
    }
    return true
  }

  dispose(): void {
    this.chats.clear()
    this.conn?.close()
    this.conn = null
  }
}

/** A box publishes its CDP port; anything else runs the browser on the server host. */
function isBox(computer: Computer | null): computer is Computer & { hostPort(port: number): Promise<number | null> } {
  return !!computer && typeof (computer as { hostPort?: unknown }).hostPort === 'function'
}

const browsers = new Map<string, AgentBrowser>()
const localFortress = new Map<string, Promise<LocalFortress>>()

/** The local Fortress of an agent, started once; a missing binary is FortressNotInstalledError. */
function localEndpoint(agentId: string, o: { profileDir?: string; env?: NodeJS.ProcessEnv }): BrowserEndpoint {
  return async () => {
    let running = localFortress.get(agentId)
    if (!running) {
      const binary = findFortress(o.env)
      if (!binary) throw new FortressNotInstalledError()
      running = launchFortress({ binary, profileDir: o.profileDir ?? join(resolveConfigDir(), 'agents', agentId, 'fortress-profile'), env: o.env })
      running.catch(() => localFortress.delete(agentId))
      localFortress.set(agentId, running)
    }
    try {
      const fortress = await running
      await getBrowserWsUrl(fortress.httpUrl, 2_000)
      return fortress.httpUrl
    } catch (error) {
      // It died since: start a new one next time.
      if (localFortress.get(agentId) === running) {
        localFortress.delete(agentId)
        void running.then((f) => f.stop(), () => {})
      }
      throw error
    }
  }
}

/** The agent's browser: in its box when it has one, else Fortress on the server host. */
export function getAgentBrowser(agentId: string, computer: Computer | null, o: { profileDir?: string; env?: NodeJS.ProcessEnv } = {}): AgentBrowser {
  const key = `${isBox(computer) ? `box:${computer.id}` : 'local'}:${agentId}`
  let browser = browsers.get(key)
  if (!browser) {
    const endpoint: BrowserEndpoint = isBox(computer)
      ? async () => {
          await computer.ensureRunning()
          const port = await computer.hostPort(CDP_PORT)
          if (!port) throw new Error('The computer publishes no browser port; is it the otto-agent image?')
          return `http://127.0.0.1:${port}`
        }
      : localEndpoint(agentId, o)
    browsers.set(key, (browser = new AgentBrowser(endpoint)))
  }
  return browser
}

/** Stops every local Fortress and drops every connection (server shutdown, tests). */
export function disposeAgentBrowsers(): void {
  for (const browser of browsers.values()) browser.dispose()
  browsers.clear()
  for (const running of localFortress.values()) void running.then((f) => f.stop(), () => {})
  localFortress.clear()
}
