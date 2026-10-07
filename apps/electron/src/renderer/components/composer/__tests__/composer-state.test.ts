import { describe, expect, it } from 'bun:test'
import { attentionSlot, buildFirstMessage, composerReducer, mainAction, resolveShellSurface, sendKeyAction, type ComposerEvent, type ComposerView } from '../composer-state'
import { arrivingDraft, draftSuffix } from '../use-composer-draft'
import { isHintModifier } from '../use-modifier-held'
import { pastedName } from '../use-composer-files'
import { fileKind, fileSize, middleCut } from '../attachment-rail'
import { dictationErrorKey, formatElapsed } from '../use-dictation'

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

  it('draws a full page (the chat, the new chat, Home) full, whatever the bar was doing', () => {
    expect(resolveShellSurface({ key: 'chat:abcdefghijkl', mode: 'full' }, 'idle')).toBe('full')
    expect(resolveShellSurface({ key: 'page:home', mode: 'full' }, 'expanded')).toBe('full')
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

describe('arrivingDraft', () => {
  it('keeps the page own draft, else carries the text along within a workspace', () => {
    expect(arrivingDraft('saved', 'typed', true)).toBe('saved')
    expect(arrivingDraft('', 'typed', true)).toBe('typed')
    expect(arrivingDraft('', 'typed', false)).toBe('')
  })
})

describe('mainAction', () => {
  const base = { sending: false, busy: false, transcribing: false, listening: false, hasContent: false }
  it('follows v1 priority: sending, stop, transcribing, done, send, dictate', () => {
    expect(mainAction(base)).toBe('dictate')
    expect(mainAction({ ...base, hasContent: true })).toBe('send')
    expect(mainAction({ ...base, listening: true, hasContent: true })).toBe('done')
    expect(mainAction({ ...base, transcribing: true, listening: true })).toBe('transcribing')
    expect(mainAction({ ...base, busy: true, transcribing: true })).toBe('stop')
    expect(mainAction({ ...base, sending: true, busy: true })).toBe('sending')
  })
})

describe('isHintModifier', () => {
  const key = (k: string, shiftKey = false) => ({ key: k, metaKey: false, ctrlKey: false, altKey: false, shiftKey })
  it('is ⌘ on a Mac, Ctrl elsewhere, and Option/Alt everywhere; not with Shift or another key', () => {
    expect(isHintModifier(key('Meta'), true)).toBe(true)
    expect(isHintModifier(key('Control'), true)).toBe(false)
    expect(isHintModifier(key('Control'), false)).toBe(true)
    expect(isHintModifier(key('Alt'), false)).toBe(true)
    expect(isHintModifier(key('Alt', true), false)).toBe(false)
    expect(isHintModifier(key('j'), true)).toBe(false)
  })
})

describe('files', () => {
  it('names pastes after those already added', () => {
    expect(pastedName('image', 'png', [])).toBe('pasted-image-1.png')
    expect(pastedName('image', 'png', ['pasted-image-2.png', 'a.txt'])).toBe('pasted-image-3.png')
    expect(pastedName('text', 'txt', ['pasted-image-4.png'])).toBe('pasted-text-1.txt')
  })
  it('cuts a long name in the middle and reads kind and size', () => {
    expect(middleCut('Banner-mobile-2026-08-10.jpg')).toBe('Banner-mob…-08-10.jpg')
    expect(middleCut('short.png')).toBe('short.png')
    expect(fileKind('notes.md', 'text/markdown')).toBe('MD')
    expect(fileKind('blob', 'application/pdf')).toBe('PDF')
    expect(fileSize(500)).toBe('500 B')
    expect(fileSize(120_000)).toBe('117 KB')
    expect(fileSize(1_480_000)).toBe('1.4 MB')
  })
})

describe('dictation', () => {
  it('maps the server codes to toasts and shows m:ss', () => {
    expect(dictationErrorKey('not_configured')).toBe('composer.error.notConfigured')
    expect(dictationErrorKey('too_large')).toBe('composer.error.tooLong')
    expect(dictationErrorKey('timeout')).toBe('composer.error.unable')
    expect(formatElapsed(7)).toBe('0:07')
    expect(formatElapsed(75)).toBe('1:15')
  })
})

describe('attentionSlot', () => {
  const at = { held: false, listening: false, empty: true, count: 2 }
  it('shows the Notifications button only while something needs you and nothing is written or attached', () => {
    expect(attentionSlot(at)).toBe('notifications')
    expect(attentionSlot({ ...at, count: 0 })).toBeNull()
    expect(attentionSlot({ ...at, empty: false })).toBeNull()
  })
  it('swaps it for the one key hint while a modifier is held, Notifications button or not', () => {
    expect(attentionSlot({ ...at, held: true })).toBe('key')
    expect(attentionSlot({ ...at, held: true, count: 0, empty: false })).toBe('key')
  })
  it('draws nothing while dictating', () => {
    expect(attentionSlot({ ...at, listening: true, held: true })).toBeNull()
  })
})
