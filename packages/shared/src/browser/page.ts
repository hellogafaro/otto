/**
 * One chat's page in the agent's browser, driven over CDP: an accessibility snapshot with `@eN` refs, and actions
 * on those refs (the approach Playwright and Stagehand use; ported from the deleted Electron pane's BrowserCDP).
 */

export interface AccessibilityNode {
  ref: string
  role: string
  name: string
  value?: string
  description?: string
  focused?: boolean
  checked?: boolean
  disabled?: boolean
}

export interface AccessibilitySnapshot {
  url: string
  title: string
  nodes: AccessibilityNode[]
}

/** CDP bound to one page session. */
export interface PageCdp {
  send<T = any>(method: string, params?: Record<string, unknown>, timeoutMs?: number, signal?: AbortSignal): Promise<T>
  /** Listen to an event of this page; returns the unsubscribe function. */
  on(method: string, listener: (params: any) => void): () => void
}

const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'textbox', 'searchbox', 'combobox', 'checkbox', 'radio', 'switch', 'slider', 'spinbutton',
  'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'treeitem', 'row', 'cell', 'columnheader',
  'rowheader', 'gridcell',
])
const CONTENT_ROLES = new Set([
  'heading', 'img', 'table', 'list', 'listitem', 'paragraph', 'blockquote', 'article', 'main', 'navigation',
  'complementary', 'contentinfo', 'banner', 'form', 'region', 'alert', 'dialog', 'alertdialog', 'status',
  'progressbar', 'meter', 'timer',
])
const MAX_NODES = 500
const NAVIGATION_TIMEOUT_MS = 30_000

/** CDP key names for `key <name>`. */
const KEYS: Record<string, { key: string; code: string; keyCode: number; text?: string }> = {
  enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
  tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
  arrowup: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  arrowdown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  arrowleft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  arrowright: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  pageup: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
  pagedown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
  home: { key: 'Home', code: 'Home', keyCode: 36 },
  end: { key: 'End', code: 'End', keyCode: 35 },
  space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
}
const MODIFIERS: Record<string, number> = { alt: 1, control: 2, ctrl: 2, meta: 4, cmd: 4, shift: 8 }

export class BrowserPage {
  private refs = new Map<string, number>()
  private refByNode = new Map<number, string>()
  private nextRef = 0

  private readonly cdp: PageCdp
  private execution: { signal: AbortSignal; assertAccess: () => void } | null = null

  constructor(cdp: PageCdp) {
    this.cdp = {
      send: async (method, params, timeoutMs) => {
        const execution = this.execution
        execution?.signal.throwIfAborted()
        execution?.assertAccess()
        const result = await cdp.send(method, params, timeoutMs, execution?.signal)
        execution?.signal.throwIfAborted()
        execution?.assertAccess()
        return result
      },
      on: (method, listener) => cdp.on(method, listener),
    }
  }

