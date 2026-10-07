/**
 * `browser_tool`: the agent's one browser tool, a small CLI over its chat's Fortress page (agent-browser.ts).
 * The command list here is the one in `session-tools-core` TOOL_DESCRIPTIONS.browser_tool and in browser-tools.md.
 */

import type { BrowserPage } from './page.ts'

export const BROWSER_TOOL_HELP = `browser_tool commands (one per call; string or array form):
  navigate <url>              open a page in this chat's browser (alias: open <url>)
  snapshot                    list the page's elements with refs (@e1, @e2, ...)
  find <text>                 the snapshot lines whose role or name contains <text>
  click <@ref>                click an element from the last snapshot
  click-at <x> <y>            click at viewport coordinates
  fill <@ref> <text>          replace an input's value
  type <text>                 type into the focused element
  select <@ref> <option>      choose an option of a <select>
  key <name> [modifiers...]   press a key: Enter, Tab, Escape, ArrowDown, a, ... with shift/control/alt/meta
  scroll <up|down|left|right> [px]
  back | forward
  wait <ms> | wait text <text> [ms] | wait selector <css> [ms]
  evaluate <javascript>       run JavaScript in the page and return the value
  screenshot [--full]         save a PNG of the page (or the whole page) and return its path
  close                       close this chat's browser (its tabs and cookies)`

export interface BrowserToolContext {
  /** This chat's page (opened on first use). */
  page(): Promise<BrowserPage>
  close(): Promise<boolean>
  /** Called before a command that changes what is on the page: brings it to the visible screen if the chat holds it. */
  onAction?(page: BrowserPage): Promise<void>
}

export interface BrowserToolResult {
  output: string
  /** PNG bytes when the command was `screenshot`; the caller saves them where the UI and the agent can open them. */
  screenshot?: Buffer
}

