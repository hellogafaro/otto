/**
 * The shell composer's pure logic (docs/composer.md (f)): what a page tells it, the compact bar's state
 * machine, which look the shell draws, the first message of a chat started from a page, the send key and the
 * main button's one action.
 */

import type { ReactNode } from 'react'
import type { PermissionMode } from '@otto/shared/agent/modes'
import type { FileAttachment } from '../../../shared/types'

/** What a send hands the page: the text, the files and the `@` mentions in it. */
export interface ComposerMessage {
  text: string
  attachments: FileAttachment[]
  /** Skills mentioned with `@` (qualified names). */
  skillSlugs: string[]
  /** Sources mentioned with `@`: the chat turns them on. */
  sourceSlugs: string[]
}

/** The `/` commands only a chat has (its session's settings); every page has Add files. */
export interface ComposerChatCommands {
  permissionMode?: PermissionMode
  onPermissionModeChange?: (mode: PermissionMode) => void
  /** The chat's status id; the statuses are the workspace's. */
  status?: string
  onStatusChange?: (status: string) => void
  onWorkingDirectoryChange?: (path: string) => void
  /** `/compact`: summarize the chat's context (not while it runs). */
  onCompact?: () => void
}

/** What a page tells the composer (`useComposerContext`); the last page mounted wins. */
export interface ComposerContext {
  /** Draft key and identity: 'chat:<id>', 'task:<id>', 'page:tasks'. */
  key: string
  /** The page's `<type>:<id>` token (`ENTITY_TOKEN`), shown as a chip and leading a chat started here. */
  entity?: string
  /** Already translated; default "Ask your agents about this page". */
  placeholder?: string
  /** Default 'compact'; 'full' on the chat, the new chat and the Inbox. */
  mode?: 'compact' | 'full'
  /** The chat's session id: scopes the chat's events (focus, paste, restore, submit) to it. */
  sessionId?: string
  /** The page's own send (the chat); else the default: a new chat led by `entity`. */
  onSend?: (message: ComposerMessage) => void | Promise<void>
  busy?: boolean
  /** Stop the run; `silent` when a new message replaces it (no "interrupted" line). */
  onStop?: (silent?: boolean) => void
  /** Full mode pickers (the chat's model) and anything laid over the action row (its status). */
  tools?: ReactNode
  /** Chips above the text in full mode (the chat's background tasks and follow-ups). */
  chips?: ReactNode
  /** Shown above the files while an image is among them (the chat's model cannot read images). */
  imageNotice?: ReactNode
  /** A request that replaces the composer's body in full mode (a permission, a credential). */
  structured?: ReactNode
  /** Something to send even with no text (the chat's pending follow-ups). */
  canSendEmpty?: boolean
  /** Sending is off (the chat's connection is gone); the text stays editable. */
  disabled?: boolean
  /** Where `@` finds files (the chat's working directory). */
  workingDirectory?: string
  commands?: ComposerChatCommands
}

/** The compact bar's own state; a full page has none (it never collapses). */
export type ComposerView = 'idle' | 'focused' | 'expanded'

export type ComposerEvent =
  | { type: 'focus' }
  /** Focus left the composer; `empty` when there is no text (nor files). */
  | { type: 'blur'; empty: boolean }
  | { type: 'escape' }
  /** The text wrapped or holds a line break (Shift+Enter, a paste). */
  | { type: 'wrap' }
  | { type: 'files' }
  | { type: 'expand' }
  | { type: 'collapse' }

/**
 * idle --focus--> focused --(wrap | files | expand)--> expanded
 * expanded --(escape | blur while empty | collapse)--> idle; focused --(escape | blur | collapse)--> idle.
 * The draft is kept either way. `expand` and `files` also open it from idle (prefill, a drop).
 */
export function composerReducer(view: ComposerView, event: ComposerEvent): ComposerView {
  switch (event.type) {
    case 'focus':
      return view === 'idle' ? 'focused' : view
    case 'wrap':
      return view === 'focused' ? 'expanded' : view
    case 'files':
    case 'expand':
      return 'expanded'
    case 'escape':
    case 'collapse':
      return 'idle'
    case 'blur':
      return view === 'expanded' && !event.empty ? 'expanded' : 'idle'
  }
}

/** What the shell's slot draws: nothing, the compact bar, the expanded glass or the full card. */
export type ShellSurface = 'none' | 'compact' | 'expanded' | 'full'

/** The look for a page: a full page (the chat, the new chat, the Inbox) is full; else the bar's own state. */
export function resolveShellSurface(context: ComposerContext | null, view: ComposerView): ShellSurface {
  if (!context) return 'none'
  if (context.mode === 'full') return 'full'
  return view === 'expanded' ? 'expanded' : 'compact'
}

/** The first message of a chat started from a page: its entity token first (drawn as a chip), then the text. */
export function buildFirstMessage(entity: string | undefined, text: string): string {
  const body = text.trim()
  return entity ? `${entity} ${body}` : body
}

export type SendKey = 'enter' | 'cmd-enter'

/** What a key press does, as the chat input does today: Enter (or ⌘/Ctrl+Enter, per the setting) sends. */
export function sendKeyAction(
  event: { key: string; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; isComposing: boolean },
  sendKey: SendKey,
): 'send' | null {
  if (event.key !== 'Enter' || event.isComposing || event.shiftKey) return null
  const mod = event.metaKey || event.ctrlKey
  return sendKey === 'enter' || mod ? 'send' : null
}

export type MainAction = 'sending' | 'stop' | 'transcribing' | 'done' | 'send' | 'dictate'

/** The main button's one action, in v1's priority order. */
export function mainAction(state: {
  sending: boolean
  busy: boolean
  transcribing: boolean
  listening: boolean
  hasContent: boolean
}): MainAction {
  if (state.sending) return 'sending'
  if (state.busy) return 'stop'
  if (state.transcribing) return 'transcribing'
  if (state.listening) return 'done'
  return state.hasContent ? 'send' : 'dictate'
}

/**
 * What the bar's attention slot draws (compact and expanded): while ⌘/Ctrl or Option/Alt is held, the ONE key
 * hint (the composer's own focus key); else the Inbox button while something needs you and nothing is written
 * or attached (then Send has the slot to itself); else nothing. Never while dictating.
 */
export function attentionSlot(state: { held: boolean; listening: boolean; empty: boolean; count: number }): 'key' | 'inbox' | null {
  if (state.listening) return null
  if (state.held) return 'key'
  return state.empty && state.count > 0 ? 'inbox' : null
}
