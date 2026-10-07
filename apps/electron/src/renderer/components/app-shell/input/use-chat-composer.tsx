/**
 * The chat on the shell composer: the open chat (and the new chat, an empty one) registers a full composer that
 * sends into it (`onSend`; to a person picked under With, into your DM with them), stops it, shows its With picker
 * (an empty chat only), its model picker (not in a people chat: no agent runs there) and status over the action row (`tools`), its
 * background tasks, follow-ups and finished-elsewhere chip above the text (`chips`), a pending permission or
 * credential in place of the text (`structured`), and its `/` commands (mode, status, working directory, compact).
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { PermissionMode } from '@otto/shared/agent/modes'
import type { ThinkingLevel } from '@otto/shared/agent/thinking-levels'
import { Tooltip, TooltipContent, TooltipTrigger } from '@otto/ui'
import { useComposerContext } from '@/components/composer/use-composer-context'
import type { ComposerContext, ComposerMessage } from '@/components/composer/composer-state'
import { useEscapeInterrupt } from '@/context/escape-interrupt-context'
import { useAppShellContext } from '@/context/app-shell-context'
import { getModelDisplayName } from '@config/models'
import { isCompatProvider, modelSupportsImages, resolveEffectiveConnectionSlug } from '@config/llm-connections'
import { AGENT_DEFAULT_NAME } from '@otto/shared/branding'
import { AgentPicker } from '@/components/composer/agent-picker'
import { useNewChatAgent } from '@/components/composer/use-new-chat-agent'
import { useChatMembers } from '@/hooks/use-chat-members'
import { isAgentActor, isPeopleChat } from '@/lib/actors'
import { formatNameList } from '@/utils/session'
import type { FileAttachment, Session } from '../../../../shared/types'
import { BackgroundFinishedChip } from '../background-finished-chip'
import { ImageSupportWarningBanner } from './image-support-warning-banner'
import { ModelMenu } from './model-menu'
import { stripPiPrefixForDisplay } from './model-picker-helpers'
import { useModelVisionToggle } from './use-model-vision-toggle'
import { StructuredInput } from './structured-input'
import type { StructuredInputState, StructuredResponse } from './structured/types'
import { ToolbarStatusSlot } from './toolbar-status-slot'

export interface FollowUpInputItem {
  id: string
  messageId: string
  annotationId: string
  index?: number
  noteLabel: string
  selectedText: string
  color?: string
}

function formatFollowUpChipText(text: string, fallback: string, maxLength = 50): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return fallback
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1).trimEnd()}…` : normalized
}

/** A follow-up note on a reply, sent along with the next message (moved from the old chat input). */
function FollowUpChip({ item, index, onClick, onIndexClick }: {
  item: FollowUpInputItem
  index: number
  onClick?: (item: FollowUpInputItem, anchor?: { x: number; y: number }) => void
  onIndexClick?: (item: FollowUpInputItem) => void
}) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      className="inline-flex max-w-full items-center gap-1.5 overflow-hidden rounded-sm bg-foreground/5 py-1 pr-2 pl-1.5 text-[13px] text-foreground/80 select-none transition-colors hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect()
        onClick?.(item, { x: rect.left + rect.width / 2, y: rect.top - 8 })
      }}
    >
      <Tooltip delayDuration={250}>
        <TooltipTrigger asChild>
          <span
            role="button"
            tabIndex={0}
            className="inline-flex h-4 min-w-4 cursor-pointer items-center justify-center rounded-xs bg-card px-0.5 text-[10px] font-medium text-foreground card-surface"
            onMouseDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
            }}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              onIndexClick?.(item)
            }}
          >
            {index}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[420px] break-words text-xs">
          {item.selectedText.trim() || t('chat.selectedText')}
        </TooltipContent>
      </Tooltip>
      <span className="min-w-0 truncate pr-0.5 text-left">
        <span className="italic text-foreground/60">{formatFollowUpChipText(item.selectedText, t('chat.selectedText'))}</span>
        <span className="mx-1 text-foreground/40">·</span>
        <span>{formatFollowUpChipText(item.noteLabel, t('chat.followUp'))}</span>
      </span>
    </button>
  )
}

