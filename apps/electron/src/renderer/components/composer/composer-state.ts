/**
 * The shell composer's pure logic (docs/composer.md (f)): what a page tells it, the compact bar's state
 * machine, which look the shell draws, the first message of a chat started from a page, and the send key.
 */

import type { ReactNode } from 'react'
import type { FileAttachment } from '../../../shared/types'

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
  /** The page's own send (the chat, W2); else the default: a new chat led by `entity`. */
  onSend?: (message: { text: string; attachments: FileAttachment[] }) => Promise<void>
  busy?: boolean
  onStop?: () => void
  /** Full mode pickers (model, permission): the chat only (W2). */
  tools?: ReactNode
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

/** What the shell's slot draws: nothing, the compact bar or the expanded glass. */
export type ShellSurface = 'none' | 'compact' | 'expanded'

/**
 * The look for a page. Seam until W2 moves the chat's composer into the shell: a full chat ('chat:<id>',
 * the chat and the new chat) still draws its own `ChatInputZone`, so the shell draws nothing there (never two
 * composers); any other full page (the Inbox) shows the compact bar until the full look exists.
 */
export function resolveShellSurface(context: ComposerContext | null, view: ComposerView): ShellSurface {
  if (!context) return 'none'
  if (context.mode === 'full' && context.key.startsWith('chat:')) return 'none'
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