  async runGuarded<T>(execution: { signal: AbortSignal; assertAccess: () => void }, action: () => Promise<T>): Promise<T> {
    if (this.execution) throw new Error('A browser command is already running on this page.')
    this.execution = execution
    let onAbort: (() => void) | undefined
    try {
      execution.signal.throwIfAborted()
      execution.assertAccess()
      const operation = action().finally(() => { this.execution = null })
      const aborted = new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(execution.signal.reason ?? new Error('aborted'))
        execution.signal.addEventListener('abort', onAbort, { once: true })
        if (execution.signal.aborted) onAbort()
      })
      const result = await Promise.race([operation, aborted])
      execution.signal.throwIfAborted()
      execution.assertAccess()
      return result
    } finally {
      if (onAbort) execution.signal.removeEventListener('abort', onAbort)
      else this.execution = null
    }
  }

  /** Turns on the domains the page needs; call once after attaching. */
  async init(): Promise<void> {
    await Promise.all([
      this.cdp.send('Page.enable'),
      this.cdp.send('Runtime.enable'),
      this.cdp.send('DOM.enable'),
      this.cdp.send('Accessibility.enable'),
    ])
  }

  async info(): Promise<{ url: string; title: string }> {
    const value = await this.evaluate('({ url: location.href, title: document.title })') as { url?: string; title?: string } | undefined
    return { url: String(value?.url ?? ''), title: String(value?.title ?? '') }
  }

  async navigate(url: string): Promise<{ url: string; title: string }> {
    const loaded = this.waitForLoad()
    const result = await this.cdp.send<{ errorText?: string }>('Page.navigate', { url })
    if (result.errorText) {
      loaded.cancel()
      throw new Error(`Could not open ${url}: ${result.errorText}`)
    }
    await loaded.promise
    return this.info()
  }

  async goBack(): Promise<void> {
    await this.historyStep(-1)
  }

  async goForward(): Promise<void> {
    await this.historyStep(1)
  }

  private async historyStep(delta: -1 | 1): Promise<void> {
    const { currentIndex, entries } = await this.cdp.send<{ currentIndex: number; entries: Array<{ id: number }> }>('Page.getNavigationHistory')
    const entry = entries[currentIndex + delta]
    if (!entry) throw new Error(delta < 0 ? 'There is no page to go back to' : 'There is no page to go forward to')
    const loaded = this.waitForLoad()
    await this.cdp.send('Page.navigateToHistoryEntry', { entryId: entry.id })
    await loaded.promise
  }

  /**
   * Resolves on the next load event, or a page restored from the back/forward cache (which fires none), or after
   * the timeout without failing (a slow page is still usable).
   */
  private waitForLoad(timeoutMs = NAVIGATION_TIMEOUT_MS): { promise: Promise<void>; cancel: () => void } {
    let off = () => {}
    let timer: ReturnType<typeof setTimeout> | undefined
    const promise = new Promise<void>((resolve) => {
      const offLoad = this.cdp.on('Page.loadEventFired', () => resolve())
      const offRestore = this.cdp.on('Page.frameNavigated', (p: { type?: string }) => { if (p.type === 'BackForwardCacheRestore') resolve() })
      off = () => { offLoad(); offRestore() }
      timer = setTimeout(resolve, timeoutMs)
    }).finally(() => { off(); clearTimeout(timer) })
    return { promise, cancel: () => { off(); clearTimeout(timer) } }
  }

  async evaluate(expression: string): Promise<unknown> {
    const result = await this.cdp.send<{ result?: { value?: unknown; description?: string }; exceptionDetails?: { text?: string; exception?: { description?: string } } }>(
      'Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise: true },
    )
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? 'The script failed')
    }
    return result.result?.value ?? result.result?.description
  }

  async snapshot(): Promise<AccessibilitySnapshot> {
    const tree = await this.cdp.send<{ nodes?: any[] }>('Accessibility.getFullAXTree')
    const nodes = Array.isArray(tree.nodes) ? tree.nodes : []
    this.refs.clear()
    const out: AccessibilityNode[] = []
    const seen = new Set<number>()
    const fallback: Array<AccessibilityNode & { node?: number }> = []
    const push = (entry: Omit<AccessibilityNode, 'ref'> & { node?: number }) => {
      if (out.length >= MAX_NODES) return
      if (entry.node !== undefined) {
        if (seen.has(entry.node)) return
        seen.add(entry.node)
      }
      const { node, ...rest } = entry
      const ref = this.allocateRef(node)
      if (node !== undefined) this.refs.set(ref, node)
      out.push({ ref, ...rest })
    }
    for (const n of nodes) {
      const role = String(n.role?.value ?? '').trim().toLowerCase()
      const name = String(n.name?.value ?? '').trim()
      const raw = n.value?.value
      const value = raw !== undefined && raw !== '' ? String(raw) : undefined
      const description = String(n.description?.value ?? '').trim() || undefined
      const node = typeof n.backendDOMNodeId === 'number' ? n.backendDOMNodeId as number : undefined
      let focused = false, checked = false, disabled = false, focusable = false
      for (const p of (n.properties ?? []) as any[]) {
        if (p.name === 'focused' && p.value?.value === true) focused = true
        if (p.name === 'checked') checked = p.value?.value === true || p.value?.value === 'true'
        if (p.name === 'disabled' && p.value?.value === true) disabled = true
        if (p.name === 'focusable' && p.value?.value === true) focusable = true
      }
      const entry = {
        node, role, name,
        ...(value !== undefined ? { value } : {}),
        ...(description ? { description } : {}),
        ...(focused ? { focused } : {}),
        ...(checked ? { checked } : {}),
        ...(disabled ? { disabled } : {}),
      }
      const primary = INTERACTIVE_ROLES.has(role) || (CONTENT_ROLES.has(role) && !!name) || value !== undefined
      const anonymous = (!role || role === 'generic' || role === 'none') && !name
      if (primary && !anonymous) push(entry)
      else if (node !== undefined && !['none', 'generic', 'rootwebarea', 'webarea'].includes(role) && (name || value !== undefined || focusable || focused)) {
        fallback.push({ ref: '', ...entry })
      }
    }
    if (out.length === 0) for (const entry of fallback) push(entry)
    return { ...(await this.info()), nodes: out }
  }

  private allocateRef(node?: number): string {
    if (node !== undefined) {
      const known = this.refByNode.get(node)
      if (known) return known
    }
    const ref = `@e${++this.nextRef}`
    if (node !== undefined) this.refByNode.set(node, ref)
    return ref
  }

  private nodeOf(ref: string): number {
    const node = this.refs.get(ref.startsWith('@') ? ref : `@${ref}`)
    if (node === undefined) throw new Error(`Element ${ref} not found. Run snapshot first to get current element refs.`)
    return node
  }

  private async objectOf(ref: string): Promise<string> {
    const { object } = await this.cdp.send<{ object: { objectId: string } }>('DOM.resolveNode', { backendNodeId: this.nodeOf(ref) })
    return object.objectId
  }

  /** The element's center after scrolling it into view. */
  private async centerOf(ref: string): Promise<{ x: number; y: number }> {
    const objectId = await this.objectOf(ref)
    await this.cdp.send('Runtime.callFunctionOn', { objectId, functionDeclaration: 'function() { this.scrollIntoViewIfNeeded ? this.scrollIntoViewIfNeeded() : this.scrollIntoView({ block: "center" }) }' })
    const { model } = await this.cdp.send<{ model: { content: number[] } }>('DOM.getBoxModel', { backendNodeId: this.nodeOf(ref) })
    const c = model.content
    return { x: (c[0]! + c[2]! + c[4]! + c[6]!) / 4, y: (c[1]! + c[3]! + c[5]! + c[7]!) / 4 }
  }

  async clickAt(x: number, y: number): Promise<void> {
    await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
    await this.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
    await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 })
  }

  async click(ref: string): Promise<void> {
    const { x, y } = await this.centerOf(ref)
    await this.clickAt(x, y)
  }

  async type(text: string): Promise<void> {
    await this.cdp.send('Input.insertText', { text })
  }

  async fill(ref: string, value: string): Promise<void> {
    const backendNodeId = this.nodeOf(ref)
    await this.cdp.send('DOM.focus', { backendNodeId })
    const objectId = await this.objectOf(ref)
    await this.cdp.send('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: `function() {
        if ('value' in this) this.value = ''; else if (this.isContentEditable) this.textContent = '';
        this.dispatchEvent(new Event('input', { bubbles: true }));
      }`,
    })
    await this.type(value)
    await this.cdp.send('Runtime.callFunctionOn', { objectId, functionDeclaration: "function() { this.dispatchEvent(new Event('change', { bubbles: true })) }" })
  }

  /** A native `<select>` by option value or label. */
  async select(ref: string, value: string): Promise<string> {
    const objectId = await this.objectOf(ref)
    const result = await this.cdp.send<{ result?: { value?: { ok: boolean; selected?: string } } }>('Runtime.callFunctionOn', {
      objectId,
      returnByValue: true,
      arguments: [{ value }],
      functionDeclaration: `function(wanted) {
        if (!(this instanceof HTMLSelectElement)) return { ok: false };
        const want = String(wanted).trim().toLowerCase();
        const option = Array.from(this.options).find((o) => o.value.toLowerCase() === want || o.text.trim().toLowerCase() === want)
          || Array.from(this.options).find((o) => o.text.toLowerCase().includes(want));
        if (!option) return { ok: false, selected: '' };
        this.value = option.value;
        this.dispatchEvent(new Event('input', { bubbles: true }));
        this.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true, selected: option.text.trim() };
      }`,
    })
    const out = result.result?.value
    if (!out?.ok) throw new Error(out?.selected === '' ? `No option "${value}" in ${ref}` : `${ref} is not a <select>; click it, then click the option`)
    return out.selected ?? value
  }

  async key(name: string, modifiers: string[] = []): Promise<void> {
    const known = KEYS[name.toLowerCase()]
    const single = name.length === 1 ? { key: name, code: `Key${name.toUpperCase()}`, keyCode: name.toUpperCase().charCodeAt(0), text: name } : undefined
    const key = known ?? single
    if (!key) throw new Error(`Unknown key "${name}". Use a single character or one of: ${Object.values(KEYS).map((k) => k.key).join(', ')}`)
    let mask = 0
    for (const m of modifiers) {
      const bit = MODIFIERS[m.toLowerCase()]
      if (bit === undefined) throw new Error(`Unknown modifier "${m}" (use shift, control, alt, meta)`)
      mask |= bit
    }
    const text = mask & ~8 ? undefined : key.text
    const base = { key: key.key, code: key.code, windowsVirtualKeyCode: key.keyCode, modifiers: mask }
    await this.cdp.send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', ...base, ...(text ? { text } : {}) })
    await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
  }

  async scroll(direction: 'up' | 'down' | 'left' | 'right', amount = 600): Promise<void> {
    const dx = direction === 'left' ? -amount : direction === 'right' ? amount : 0
    const dy = direction === 'up' ? -amount : direction === 'down' ? amount : 0
    await this.evaluate(`window.scrollBy(${dx}, ${dy})`)
  }

  /** Waits for some text or a CSS selector to appear. */
  async waitFor(kind: 'text' | 'selector', value: string, timeoutMs = 10_000): Promise<number> {
    const started = Date.now()
    const check = kind === 'text'
      ? `document.body && document.body.innerText.includes(${JSON.stringify(value)})`
      : `!!document.querySelector(${JSON.stringify(value)})`
    while (Date.now() - started < timeoutMs) {
      if (await this.evaluate(check).catch(() => false)) return Date.now() - started
      await Bun.sleep(200)
    }
    throw new Error(`Timed out after ${timeoutMs} ms waiting for ${kind} "${value}"`)
  }

  /** PNG bytes of the viewport (or the whole page). */
  async screenshot(fullPage = false): Promise<Buffer> {
    let clip: Record<string, number> | undefined
    if (fullPage) {
      const { cssContentSize } = await this.cdp.send<{ cssContentSize: { width: number; height: number } }>('Page.getLayoutMetrics')
      clip = { x: 0, y: 0, width: Math.ceil(cssContentSize.width), height: Math.min(Math.ceil(cssContentSize.height), 16_000), scale: 1 }
    }
    const { data } = await this.cdp.send<{ data: string }>('Page.captureScreenshot', { format: 'png', ...(clip ? { clip, captureBeyondViewport: true } : {}) })
    return Buffer.from(data, 'base64')
  }

  async bringToFront(): Promise<void> {
    await this.cdp.send('Page.bringToFront')
  }
}