export function useChatComposer({
  enabled,
  placeholder,
  session,
  onSubmit,
  onStop,
  disabled,
  sources,
  enabledSourceSlugs,
  onSourcesChange,
  model,
  permissionMode,
  onPermissionModeChange,
  onSessionStatusChange,
  workingDirectory,
  onWorkingDirectoryChange,
  structuredInput,
  onStructuredResponse,
  followUps,
  onFollowUpClick,
  onFollowUpIndexClick,
}: {
  /** Registered with the shell only by the chat page; the edit popover draws its own `FreeFormInput` with the result. */
  enabled: boolean
  /** The edit popover's own placeholder. */
  placeholder?: string
  session: Session | null
  onSubmit: (message: string, attachments?: FileAttachment[], skillSlugs?: string[]) => void
  onStop: (silent?: boolean) => void
  disabled: boolean
  sources?: { config: { slug: string } }[]
  enabledSourceSlugs?: string[]
  onSourcesChange?: (slugs: string[]) => void
  model: {
    currentModel: string
    onModelChange: (model: string, connection?: string) => void
    thinkingLevel?: ThinkingLevel
    onThinkingLevelChange?: (level: ThinkingLevel) => void
    onConnectionChange?: (connectionSlug: string) => void
    connectionUnavailable?: boolean
  }
  permissionMode?: PermissionMode
  onPermissionModeChange?: (mode: PermissionMode) => void
  onSessionStatusChange?: (status: string) => void
  workingDirectory?: string
  onWorkingDirectoryChange?: (path: string) => void
  structuredInput?: StructuredInputState
  onStructuredResponse: (response: StructuredResponse) => void
  followUps: FollowUpInputItem[]
  onFollowUpClick?: (item: FollowUpInputItem, anchor?: { x: number; y: number }) => void
  onFollowUpIndexClick?: (item: FollowUpInputItem) => void
}) {
  const { t } = useTranslation()
  const { showEscapeOverlay } = useEscapeInterrupt()
  const { llmConnections, workspaceDefaultLlmConnection } = useAppShellContext()
  const toggleVision = useModelVisionToggle()
  const sessionId = session?.id ?? ''
  const isEmpty = (session?.messages.length ?? 0) === 0
  const busy = !!session?.isProcessing
  // An empty chat picks who it is with; a chat that has started talks to the agent it was created with.
  const { agents, agent, pick, people, person, pickPerson, sendToPerson } = useNewChatAgent(session)
  const { others } = useChatMembers(session)
  // A people chat (a DM or a group, or a person picked under With) runs no agent: no model picker, no image notice.
  const peopleChat = !!person || (!!session && isPeopleChat(session))

  // Stable callbacks over the latest values, so a streaming chat does not re-register on every frame.
  const latest = React.useRef({ onSubmit, onStop, onSourcesChange, enabledSourceSlugs, person, sendToPerson })
  latest.current = { onSubmit, onStop, onSourcesChange, enabledSourceSlugs, person, sendToPerson }
  const onSend = React.useCallback(({ text, attachments, skillSlugs, sourceSlugs }: ComposerMessage) => {
    const { onSubmit: submit, onSourcesChange: changeSources, enabledSourceSlugs: enabled = [] } = latest.current
    if (latest.current.person) {
      void latest.current.sendToPerson(text, attachments.length > 0 ? attachments : undefined, skillSlugs.length > 0 ? skillSlugs : undefined)
      return
    }
    // Sources mentioned with @ are turned on for the chat.
    const next = [...new Set([...enabled, ...sourceSlugs])]
    if (next.length > enabled.length) changeSources?.(next)
    submit(text, attachments.length > 0 ? attachments : undefined, skillSlugs.length > 0 ? skillSlugs : undefined)
  }, [])
  const stop = React.useCallback((silent?: boolean) => latest.current.onStop(silent), [])

  const commands = React.useMemo(() => ({
    permissionMode,
    onPermissionModeChange,
    status: session?.sessionStatus || 'todo',
    onStatusChange: onSessionStatusChange,
    onWorkingDirectoryChange,
    onCompact: busy ? undefined : () => latest.current.onSubmit('/compact'),
  }), [permissionMode, onPermissionModeChange, session?.sessionStatus, onSessionStatusChange, onWorkingDirectoryChange, busy])

  const contextStatus = {
    isCompacting: session?.currentStatus?.statusType === 'compacting',
    inputTokens: session?.tokenUsage?.inputTokens,
    contextWindow: session?.tokenUsage?.contextWindow,
    contextUsage: session?.tokenUsage?.contextUsage,
  }

  const tools = (
    <>
      <ToolbarStatusSlot showEscapeOverlay={busy && showEscapeOverlay} />
      {isEmpty && agent && !(session && isPeopleChat(session)) && <AgentPicker agents={agents} agent={agent} people={people} person={person} onChange={pick} onPickPerson={pickPerson} />}
      {!peopleChat && (
        <ModelMenu
          {...model}
          currentConnection={session?.llmConnection}
          isEmptySession={isEmpty}
          contextStatus={contextStatus}
        />
      )}
    </>
  )

  // Staged images would be dropped by a text-only custom-endpoint model: the composer warns while one is staged.
  const connection = llmConnections.find((entry) => entry.slug === resolveEffectiveConnectionSlug(session?.llmConnection, workspaceDefaultLlmConnection, llmConnections))
  const imageNotice = !peopleChat && connection && isCompatProvider(connection.type) && !modelSupportsImages(connection, model.currentModel)
    ? <ImageSupportWarningBanner modelName={stripPiPrefixForDisplay(getModelDisplayName(model.currentModel))} onEnable={() => toggleVision(connection.slug, model.currentModel, true)} />
    : undefined

  const hasChips = followUps.length > 0
  const chips = (
    <>
      <BackgroundFinishedChip sessionId={sessionId} />
      {hasChips && (
        <div className="flex flex-wrap items-center gap-1">
          {followUps.map((item, index) => (
            <FollowUpChip key={item.id} item={item} index={item.index ?? index + 1} onClick={onFollowUpClick} onIndexClick={onFollowUpIndexClick} />
          ))}
        </div>
      )}
    </>
  )

  // "Message Ada and Grace" where people talk (a person picked, a people chat, more than one person), else "Reply to" the agent.
  function chatPlaceholder() {
    const picked = person && people.find((entry) => entry.actor === person)
    if (picked) return t('composer.placeholder.message', { names: picked.name })
    if (isEmpty) return t('composer.placeholder.start')
    const humans = (session?.members ?? []).filter((actor) => !isAgentActor(actor)).length
    if ((peopleChat || humans > 1) && others.length > 0) return t('composer.placeholder.message', { names: formatNameList(others.map((member) => member.name)) })
    return t('composer.placeholder.reply', { agent: agent?.title ?? AGENT_DEFAULT_NAME })
  }

  const context: ComposerContext = {
    key: session ? `chat:${session.id}` : 'none',
    mode: 'full',
    sessionId: session ? sessionId : undefined,
    placeholder: placeholder ?? chatPlaceholder(),
    onSend,
    busy,
    onStop: stop,
    tools,
    chips,
    imageNotice,
    structured: structuredInput ? <StructuredInput state={structuredInput} onResponse={onStructuredResponse} unstyled /> : undefined,
    canSendEmpty: followUps.length > 0,
    disabled,
    workingDirectory,
    commands,
  }
  useComposerContext(context, enabled && !!session)
  return context
}
