import { describe, expect, it } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { Composer, ComposerInput } from '../../../../../../../design/ui/src/components/composer'
import { buildFirstMessage, mainAction, sendKeyAction } from '../composer-state'
import { arrivingDraft, draftSuffix } from '../use-composer-draft'
import { pastedName } from '../use-composer-files'
import { fileKind, fileSize } from '../attachment-rail'
import { dictationErrorKey, formatElapsed } from '../use-dictation'

describe('full composer', () => {
  it('always renders the full-width stacked input and action row without a variant', () => {
    const html = renderToStaticMarkup(createElement(Composer, {
      attachments: createElement('span', null, 'Attachment'),
      leading: createElement('button', { type: 'button' }, 'Add files'),
      tools: createElement('button', { type: 'button' }, 'Model'),
      main: createElement('button', { type: 'submit' }, 'Send'),
      children: createElement(ComposerInput, null, createElement('div', { role: 'textbox' }, 'First line\nSecond line')),
    }))
    expect(html.match(/data-slot="composer"/g)).toHaveLength(1)
    expect(html).toContain('group/composer w-full')
    expect(html).toContain('flex w-full flex-col gap-1 p-2')
    expect(html).toContain('data-slot="composer-row"')
    expect(html).toContain('First line\nSecond line')
    expect(html.indexOf('Attachment')).toBeLessThan(html.indexOf('data-slot="composer-input"'))
    expect(html.indexOf('data-slot="composer-row"')).toBeLessThan(html.indexOf('data-slot="composer-input"'))
    expect(html.indexOf('data-slot="composer-input"')).toBeLessThan(html.indexOf('Add files'))
    expect(html.indexOf('Add files')).toBeLessThan(html.indexOf('Send'))
    expect(html).toContain('min-h-8')
    expect(html).toContain('items-end gap-2')
    expect(html).toContain('Add files')
    expect(html).toContain('Model')
    expect(html).toContain('Send')
    expect(html).not.toContain('data-variant')
    expect(html).not.toContain('variant=compact')
    expect(html).not.toContain('max-w-[28rem]')
  })

  it('keeps the mounted writing input and unchanged centered recording control order', () => {
    const html = renderToStaticMarkup(createElement(Composer, {
      leading: createElement('button', { type: 'button' }, 'Cancel'),
      tools: createElement('span', { 'data-slot': 'dictation' }, '0:00'),
      main: createElement('button', { type: 'button' }, 'Done'),
      children: createElement(ComposerInput, null, createElement('div', { role: 'textbox' }, 'Retained draft')),
    }))
    expect(html).toContain('group-has-[[data-slot=dictation]]/composer:hidden')
    expect(html).toContain('group-has-[[data-slot=dictation]]/composer:items-center')
    expect(html).toContain('Retained draft')
    expect(html.indexOf('Cancel')).toBeLessThan(html.indexOf('data-slot="dictation"'))
    expect(html.indexOf('data-slot="dictation"')).toBeLessThan(html.indexOf('Done'))
  })

  it('places the footer outside both composer bodies and preserves recording and send locks', () => {
    const source = readFileSync(new URL('../../app-shell/input/free-form-input.tsx', import.meta.url), 'utf8')
    expect(source.match(/data-slot="composer-dock"[\s\S]*?<\/Composer>\s*\{footer\}/g)).toHaveLength(2)
    expect(source).not.toContain('EntityChip')
    expect(source).not.toContain('footerProps.context')
    expect(source).toContain('disabled={dictating || sending || !!context.disabled || footerProps.disabled}')
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

describe('files', () => {
  it('names pastes after those already added', () => {
    expect(pastedName('image', 'png', [])).toBe('pasted-image-1.png')
    expect(pastedName('image', 'png', ['pasted-image-2.png', 'a.txt'])).toBe('pasted-image-3.png')
    expect(pastedName('text', 'txt', ['pasted-image-4.png'])).toBe('pasted-text-1.txt')
  })
  it('reads kind and size', () => {
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
