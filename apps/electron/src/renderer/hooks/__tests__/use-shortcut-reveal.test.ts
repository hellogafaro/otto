import { describe, it, expect } from 'bun:test'
import { revealModifier } from '../use-shortcut-reveal'

describe('revealModifier', () => {
  it('is Option/Alt in the browser, on any OS', () => {
    expect(revealModifier(true, true)).toBe('altKey')
    expect(revealModifier(false, true)).toBe('altKey')
  })

  it('is Command on the desktop app on macOS', () => {
    expect(revealModifier(true, false)).toBe('metaKey')
  })

  it('is Ctrl on the desktop app elsewhere', () => {
    expect(revealModifier(false, false)).toBe('ctrlKey')
  })
})