/** `click @e1` / `fill @e2 "two words"` -> argv; quotes group words, the rest splits on spaces. */
export function parseBrowserCommand(command: string | string[]): string[] {
  if (Array.isArray(command)) return command.map(String)
  const argv: string[] = []
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g
  for (let m = re.exec(command.trim()); m; m = re.exec(command.trim())) {
    argv.push(m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1') : (m[2] ?? m[3]!))
  }
  return argv
}

function need(value: string | undefined, usage: string): string {
  if (!value) throw new Error(`Usage: ${usage}`)
  return value
}

function number(value: string | undefined, usage: string): number {
  const n = Number(need(value, usage))
  if (!Number.isFinite(n)) throw new Error(`Usage: ${usage}`)
  return n
}

const where = (info: { url: string; title: string }) => `Page: ${info.title || '(no title)'}\nURL: ${info.url}`

export async function runBrowserCommand(command: string | string[], ctx: BrowserToolContext): Promise<BrowserToolResult> {
  const argv = parseBrowserCommand(command)
  const [name = '', ...args] = argv
  const rest = (from = 0) => args.slice(from).join(' ')
  switch (name.toLowerCase()) {
    case '':
    case 'help':
    case '--help':
      return { output: BROWSER_TOOL_HELP }
    case 'open':
    case 'navigate': {
      const page = await ctx.page()
      await ctx.onAction?.(page)
      if (!args[0]) return { output: `${where(await page.info())}\nThe browser is open. Next: navigate <url>.` }
      const url = /^[a-z][a-z0-9+.-]*:/i.test(args[0]) ? args[0] : `https://${args[0]}`
      return { output: `${where(await page.navigate(url))}\nNext: snapshot to see the elements.` }
    }
    case 'snapshot':
    case 'find': {
      const page = await ctx.page()
      const snap = await page.snapshot()
      const filter = name === 'find' ? need(rest(), 'find <text>').toLowerCase() : null
      const nodes = filter ? snap.nodes.filter((n) => `${n.role} ${n.name} ${n.value ?? ''}`.toLowerCase().includes(filter)) : snap.nodes
      const lines = nodes.map((n) => {
        const flags = [n.focused && 'focused', n.checked && 'checked', n.disabled && 'disabled'].filter(Boolean).join(', ')
        return `${n.ref} ${n.role}${n.name ? ` "${n.name}"` : ''}${n.value !== undefined ? ` value="${n.value}"` : ''}${flags ? ` (${flags})` : ''}`
      })
      return { output: `${where(snap)}\n${lines.length ? lines.join('\n') : filter ? `No element matches "${filter}".` : '(no elements)'}` }
    }
    case 'click': {
      const page = await ctx.page()
      await ctx.onAction?.(page)
      await page.click(need(args[0], 'click <@ref>'))
      await Bun.sleep(300)
      return { output: `Clicked ${args[0]}\n${where(await page.info())}` }
    }
    case 'click-at': {
      const page = await ctx.page()
      await ctx.onAction?.(page)
      await page.clickAt(number(args[0], 'click-at <x> <y>'), number(args[1], 'click-at <x> <y>'))
      return { output: `Clicked at ${args[0]},${args[1]}` }
    }
    case 'fill': {
      const page = await ctx.page()
      await ctx.onAction?.(page)
      await page.fill(need(args[0], 'fill <@ref> <text>'), rest(1))
      return { output: `Filled ${args[0]}` }
    }
    case 'type': {
      const page = await ctx.page()
      await ctx.onAction?.(page)
      await page.type(need(rest(), 'type <text>'))
      return { output: 'Typed the text' }
    }
    case 'select': {
      const page = await ctx.page()
      await ctx.onAction?.(page)
      const chosen = await page.select(need(args[0], 'select <@ref> <option>'), need(rest(1), 'select <@ref> <option>'))
      return { output: `Selected "${chosen}" in ${args[0]}` }
    }
    case 'key': {
      const page = await ctx.page()
      await ctx.onAction?.(page)
      await page.key(need(args[0], 'key <name> [modifiers...]'), args.slice(1))
      return { output: `Pressed ${[...args.slice(1), args[0]].join('+')}` }
    }
    case 'scroll': {
      const direction = need(args[0], 'scroll <up|down|left|right> [px]') as 'up' | 'down' | 'left' | 'right'
      if (!['up', 'down', 'left', 'right'].includes(direction)) throw new Error('Usage: scroll <up|down|left|right> [px]')
      const page = await ctx.page()
      await page.scroll(direction, args[1] ? number(args[1], 'scroll <direction> [px]') : undefined)
      return { output: `Scrolled ${direction}` }
    }
    case 'back':
    case 'forward': {
      const page = await ctx.page()
      await ctx.onAction?.(page)
      await (name === 'back' ? page.goBack() : page.goForward())
      return { output: where(await page.info()) }
    }
    case 'wait': {
      const page = await ctx.page()
      if (args[0] === 'text' || args[0] === 'selector') {
        const timeout = args.length > 2 && /^\d+$/.test(args.at(-1)!) ? Number(args.at(-1)) : undefined
        const value = need(timeout === undefined ? rest(1) : args.slice(1, -1).join(' '), `wait ${args[0]} <value> [ms]`)
        const ms = await page.waitFor(args[0], value, timeout)
        return { output: `Found ${args[0]} "${value}" after ${ms} ms` }
      }
      const ms = Math.min(number(args[0], 'wait <ms> | wait text <text> [ms] | wait selector <css> [ms]'), 60_000)
      await Bun.sleep(ms)
      return { output: `Waited ${ms} ms` }
    }
    case 'evaluate': {
      const page = await ctx.page()
      const value = await page.evaluate(need(rest(), 'evaluate <javascript>'))
      const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
      return { output: text === undefined ? 'undefined' : text.length > 20_000 ? `${text.slice(0, 20_000)}\n[truncated]` : text }
    }
    case 'screenshot': {
      const page = await ctx.page()
      const png = await page.screenshot(args.includes('--full'))
      return { output: where(await page.info()), screenshot: png }
    }
    case 'close':
      return { output: (await ctx.close()) ? 'Closed this chat\'s browser.' : 'This chat has no open browser.' }
    default:
      throw new Error(`Unknown command "${name}".\n\n${BROWSER_TOOL_HELP}`)
  }
}
