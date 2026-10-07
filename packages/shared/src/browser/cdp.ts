/**
 * A minimal Chrome DevTools Protocol client over one browser WebSocket (flat sessions), enough for the agent's
 * browser (`agent-browser.ts`). No dependency: Bun's WebSocket and JSON.
 */

type Pending = { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
type Listener = (params: any, sessionId?: string) => void

export class CdpError extends Error {}

export class CdpConnection {
  private nextId = 0
  private readonly pending = new Map<number, Pending>()
  private readonly listeners = new Map<string, Set<Listener>>()
  private closedError: Error | null = null

  private constructor(private readonly ws: WebSocket, private readonly timeoutMs: number) {
    ws.addEventListener('message', (event) => this.onMessage(String(event.data)))
    ws.addEventListener('close', () => this.fail(new CdpError('The browser connection closed')))
    ws.addEventListener('error', () => this.fail(new CdpError('The browser connection failed')))
  }

  /** Connects to `webSocketDebuggerUrl` (the browser endpoint from `/json/version`). */
  static connect(wsUrl: string, timeoutMs = 30_000): Promise<CdpConnection> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl)
      const timer = setTimeout(() => { ws.close(); reject(new CdpError(`No answer from the browser at ${wsUrl}`)) }, timeoutMs)
      ws.addEventListener('open', () => { clearTimeout(timer); resolve(new CdpConnection(ws, timeoutMs)) }, { once: true })
      ws.addEventListener('error', () => { clearTimeout(timer); reject(new CdpError(`Cannot connect to the browser at ${wsUrl}`)) }, { once: true })
    })
  }

  get closed(): boolean {
    return this.closedError !== null
  }

  send<T = any>(method: string, params: Record<string, unknown> = {}, sessionId?: string, timeoutMs = this.timeoutMs): Promise<T> {
    if (this.closedError) return Promise.reject(this.closedError)
    const id = ++this.nextId
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new CdpError(`${method} timed out after ${timeoutMs} ms`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    })
  }

  /** Listen to an event (`Page.loadEventFired`, ...); returns the unsubscribe function. */
  on(method: string, listener: Listener): () => void {
    let set = this.listeners.get(method)
    if (!set) this.listeners.set(method, (set = new Set()))
    set.add(listener)
    return () => set!.delete(listener)
  }

  close(): void {
    this.fail(new CdpError('The browser connection closed'))
    try { this.ws.close() } catch { /* already closed */ }
  }

  private onMessage(data: string): void {
    let msg: { id?: number; result?: unknown; error?: { message?: string }; method?: string; params?: unknown; sessionId?: string }
    try { msg = JSON.parse(data) } catch { return }
    if (typeof msg.id === 'number') {
      const pending = this.pending.get(msg.id)
      if (!pending) return
      this.pending.delete(msg.id)
      clearTimeout(pending.timer)
      if (msg.error) pending.reject(new CdpError(msg.error.message ?? 'CDP error'))
      else pending.resolve(msg.result ?? {})
      return
    }
    if (msg.method) for (const listener of this.listeners.get(msg.method) ?? []) listener(msg.params, msg.sessionId)
  }

  private fail(error: Error): void {
    if (this.closedError) return
    this.closedError = error
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }
}

/** The browser's WebSocket endpoint from its HTTP endpoint (`http://127.0.0.1:<port>`). */
export async function getBrowserWsUrl(httpUrl: string, timeoutMs = 5_000): Promise<string> {
  const response = await fetch(`${httpUrl}/json/version`, { signal: AbortSignal.timeout(timeoutMs) })
  if (!response.ok) throw new CdpError(`The browser at ${httpUrl} answered HTTP ${response.status}`)
  const body = await response.json() as { webSocketDebuggerUrl?: string }
  if (!body.webSocketDebuggerUrl) throw new CdpError(`The browser at ${httpUrl} gave no WebSocket endpoint`)
  return body.webSocketDebuggerUrl
}
