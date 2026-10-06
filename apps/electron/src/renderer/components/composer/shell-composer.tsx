/**
 * ShellComposer - the one composer, drawn in the page frame's composer slot (`PageFrame composer`). It reads the
 * page's context (`useComposerContext`), keeps a browser draft per context, runs the compact bar's state machine
 * (`composerReducer`) and sends: the page's own `onSend`, else the default, a new chat whose first line is the
 * page's entity token, opened at once (docs/composer.md (f)). Seams: the full look (W2), the attachment rail (W3),
 * dictation (W4), the Inbox icon (W5, the `attention` slot).
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUp, Plus, Square } from 'lucide-react'
import { Button } from '@workspace/ui/components/button'
import { Composer, ComposerInput, ComposerMainButton } from '@workspace/ui/components/composer'
import { Kbd } from '@workspace/ui/components/kbd'
import { toast } from '@workspace/ui/components/sonner'
import { useAction, useHotkeyLabel } from '@/actions'
import { useAppShellContext } from '@/context/app-shell-context'
import { EntityChip } from '@/components/entities/entity-chip'
import { navigate, routes } from '@/lib/navigate'
import { isMac } from '@/lib/platform'
import { useComposerShell } from './composer-provider'
import { buildFirstMessage, composerReducer, resolveShellSurface, sendKeyAction, type SendKey } from './composer-state'
import { useComposerDraft } from './use-composer-draft'

export function ShellComposer() {
  const { t } = useTranslation()
  const { context, handleRef } = useComposerShell()
  const { activeWorkspaceId, onCreateSession, onSendMessage } = useAppShellContext()
  const [view, dispatch] = React.useReducer(composerReducer, 'idle')
  const [text, setText] = useComposerDraft(activeWorkspaceId, context?.key ?? 'none')
  const [sending, setSending] = React.useState(false)
  const inputRef = React.useRef<HTMLTextAreaElement>(null)
  const surface = resolveShellSurface(context, view)

  // A new page starts collapsed (its draft comes with it).
  const contextKey = context?.key
  React.useEffect(() => dispatch({ type: 'collapse' }), [contextKey])

  // Enter sends as the chat input does: the `sendMessageKey` setting.
  const [sendKey, setSendKey] = React.useState<SendKey>('enter')
  React.useEffect(() => {
    window.electronAPI.getSendMessageKey().then((key) => setSendKey(key ?? 'enter')).catch(() => {})
  }, [])

  // The compact bar is one line: text that overflows it or a line break opens it up (in place, bottom edge pinned).
  React.useLayoutEffect(() => {
    const input = inputRef.current
    if (view !== 'focused' || !input) return
    if (text.includes('\n') || input.scrollWidth > input.clientWidth + 1) dispatch({ type: 'wrap' })
  }, [text, view])

  const focusEnd = React.useCallback(() => {
    requestAnimationFrame(() => {
      const input = inputRef.current
      if (!input) return
      input.focus()
      input.setSelectionRange(input.value.length, input.value.length)
    })
  }, [])

  React.useImperativeHandle(handleRef, () => ({
    prefill: (value) => {
      setText(value)
      if (value.includes('\n')) dispatch({ type: 'expand' })
      focusEnd()
    },
    focus: focusEnd,
    expand: () => {
      dispatch({ type: 'expand' })
      focusEnd()
    },
    collapse: () => dispatch({ type: 'collapse' }),
  }), [setText, focusEnd])

  useAction('composer.focus', focusEnd, { enabled: () => inputRef.current !== null })
  const focusKey = useHotkeyLabel('composer.focus')

  const empty = text.trim() === ''
  const send = async () => {
    if (!context || empty || sending) return
    setSending(true)
    try {
      if (context.onSend) {
        await context.onSend({ text: text.trim(), attachments: [] })
        setText('')
      } else {
        // The default: a new chat about this page, opened at once, its first message led by the page's token.
        if (!activeWorkspaceId) throw new Error('No workspace')
        const session = await onCreateSession(activeWorkspaceId)
        const message = buildFirstMessage(context.entity, text)
        setText('')
        navigate(routes.view.allSessions(session.id))
        onSendMessage(session.id, message)
      }
      dispatch({ type: 'collapse' })
    } catch (error) {
      console.error('[ShellComposer] send failed:', error)
      toast.error(t('composer.error.startChat'))
    } finally {
      setSending(false)
    }
  }

  if (!context || surface === 'none') return null

  const placeholder = context.placeholder ?? t('composer.placeholder.page')
  const sendShortcut = sendKey === 'enter' ? '↵' : isMac ? '⌘↵' : 'Ctrl+↵'
  const main = context.busy && context.onStop ? (
    <ComposerMainButton label={t('composer.stop')} shortcut="Esc" onClick={context.onStop}>
      <Square className="fill-current" />
    </ComposerMainButton>
  ) : (
    <ComposerMainButton type="submit" label={t('composer.send')} shortcut={sendShortcut} loading={sending} disabled={empty}>
      <ArrowUp />
    </ComposerMainButton>
  )

  return (
    <Composer
      variant={surface}
      aria-label={placeholder}
      onSubmit={(event) => {
        event.preventDefault()
        void send()
      }}
      onBlur={(event) => {
        // Focus moving inside the composer (to + or Send) is not leaving it.
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
        dispatch({ type: 'blur', empty })
      }}
      // W2-W5 fill these: `attachments` (the rail), dictation in `main`, `attention` (the Inbox icon).
      // Adding files waits for the rail (W3): until then + is shown, disabled.
      leading={
        <Button type="button" variant="ghost" size="icon" aria-label={t('composer.addFiles')} disabled>
          <Plus />
        </Button>
      }
      context={context.entity ? <EntityChip entity={context.entity} className="mx-1" /> : null}
      tools={surface === 'expanded' ? context.tools : null}
      hint={view === 'idle' && empty && focusKey ? <Kbd className="mr-1">{focusKey}</Kbd> : null}
      attention={null}
      main={main}
    >
      <ComposerInput
        ref={inputRef}
        value={text}
        placeholder={placeholder}
        aria-label={placeholder}
        readOnly={sending}
        onChange={(event) => setText(event.target.value)}
        onFocus={() => dispatch({ type: 'focus' })}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            dispatch({ type: 'escape' })
            event.currentTarget.blur()
            return
          }
          const { key, shiftKey, metaKey, ctrlKey } = event
          if (sendKeyAction({ key, shiftKey, metaKey, ctrlKey, isComposing: event.nativeEvent.isComposing }, sendKey) === 'send') {
            event.preventDefault()
            void send()
          }
        }}
      />
    </Composer>
  )
}
