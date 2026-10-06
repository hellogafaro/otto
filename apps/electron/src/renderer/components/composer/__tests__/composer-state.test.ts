import { describe, expect, it } from 'bun:test'
import { buildFirstMessage, composerReducer, resolveShellSurface, sendKeyAction, type ComposerEvent, type ComposerView } from '../composer-state'
import { draftSuffix } from '../use-composer-draft'

const run = (events: ComposerEvent[], from: ComposerView = 'idle') => events.reduce(composerReducer, from)

describe('composerReducer', () => {
  it('focuses, then grows on wrap, files or expand', () => {
    expect(run([{ type: 'focus' }])).toBe('focused')
    expect(run([{ type: 'focus' }, { type: 'wrap' }])).toBe('expanded')
    expect(run([{ type: 'focus' }, { type: 'files' }])).toBe('expanded')
    expect(run([{ type: 'expand' }])).toBe('expanded')
  })

  it('does not grow on wrap while idle (a long draft shown unfocused stays one line)', () => {
    expect(run([{ type: 'wrap' }])).toBe('idle')
  })

  it('collapses on Escape or collapse, keeps an expanded draft on blur, folds an empty one', () => {
    expect(run([{ type: 'escape' }], 'expanded')).toBe('idle')
    expect(run([{ type: 'collapse' }], 'expanded')).toBe('idle')
    expect(run([{ type: 'blur', empty: false }], 'expanded')).toBe('expanded')
    expect(run([{ type: 'blur', empty: true }], 'expanded')).toBe('idle')
    expect(run([{ type: 'blur', empty: false }], 'focused')).toBe('idle')
  })

  it('stays expanded when focused again', () => {
    expect(run([{ type: 'focus' }], 'expanded')).toBe('expanded')
  })
})

describe('resolveShellSurface', () => {
  it('draws nothing without a page context', () => {
    expect(resolveShellSurface(null, 'idle')).toBe('none')
  })

  it('draws the compact bar, expanded when the state says so', () => {
    const page = { key: 'task:abcdefghijkl', entity: 'task:abcdefghijkl' }
    expect(resolveShellSurface(page, 'idle')).toBe('compact')
    expect(resolveShellSurface(page, 'focused')).toBe('compact')
    expect(resolveShellSurface(page, 'expanded')).toBe('expanded')
  })

  it('leaves a full chat to its own input until W2, and shows the compact bar on any other full page', () => {
    expect(resolveShellSurface({ key: 'chat:abcdefghijkl', mode: 'full' }, 'idle')).toBe('none')
    expect(resolveShellSurface({ key: 'page:inbox', mode: 'full' }, 'idle')).toBe('compact')
  })
})

describe('buildFirstMessage', () => {
  it('leads with the entity token, then the trimmed text', () => {
    expect(buildFirstMessage('task:abcdefghijkl', '  what is left?  ')).toBe('task:abcdefghijkl what is left?')
  })

  it('is the text alone without an entity', () => {
    expect(buildFirstMessage(undefined, 'hello\nthere ')).toBe('hello\nthere')
  })
})

describe('sendKeyAction', () => {
  const key = (over: Partial<Parameters<typeof sendKeyAction>[0]>) => ({ key: 'Enter', shiftKey: false, metaKey: false, ctrlKey: false, isComposing: false, ...over })

  it('Enter sends; Shift+Enter and IME composition do not', () => {
    expect(sendKeyAction(key({}), 'enter')).toBe('send')
    expect(sendKeyAction(key({ metaKey: true }), 'enter')).toBe('send')
    expect(sendKeyAction(key({ shiftKey: true }), 'enter')).toBeNull()
    expect(sendKeyAction(key({ isComposing: true }), 'enter')).toBeNull()
    expect(sendKeyAction(key({ key: 'a' }), 'enter')).toBeNull()
  })

  it('in ⌘Enter mode only ⌘/Ctrl+Enter sends', () => {
    expect(sendKeyAction(key({}), 'cmd-enter')).toBeNull()
    expect(sendKeyAction(key({ metaKey: true }), 'cmd-enter')).toBe('send')
    expect(sendKeyAction(key({ ctrlKey: true }), 'cmd-enter')).toBe('send')
  })
})

describe('draftSuffix', () => {
  it('keys a draft by workspace and page context', () => {
    expect(draftSuffix('ws1', 'task:abcdefghijkl')).toBe('ws1:task:abcdefghijkl')
    expect(draftSuffix('ws2', 'task:abcdefghijkl')).not.toBe(draftSuffix('ws1', 'task:abcdefghijkl'))
    expect(draftSuffix(null, 'page:tasks')).toBe('none:page:tasks')
  })
})
