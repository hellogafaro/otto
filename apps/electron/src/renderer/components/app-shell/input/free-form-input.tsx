/**
 * FreeFormInput - the ONE composer: the chat input (Craft's, kept: rich text with `@` mention badges, `/` commands,
 * files, Send and Stop, Arrow Up to stop and recall, the chat's events). `ShellComposer` hosts the single instance
 * in the page frame's bottom composer slot, mounted once with the text and files kept across navigation.
 * It reads the page's context (`useComposerContext`), keeps a browser draft per context, takes files (+, drop, paste:
 * the attachment rail), dictates (`useDictation`, `transcription:create`), and sends: the page's own `onSend` (the
 * chat), else the default, a new chat whose first line is the page's entity token, opened at once.
 * The chat draws an instance of its own, not hosted, when the shell has no composer. See docs/composer.md.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUp, Check, Mic, Plus, Square, X } from 'lucide-react'
import { Button } from '@workspace/ui/components/button'
import { Composer, ComposerInput, ComposerMainButton } from '@workspace/ui/components/composer'
import { Kbd } from '@workspace/ui/components/kbd'
import { toast } from '@workspace/ui/components/sonner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { useAction } from '@/actions'
import { useAppShellContext } from '@/context/app-shell-context'
import { useLoadedAgents } from '@/hooks/use-agents'
import { ComposerFooter, type ComposerFooterProps } from '@/components/composer/composer-footer'
import { RichTextInput, type RichTextInputHandle } from '@/components/ui/rich-text-input'
import { shouldHandleScopedInputEvent, shouldRecallPromptOnArrowUp } from './input-event-guards'
import { clearPendingFocusForSession, consumePendingFocusForSession } from './focus-input-events'
import { appendRestoredInput } from '@/lib/input-text'
import { parseMentions, startsWithEntityMention } from '@/lib/mentions'
import { navigate, routes } from '@/lib/navigate'
import { hasOpenOverlay } from '@/lib/overlay-detection'
import { isMac } from '@/lib/platform'
import { applySmartTypography } from '@/lib/smart-typography'
import { AttachmentRail } from '@/components/composer/attachment-rail'
import { useComposerCommands } from '@/components/composer/composer-commands'
import type { ComposerHandle } from '@/components/composer/composer-provider'
import { buildFirstMessage, composerAgent, mainAction, sendKeyAction, type ComposerContext, type SendKey } from '@/components/composer/composer-state'
import { useComposerDraft } from '@/components/composer/use-composer-draft'
import { useComposerFiles } from '@/components/composer/use-composer-files'
import { useDictation } from '@/components/composer/use-dictation'
import { Dictation, Transcribing } from '@/components/composer/waveform'

export function FreeFormInput({ context, handleRef }: {
  context: ComposerContext | null
  /** The shell's host: the instance it fills is the one `useComposer()` drives and ⌘J focuses. */
  handleRef?: React.RefObject<ComposerHandle | null> | null
}) {
  const { t } = useTranslation()
  const hosted = !!handleRef
  const { activeWorkspaceId, onCreateSession, onInitLinkedPageSession, onSendMessage, onSessionSourcesChange } = useAppShellContext()
  const [text, setText] = useComposerDraft(activeWorkspaceId, context?.key ?? 'none')
  const files = useComposerFiles()
  const [sending, setSending] = React.useState(false)
  const sendingRef = React.useRef(false)
  const agents = useLoadedAgents()
  const [recipient, setRecipient] = React.useState<{ workspaceId: typeof activeWorkspaceId; agentId: string | null }>({ workspaceId: activeWorkspaceId, agentId: null })
  if (recipient.workspaceId !== activeWorkspaceId) setRecipient({ workspaceId: activeWorkspaceId, agentId: null })
  const pageAgent = composerAgent(agents, recipient.workspaceId === activeWorkspaceId ? recipient.agentId : null)
  const [dragging, setDragging] = React.useState(false)
  const inputRef = React.useRef<RichTextInputHandle>(null)
  const pickerRef = React.useRef<HTMLInputElement>(null)
  const sessionId = context?.sessionId
  const textRef = React.useRef(text)
  textRef.current = text
  const draftRef = React.useRef({ workspaceId: activeWorkspaceId, key: context?.key, text, items: files.items })
  draftRef.current = { workspaceId: activeWorkspaceId, key: context?.key, text, items: files.items }

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
    files.add(list)
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
  const listening = dictation.listening
  const dictating = listening || dictation.transcribing

  const commands = useComposerCommands({ inputRef, context, setText, onAddFiles: () => pickerRef.current?.click() })

  React.useImperativeHandle(handleRef ?? undefined, () => ({
    prefill: (value) => {
      const next = appendRestoredInput(textRef.current, value)
      setText(next)
      focusAt(next.length)
    },
    focus: () => focusAt(),
    take: () => {
      const value = textRef.current.trim()
      setText('')
      return value
    },
  }), [setText, focusAt])

  useAction('composer.focus', () => focusAt(), { enabled: () => hosted && inputRef.current !== null })

  const hasContent = text.trim() !== '' || files.items.length > 0 || !!context?.canSendEmpty
  const canSend = hasContent && files.ready && !sending && !context?.disabled && !listening && !dictation.transcribing && (!!context?.onSend || !!pageAgent)

  const send = async () => {
    if (!context || !canSend || sendingRef.current) return
    sendingRef.current = true
    const draft = draftRef.current
    const stillOwnsDraft = () => draftRef.current.workspaceId === draft.workspaceId && draftRef.current.key === draft.key
    const clearSentDraft = () => {
      if (!stillOwnsDraft()) return
      if (draftRef.current.text === draft.text) setText('')
      if (draftRef.current.items === draft.items) files.clear()
    }
    const message = text.trim()
    const mentions = parseMentions(message, commands.skills.map((skill) => skill.slug), commands.sources.map((source) => source.config.slug))
    const attachments = files.attachments
    setSending(true)
    try {
      if (context.onSend) {
        await context.onSend({ text: message, attachments, skillSlugs: mentions.skills, sourceSlugs: mentions.sources })
        clearSentDraft()
      } else {
        // The default: a new chat about this page, opened at once, its first message led by the page's token.
        if (!activeWorkspaceId) throw new Error('No workspace')
        if (!pageAgent) throw new Error('No recipient agent')
        const features = context.entity ? await window.electronAPI.getNativeFeatures() : undefined
        const session = context.entity && features?.linkedPageContext
          ? await onInitLinkedPageSession(activeWorkspaceId, context.entity)
          : await onCreateSession(activeWorkspaceId, { agentId: pageAgent.id })
        if (mentions.sources.length > 0) onSessionSourcesChange?.(session.id, mentions.sources)
        const accepted = await onSendMessage(
          session.id,
          buildFirstMessage(context.entity, message),
          attachments.length > 0 ? attachments : undefined,
          mentions.skills.length > 0 ? mentions.skills : undefined,
          undefined,
          { recipientAgentId: pageAgent.id },
        )
        if (!accepted) throw new Error('Message was not accepted.')
        clearSentDraft()
        if (stillOwnsDraft()) navigate(routes.view.allSessions(session.id))
      }
    } catch (error) {
      console.error('[FreeFormInput] send failed:', error)
      toast.error(t('composer.error.startChat'))
    } finally {
      sendingRef.current = false
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
      if (scoped(event) && restored) {
        const next = appendRestoredInput(textRef.current, restored)
        setText(next)
        focusAt(next.length)
      }
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

  // While listening, Enter is Done and Escape cancels, wherever the focus is (Escape also drops a take being transcribed).
  React.useEffect(() => {
    if (!dictating) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Enter' && listening) dictation.stop()
      else if (event.key === 'Escape') dictation.cancel()
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dictating, listening, dictation])

  if (!context) return null

  const placeholder = context.placeholder ?? t('composer.placeholder.page')
  const footerProps: ComposerFooterProps = context.footer ?? {
    picker: context.onSend ? null : {
      agents,
      agent: pageAgent,
      disabled: agents.length === 0,
      onChange: (agent) => setRecipient({ workspaceId: activeWorkspaceId, agentId: agent.id }),
    },
    participants: null,
  }
  const footer = <ComposerFooter {...footerProps} disabled={dictating || sending || !!context.disabled || footerProps.disabled} />

  // A pending request (a permission, a credential) takes the full composer's place until it is answered.
  if (context.structured) {
    return (
      <div data-slot="composer-dock" className="flex w-full min-w-0 flex-col">
        <Composer aria-label={placeholder} onSubmit={(event) => event.preventDefault()}>
          {context.structured}
        </Composer>
        {footer}
      </div>
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
    <AttachmentRail files={files.items} onRemove={sending ? undefined : files.remove} onRetry={files.retry} />
  )
  const chips = (
    <>
      {context.chips}
      {files.items.some((file) => file.type.startsWith('image/')) && context.imageNotice}
    </>
  )

  return (
    <>
      {commands.menus}
      <div data-slot="composer-dock" className="flex w-full min-w-0 flex-col">
        <Composer
          dragging={dragging}
          aria-label={placeholder}
          onSubmit={(event) => {
            event.preventDefault()
            void send()
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
          leading={dictating ? cancel : plus}
          tools={listening ? <Dictation /> : dictation.transcribing ? <Transcribing /> : context.tools}
          main={main}
        >
          <ComposerInput>
            <RichTextInput
              ref={inputRef}
              value={text}
              placeholder={placeholder}
              aria-label={placeholder}
              spellCheck={settings.spellCheck}
              skills={commands.skills}
              sources={commands.sources}
              workspaceId={commands.workspaceSlug}
              entityLabel={commands.entityLabel}
              onChange={setText}
              onInput={(value, cursor) => {
                commands.onInput(value, cursor)
                // Capitalise the first letter (not a command, mention or tag) and type arrows and dashes.
                if (settings.capitalise && value && !'/@#'.includes(value[0]!) && !startsWithEntityMention(value) && value[0] !== value[0]!.toUpperCase()) {
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
              onPaste={(event) => {
                if (event.clipboardData?.files.length) addFiles(event.clipboardData.files)
              }}
              onLongTextPaste={(pasted) => {
                files.addText(pasted)
              }}
              onKeyDown={(event) => {
                if (commands.takesKey(event)) return
                const { key, shiftKey, metaKey, ctrlKey, altKey } = event
                const isComposing = event.nativeEvent.isComposing
                if (key === 'Escape') {
                  if (isComposing || hasOpenOverlay()) return
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
        {footer}
      </div>
    </>
  )
}
