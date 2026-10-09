import { describe, expect, it } from 'bun:test'
import { actions, actionList, hotkeyFor, JUMP_ACTION_IDS, type ActionId } from '../definitions'
import { formatHotkeyDisplay, matchesHotkey } from '../registry'
import type { ActionDefinition } from '../types'

const all: ActionDefinition[] = actionList

type Keys = Parameters<typeof matchesHotkey>[0]
const press = (init: Partial<Keys> & { key: string }): Keys => ({
  code: '',
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...init,
})

describe('jump actions', () => {
  it('are nine, in order, in Navigation', () => {
    expect(JUMP_ACTION_IDS).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `nav.jumpTo${n}` as ActionId))
    for (const id of JUMP_ACTION_IDS) expect(actions[id].category).toBe('Navigation')
  })

  it('are ⌘1–⌘9 in the desktop app and Option/Alt+1–9 in the browser', () => {
    JUMP_ACTION_IDS.forEach((id, index) => {
      expect(hotkeyFor(actions[id], false)).toBe(`mod+${index + 1}`)
      expect(hotkeyFor(actions[id], true)).toBe(`alt+${index + 1}`)
    })
  })

  it('show as ⌘3 on a Mac desktop, Ctrl+3 on Windows, ⌥3 and Alt+3 in a browser', () => {
    expect(formatHotkeyDisplay('mod+3', true)).toBe('⌘3')
    expect(formatHotkeyDisplay('mod+3', false)).toBe('Ctrl+3')
    expect(formatHotkeyDisplay('alt+3', true)).toBe('⌥3')
    expect(formatHotkeyDisplay('alt+3', false)).toBe('Alt+3')
  })

  it('pause under a dialog, sheet or menu', () => {
    for (const action of all.filter(a => JUMP_ACTION_IDS.includes(a.id as ActionId))) expect(action.when).toBe('!menuOpen')
  })
})

describe('matchesHotkey', () => {
  it('matches Command+digit on a Mac, Ctrl+digit elsewhere, never the other', () => {
    expect(matchesHotkey(press({ key: '3', code: 'Digit3', metaKey: true }), 'mod+3', true)).toBe(true)
    expect(matchesHotkey(press({ key: '3', code: 'Digit3', ctrlKey: true }), 'mod+3', true)).toBe(false)
    expect(matchesHotkey(press({ key: '3', code: 'Digit3', ctrlKey: true }), 'mod+3', false)).toBe(true)
    expect(matchesHotkey(press({ key: '3', code: 'Digit3', metaKey: true }), 'mod+3', false)).toBe(false)
  })

  it('matches Option+digit by the physical key, whatever character it types', () => {
    // macOS types ™ for Option+2, ¡ for Option+1
    expect(matchesHotkey(press({ key: '™', code: 'Digit2', altKey: true }), 'alt+2', true)).toBe(true)
    expect(matchesHotkey(press({ key: '¡', code: 'Digit1', altKey: true }), 'alt+1', true)).toBe(true)
    expect(matchesHotkey(press({ key: '¡', code: 'Digit1', altKey: true }), 'alt+2', true)).toBe(false)
    expect(matchesHotkey(press({ key: '1', code: 'Digit1' }), 'alt+1', true)).toBe(false)
    expect(matchesHotkey(press({ key: '1', code: 'Digit1', altKey: true, shiftKey: true }), 'alt+1', false)).toBe(false)
  })

  it('does not let a plain digit or another modifier trigger a jump', () => {
    expect(matchesHotkey(press({ key: '1', code: 'Digit1' }), 'mod+1', true)).toBe(false)
    expect(matchesHotkey(press({ key: '1', code: 'Digit1', metaKey: true, altKey: true }), 'mod+1', true)).toBe(false)
  })
})

describe('the standard keys', () => {
  it('keeps Settings on desktop and leaves the browser shortcut unbound', () => {
    expect(hotkeyFor(actions['app.settings'], false)).toBe('mod+,')
    expect(hotkeyFor(actions['app.settings'], true)).toBe(null)
  })
  it('binds ⌘K to the command palette alone, and no ⌘F', () => {
    expect(all.filter(action => action.defaultHotkey === 'mod+k').map(action => action.id)).toEqual(['app.commandPalette'])
    expect(all.some(action => action.defaultHotkey === 'mod+f')).toBe(false)
  })

  it('keeps New chat, Settings, Back and Forward', () => {
    expect(actions['app.newChat'].defaultHotkey).toBe('mod+n')
    expect(actions['app.settings'].defaultHotkey).toBe('mod+,')
    expect(actions['nav.goBack'].defaultHotkey).toBe('mod+[')
    expect(actions['nav.goForward'].defaultHotkey).toBe('mod+]')
  })

  it('binds no two actions to the same key in the same scope and place', () => {
    for (const webui of [false, true]) {
      const seen = new Map<string, string>()
      for (const action of all) {
        const hotkey = hotkeyFor(action, webui)
        if (!hotkey) continue
        const slot = `${action.scope ?? 'global'}|${action.when ?? ''}|${hotkey}`
        // Escape, select-all and the like are scoped on purpose; only unscoped clashes matter.
        if (seen.has(slot)) throw new Error(`${action.id} and ${seen.get(slot)} share ${hotkey} (${webui ? 'web' : 'desktop'})`)
        seen.set(slot, action.id)
      }
    }
  })
})
