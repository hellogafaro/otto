/**
 * The shell composer's pure logic (docs/composer.md): what a page tells it,
 * the first message of a chat started from a page, the send key and the
 * main button's one action.
 */

import type { ReactNode } from 'react'
import type { PermissionMode } from '@otto/shared/agent/modes'
import type { Agent, FileAttachment } from '../../../shared/types'
import type { ComposerFooterProps } from './composer-footer'

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
  /** The chat's session id: scopes the chat's events (focus, paste, restore, submit) to it. */
  sessionId?: string
  /** The page's own send (the chat); else the default: a new chat led by `entity`. */
  onSend?: (message: ComposerMessage) => void | Promise<void>
  busy?: boolean
  /** Stop the run; `silent` when a new message replaces it (no "interrupted" line). */
  onStop?: (silent?: boolean) => void
  /** Recipient controls and anything laid over the action row (the chat's status). */
  tools?: ReactNode
  footer?: ComposerFooterProps
  /** Chips above the text (the chat's background tasks and follow-ups). */
  chips?: ReactNode
  /** Shown above the files while an image is among them (the chat's model cannot read images). */
  imageNotice?: ReactNode
  /** A request that replaces the composer's body (a permission, a credential). */
  structured?: ReactNode
  /** Something to send even with no text (the chat's pending follow-ups). */
  canSendEmpty?: boolean
  /** Sending is off (the chat's connection is gone); the text stays editable. */
  disabled?: boolean
  /** Where `@` finds files (the chat's working directory). */
  workingDirectory?: string
  commands?: ComposerChatCommands
}

/** The first message of a chat started from a page: its entity token first (drawn as a chip), then the text. */
export function buildFirstMessage(entity: string | undefined, text: string): string {
  const body = text.trim()
  return entity ? `${entity} ${body}` : body
}

export function composerAgent(agents: Agent[], agentId?: string | null): Agent | undefined {
  return agentId ? agents.find((agent) => agent.id === agentId) : agents.find((agent) => agent.isDefault)
}

export function chatAgentIds(chat: { agentId?: string; members?: string[] } | null): string[] {
  if (!chat) return []
  return [...new Set([
    ...(chat.agentId ? [chat.agentId] : []),
    ...(chat.members ?? []).filter((actor) => actor.startsWith('agent:')).map((actor) => actor.slice(6)),
  ])]
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
