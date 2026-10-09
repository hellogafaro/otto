import * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { PermissionMode } from '@otto/shared/agent/modes'
import type { ThinkingLevel } from '@otto/shared/agent/thinking-levels'
import { Tooltip, TooltipContent, TooltipTrigger } from '@otto/ui'
import { useComposerContext } from '@/components/composer/use-composer-context'
import { chatAgentIds, composerAgent, type ComposerContext, type ComposerMessage } from '@/components/composer/composer-state'
import { useEscapeInterrupt } from '@/context/escape-interrupt-context'
import { useAppShellContext } from '@/context/app-shell-context'
import { getModelDisplayName } from '@config/models'
import { isCompatProvider, modelSupportsImages, resolveEffectiveConnectionSlug } from '@config/llm-connections'
import { useChatMembers } from '@/hooks/use-chat-members'
import { isAgentActor, isPeopleChat } from '@/lib/actors'
import { formatNameList } from '@/utils/session'
import type { FileAttachment, SendMessageOptions, Session } from '../../../../shared/types'
import { BackgroundFinishedChip } from '../background-finished-chip'
import { ImageSupportWarningBanner } from './image-support-warning-banner'
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
  onSubmit: (message: string, attachments?: FileAttachment[], skillSlugs?: string[], options?: SendMessageOptions) => void | boolean | Promise<void | boolean>
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
  const agentIds = chatAgentIds(session)
  const { members, others } = useChatMembers(session)
  const agents = members.flatMap((member) => member.agent ? [member.agent] : [])
  const [recipient, setRecipient] = React.useState<{ sessionId: string; agentId?: string }>({ sessionId })
  if (recipient.sessionId !== sessionId) setRecipient({ sessionId })
  const mounted = React.useRef(true)
  React.useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  const recipientId = recipient.sessionId === sessionId ? recipient.agentId : undefined
  const agent = recipientId ? composerAgent(agents, recipientId) : agents.length === 1 ? agents[0] : undefined
  const pick = (next: typeof agents[number]) => {
    if (agents.some((entry) => entry.id === next.id)) setRecipient({ sessionId, agentId: next.id })
  }
  const peopleChat = !!session && isPeopleChat(session)

  // Stable callbacks over the latest values, so a streaming chat does not re-register on every frame.
  const latest = React.useRef({ onSubmit, onStop, onSourcesChange, enabledSourceSlugs, sessionId, recipientId, agents, disabled })
  latest.current = { onSubmit, onStop, onSourcesChange, enabledSourceSlugs, sessionId, recipientId, agents, disabled }
  const onSend = React.useCallback(async ({ text, attachments, skillSlugs, sourceSlugs }: ComposerMessage) => {
    const { onSubmit: submit, onSourcesChange: changeSources, enabledSourceSlugs: enabled = [], sessionId: id, recipientId: selected, agents: eligible } = latest.current
    if (!mounted.current || !id || latest.current.disabled) throw new Error('This conversation is unavailable.')
    if (selected) {
      if (!eligible.some((entry) => entry.id === selected)) throw new Error('The selected recipient is unavailable.')
      const [current, visible] = await Promise.all([window.electronAPI.getSessionMessages(id), window.electronAPI.getAgents()])
      if (!mounted.current || latest.current.sessionId !== id || latest.current.recipientId !== selected || latest.current.disabled || !current?.members?.includes(`agent:${selected}`) || !visible.some((entry) => entry.id === selected)) {
        throw new Error('The selected recipient is unavailable.')
      }
    }
    // Sources mentioned with @ are turned on for the chat.
    const next = [...new Set([...enabled, ...sourceSlugs])]
    if (next.length > enabled.length) changeSources?.(next)
    const accepted = await submit(text, attachments.length > 0 ? attachments : undefined, skillSlugs.length > 0 ? skillSlugs : undefined, selected ? { recipientAgentId: selected } : undefined)
    if (accepted === false) throw new Error('The message was not accepted.')
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

  const tools = (
    <>
      <ToolbarStatusSlot showEscapeOverlay={busy && showEscapeOverlay} />
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
    if (isEmpty) return t('composer.placeholder.start')
    const humans = (session?.members ?? []).filter((actor) => !isAgentActor(actor)).length
    if ((peopleChat || humans > 1 || agentIds.length > 1) && others.length > 0) return t('composer.placeholder.message', { names: formatNameList(others.map((member) => member.name)) })
    return agent ? t('composer.placeholder.reply', { agent: agent.title }) : t('composer.placeholder.page')
  }

  const context: ComposerContext = {
    key: session ? `chat:${session.id}` : 'none',
    sessionId: session ? sessionId : undefined,
    placeholder: placeholder ?? chatPlaceholder(),
    onSend,
    busy,
    onStop: stop,
    tools,
    footer: {
      picker: agents.length > 0 && !peopleChat ? { agents, agent, onChange: pick } : null,
      participants: session?.members ? members : null,
      disabled,
    },
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
