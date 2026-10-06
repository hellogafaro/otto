/**
 * FreeFormInput - the ONE composer: the chat input (Craft's, kept: rich text with `@` mention badges, `/` commands,
 * files, Send and Stop, Arrow Up to stop and recall, the chat's events) refactored to v1's look, with the compact
 * floating bar as one of its MODES. `ShellComposer` hosts the single instance in the page frame's composer slot,
 * mounted once, so opening a chat, the new chat or the Inbox grows the SAME instance into the full composer (and
 * leaving shrinks it) with the text and files kept. It reads the page's context (`useComposerContext`), keeps a
 * browser draft per context, runs the compact bar's state machine (`composerReducer`), takes files (+, drop, paste:
 * the attachment rail), dictates (`useDictation`, `transcription:create`), and sends: the page's own `onSend` (the
 * chat), else the default, a new chat whose first line is the page's entity token, opened at once. While
 * something needs you (`useAttention`) and nothing is written, the bar has the Inbox button; it (or ⌥I / ⌘I,
 * `nav.inbox`) opens the Inbox list above the text in the same surface (Escape, the button again or a click
 * outside closes it). Its one shortcut, the focus key (`Kbd`), shows only while ⌘/Ctrl or Option/Alt is held
 * (`useModifierHeld`), in the Inbox's place. The chat draws an instance of its own, not hosted, when the shell has
 * no composer. See docs/composer.md.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUp, Check, Mic, Plus, Square, X } from 'lucide-react'
import { Button } from '@workspace/ui/components/button'
import { Composer, ComposerInput, ComposerMainButton } from '@workspace/ui/components/composer'
import { Kbd } from '@workspace/ui/components/kbd'
import { toast } from '@workspace/ui/components/sonner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { useAction, useHotkeyLabel } from '@/actions'
import { useAppShellContext } from '@/context/app-shell-context'
import { EntityChip } from '@/components/entities/entity-chip'
import { RichTextInput, type RichTextInputHandle } from '@/components/ui/rich-text-input'
import { shouldHandleScopedInputEvent, shouldRecallPromptOnArrowUp } from './input-event-guards'
import { clearPendingFocusForSession, consumePendingFocusForSession } from './focus-input-events'
import { appendRestoredInput } from '@/lib/input-text'
import { parseMentions } from '@/lib/mentions'
import { navigate, routes } from '@/lib/navigate'
import { hasOpenOverlay } from '@/lib/overlay-detection'
import { isMac } from '@/lib/platform'
import { applySmartTypography } from '@/lib/smart-typography'
import { AttachmentRail } from '@/components/composer/attachment-rail'
import { useComposerCommands } from '@/components/composer/composer-commands'
import type { ComposerHandle } from '@/components/composer/composer-provider'
import { attentionSlot, buildFirstMessage, composerReducer, mainAction, resolveShellSurface, sendKeyAction, type ComposerContext, type SendKey } from '@/components/composer/composer-state'
import { InboxButton, InboxList } from '@/components/composer/inbox-button'
import { useAttention } from '@/components/composer/use-attention'
import { useComposerDraft } from '@/components/composer/use-composer-draft'
import { useComposerFiles } from '@/components/composer/use-composer-files'
import { useDictation, useElapsed } from '@/components/composer/use-dictation'
import { useModifierHeld } from '@/components/composer/use-modifier-held'
import { Waveform } from '@/components/composer/waveform'

export function FreeFormInput({ context, handleRef }: {
  context: ComposerContext | null
  /** The shell's host: the instance it fills is the one `useComposer()` drives and ⌘J focuses. */
  handleRef?: React.RefObject<ComposerHandle | null> | null
}) {
  const { t } = useTranslation()
  const hosted = !!handleRef
  const { activeWorkspaceId, onCreateSession, onSendMessage, onSessionSourcesChange } = useAppShellContext()
  const [view, dispatch] = React.useReducer(composerReducer, 'idle')
  const [text, setText] = useComposerDraft(activeWorkspaceId, context?.key ?? 'none')
  const files = useComposerFiles()
  const [sending, setSending] = React.useState(false)
  const [dragging, setDragging] = React.useState(false)
  const inputRef = React.useRef<RichTextInputHandle>(null)
  const pickerRef = React.useRef<HTMLInputElement>(null)
  const held = useModifierHeld()
  const attention = useAttention()
  const [inboxOpen, setInboxOpen] = React.useState(false)
  const formRef = React.useRef<HTMLFormElement>(null)
  const surface = resolveShellSurface(context, view)
  const full = surface === 'full'
  const sessionId = context?.sessionId
  const textRef = React.useRef(text)
  textRef.current = text

  // A new page starts collapsed (its draft comes with it).
  const contextKey = context?.key
  React.useEffect(() => {
    dispatch({ type: 'collapse' })
    setInboxOpen(false)
  }, [contextKey])

  // The chat input's settings: the send key, auto-capitalisation and spell check.
  const [settings, setSettings] = React.useState<{ sendKey: SendKey; capitalise: boolean; spellCheck: boolean }>({ sendKey: 'enter', capitalise: true, spellCheck: false })
  React.useEffect(() => {
    const api = window.electronAPI
    Promise.all([api.getSendMessageKey(), api.getAutoCapitalisation(), api.getSpellCheck()])
      .then(([sendKey, capitalise, spellCheck]) => setSettings({ sendKey: sendKey ?? 'enter', capitalise, spellCheck }))
      .catch(() => {})
  }, [])

  const focusAt = React.useCallback((caret?: number) => {
    requestAnimationFrame(() => {
      const input = inputRef.current
      if (!input) return
      input.focus()
      const at = caret ?? textRef.current.length
      input.setSelectionRange(at, at)
    })
  }, [])

  const addFiles = (list: FileList | File[]) => {
    if (files.add(list) > 0 && !full) dispatch({ type: 'files' })
  }

  // Dictated text lands at the caret, with a space before it when it follows a word.
  const dictation = useDictation((spoken) => {
    const value = textRef.current
    const at = Math.min(inputRef.current?.selectionStart ?? value.length, value.length)
    const before = value.slice(0, at)
    const insert = (before && !/\s$/.test(before) ? ' ' : '') + spoken
    setText(before + insert + value.slice(at))
    focusAt(before.length + insert.length)
  })
  const elapsed = useElapsed(dictation.listening)
  const listening = dictation.listening

  const commands = useComposerCommands({ inputRef, context, setText, onAddFiles: () => pickerRef.current?.click() })

  // The compact bar is one line: text that overflows it or a line break opens it up (in place, bottom edge pinned).
  React.useLayoutEffect(() => {
    const editor = inputRef.current?.element
    if (view !== 'focused' || !editor) return
    if (text.includes('\n') || editor.scrollWidth > editor.clientWidth + 1) dispatch({ type: 'wrap' })
  }, [text, view])

  React.useImperativeHandle(handleRef ?? undefined, () => ({
    prefill: (value) => {
      setText(value)
      if (value.includes('\n')) dispatch({ type: 'expand' })
      focusAt(value.length)
    },
    focus: () => focusAt(),
    expand: () => {
      dispatch({ type: 'expand' })
      focusAt()
    },
    collapse: () => dispatch({ type: 'collapse' }),
    take: () => {
      const value = textRef.current.trim()
      setText('')
      return value
    },
  }), [setText, focusAt])

  useAction('composer.focus', () => focusAt(), { enabled: () => hosted && inputRef.current !== null })
  const focusKey = useHotkeyLabel('composer.focus')

  // The Inbox list: over the bar (compact or expanded) while something needs you, never in full mode or while
  // dictating. The Inbox key toggles it there; anywhere else (a full page, nothing to show) it opens the page.
  const inboxShown = inboxOpen && attention.count > 0 && !full && !listening && !!context
  useAction('nav.inbox', () => {
    if (context && !full && attention.count > 0) setInboxOpen((open) => !open)
    else navigate(routes.view.inbox())
  }, { enabled: () => hosted })
  React.useEffect(() => {
    if (!inboxShown) return
    const close = () => setInboxOpen(false)
    const onPointer = (event: PointerEvent) => {
      if (!formRef.current?.contains(event.target as Node)) close()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing || hasOpenOverlay()) return
      // Escape closes the list first, before anything else takes it.
      event.preventDefault()
      event.stopPropagation()
      close()
    }
    document.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [inboxShown])

  const hasContent = text.trim() !== '' || files.items.length > 0 || !!context?.canSendEmpty
  const canSend = hasContent && files.ready && !sending && !context?.disabled && !listening && !dictation.transcribing

  const send = async () => {
    if (!context || !canSend) return
    const message = text.trim()
    const mentions = parseMentions(message, commands.skills.map((skill) => skill.slug), commands.sources.map((source) => source.config.slug))
    const attachments = files.attachments
    setSending(true)
    try {
      if (context.onSend) {
        await context.onSend({ text: message, attachments, skillSlugs: mentions.skills, sourceSlugs: mentions.sources })
        setText('')
        files.clear()
      } else {
        // The default: a new chat about this page, opened at once, its first message led by the page's token.
        if (!activeWorkspaceId) throw new Error('No workspace')
        const session = await onCreateSession(activeWorkspaceId)
        setText('')
        files.clear()
        if (mentions.sources.length > 0) onSessionSourcesChange?.(session.id, mentions.sources)
        navigate(routes.view.allSessions(session.id))
        onSendMessage(
          session.id,
          buildFirstMessage(context.entity, message),
          attachments.length > 0 ? attachments : undefined,
          mentions.skills.length > 0 ? mentions.skills : undefined,
        )
      }
      dispatch({ type: 'collapse' })
    } catch (error) {
      console.error('[FreeFormInput] send failed:', error)
      toast.error(t('composer.error.startChat'))
    } finally {
      setSending(false)
    }
  }
  const sendRef = React.useRef(send)
  sendRef.current = send

  // The chat's events, scoped to its session: focus (after a menu or a retry), files pasted anywhere, a prompt
  // restored on Stop, and Send from a follow-up.
  React.useEffect(() => {
    const scoped = (event: Event) => shouldHandleScopedInputEvent({ sessionId, targetSessionId: (event as CustomEvent<{ sessionId?: string }>).detail?.sessionId })
    const onFocus = (event: Event) => {
      if (!scoped(event)) return
      clearPendingFocusForSession(sessionId)
      focusAt()
    }
    const onPaste = (event: Event) => {
      const files = (event as CustomEvent<{ files?: File[] }>).detail?.files
      if (scoped(event) && files?.length) addFilesRef.current(files)
    }
    const onRestore = (event: Event) => {
      const restored = (event as CustomEvent<{ text?: string }>).detail?.text
      if (scoped(event) && restored) setText(appendRestoredInput(textRef.current, restored))
    }
    const onSubmit = (event: Event) => {
      if (scoped(event)) void sendRef.current()
    }
    window.addEventListener('otto:focus-input', onFocus)
    window.addEventListener('otto:paste-files', onPaste)
    window.addEventListener('otto:restore-input', onRestore)
    window.addEventListener('otto:submit-input', onSubmit)
    if (consumePendingFocusForSession(sessionId)) focusAt()
    return () => {
      window.removeEventListener('otto:focus-input', onFocus)
      window.removeEventListener('otto:paste-files', onPaste)
      window.removeEventListener('otto:restore-input', onRestore)
      window.removeEventListener('otto:submit-input', onSubmit)
    }
  }, [sessionId, focusAt, setText])
  const addFilesRef = React.useRef(addFiles)
  addFilesRef.current = addFiles

  // While listening, Enter is Done and Escape cancels, wherever the focus is.
  React.useEffect(() => {
    if (!listening) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Enter') dictation.stop()
      else if (event.key === 'Escape') dictation.cancel()
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [listening, dictation])

  if (!context || surface === 'none') return null

  const placeholder = context.placeholder ?? t('composer.placeholder.page')

  // A pending request (a permission, a credential) takes the full composer's place until it is answered.
  if (full && context.structured) {
    return (
      <Composer variant="full" aria-label={placeholder} onSubmit={(event) => event.preventDefault()}>
        {context.structured}
      </Composer>
    )
  }

  const sendShortcut = settings.sendKey === 'enter' ? '↵' : isMac ? '⌘↵' : 'Ctrl+↵'
  const action = mainAction({
    sending,
    busy: !!(context.busy && context.onStop),
    transcribing: dictation.transcribing,
    listening,
    hasContent,
  })
  const main = {
    sending: (
      <ComposerMainButton label={t('composer.sending')} loading>
        <ArrowUp />
      </ComposerMainButton>
    ),
    stop: (
      <ComposerMainButton label={t('composer.stop')} shortcut="Esc" onClick={() => context.onStop?.()}>
        <Square className="fill-current" />
      </ComposerMainButton>
    ),
    transcribing: (
      <ComposerMainButton label={t('composer.transcribing')} loading>
        <Mic />
      </ComposerMainButton>
    ),
    done: (
      <ComposerMainButton label={t('composer.done')} shortcut="↵" onClick={dictation.stop}>
        <Check />
      </ComposerMainButton>
    ),
    send: (
      <ComposerMainButton type="submit" label={t('composer.send')} shortcut={sendShortcut} disabled={!canSend}>
        <ArrowUp />
      </ComposerMainButton>
    ),
    dictate: (
      <ComposerMainButton
        label={dictation.supported ? t('composer.dictate') : t('composer.dictationUnavailable')}
        disabled={!dictation.supported}
        onClick={() => void dictation.start()}
      >
        <Mic />
      </ComposerMainButton>
    ),
  }[action]

  const cancel = (
    <Tooltip>
      <TooltipTrigger render={<Button type="button" variant="ghost" size="icon" aria-label={t('composer.cancelDictation')} onClick={dictation.cancel} />}>
        <X />
      </TooltipTrigger>
      <TooltipContent>
        {t('composer.cancelDictation')}
        <Kbd>Esc</Kbd>
      </TooltipContent>
    </Tooltip>
  )
  const plus = (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t('composer.addFiles')}
              disabled={sending}
              onClick={() => pickerRef.current?.click()}
            />
          }
        >
          <Plus />
        </TooltipTrigger>
        <TooltipContent>{t('composer.addFiles')}</TooltipContent>
      </Tooltip>
      <input
        ref={pickerRef}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          if (event.target.files) addFiles(event.target.files)
          event.target.value = ''
        }}
      />
    </>
  )
  const rail = (
    <AttachmentRail files={files.items} full={full} onRemove={sending ? undefined : files.remove} onRetry={files.retry} />
  )
  const chips = full ? (
    <>
      {context.chips}
      {files.items.some((file) => file.type.startsWith('image/')) && context.imageNotice}
    </>
  ) : null
  const empty = text.trim() === '' && files.items.length === 0

  return (
    <>
      {commands.menus}
      <Composer
        ref={formRef}
        variant={surface}
        dragging={dragging}
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
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes('Files')) return
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false)
        }}
        onDrop={(event) => {
          setDragging(false)
          if (!event.dataTransfer.files.length) return
          event.preventDefault()
          addFiles(event.dataTransfer.files)
        }}
        attachments={chips || files.items.length > 0 ? <>{chips}{rail}</> : null}
        leading={listening ? cancel : plus}
        context={context.entity && !listening ? <EntityChip entity={context.entity} className="mx-1" /> : null}
        tools={listening ? (
          <>
            <Waveform />
            <span aria-live="off" className="w-10 shrink-0 text-right text-xs text-muted-foreground tabular-nums">{elapsed}</span>
          </>
        ) : surface === 'compact' ? null : context.tools}
        attention={{
          key: focusKey ? <span className="flex h-8 min-w-8 items-center justify-center"><Kbd>{focusKey}</Kbd></span> : null,
          inbox: <InboxButton count={attention.count} open={inboxShown} onToggle={() => setInboxOpen((open) => !open)} />,
          none: null,
        }[attentionSlot({ held, listening, empty, count: attention.count }) ?? 'none']}
        panel={inboxShown ? <InboxList attention={attention} onPick={() => setInboxOpen(false)} /> : null}
        main={main}
      >
        <ComposerInput className={listening && surface === 'compact' ? 'hidden' : undefined}>
          <RichTextInput
            ref={inputRef}
            value={text}
            placeholder={placeholder}
            aria-label={placeholder}
            spellCheck={settings.spellCheck}
            skills={commands.skills}
            sources={commands.sources}
            workspaceId={commands.workspaceSlug}
            onChange={setText}
            onInput={(value, cursor) => {
              commands.onInput(value, cursor)
              // Capitalise the first letter (not a command, mention or tag) and type arrows and dashes.
              if (settings.capitalise && value && !'/@#'.includes(value[0]!) && value[0] !== value[0]!.toUpperCase()) {
                inputRef.current?.setSelectionRange(cursor, cursor)
                setText(value[0]!.toUpperCase() + value.slice(1))
                return
              }
              const typed = applySmartTypography(value, cursor)
              if (typed.replaced) {
                inputRef.current?.setSelectionRange(typed.cursor, typed.cursor)
                setText(typed.text)
              }
            }}
            onFocus={() => dispatch({ type: 'focus' })}
            onPaste={(event) => {
              if (event.clipboardData?.files.length) addFiles(event.clipboardData.files)
            }}
            onLongTextPaste={(pasted) => {
              files.addText(pasted)
              if (!full) dispatch({ type: 'files' })
            }}
            onKeyDown={(event) => {
              if (commands.takesKey(event)) return
              const { key, shiftKey, metaKey, ctrlKey, altKey } = event
              const isComposing = event.nativeEvent.isComposing
              if (key === 'Escape') {
                if (isComposing || hasOpenOverlay()) return
                dispatch({ type: 'escape' })
                inputRef.current?.blur()
                return
              }
              // Arrow Up on an empty draft while the chat runs stops it and brings its prompt back.
              if (shouldRecallPromptOnArrowUp({
                key, shiftKey, metaKey, ctrlKey, altKey, isComposing,
                isProcessing: !!context.busy,
                input: text,
                attachmentCount: files.items.length,
                loadingAttachmentCount: 0,
                followUpItemCount: context.canSendEmpty ? 1 : 0,
                inlineMenuOpen: commands.menuOpen,
                disabled: !context.onStop,
                disableSend: !!context.disabled,
              })) {
                event.preventDefault()
                context.onStop?.()
                return
              }
              if (sendKeyAction({ key, shiftKey, metaKey, ctrlKey, isComposing }, settings.sendKey) === 'send') {
                event.preventDefault()
                void send()
              }
            }}
          />
        </ComposerInput>
      </Composer>
    </>
  )
}
