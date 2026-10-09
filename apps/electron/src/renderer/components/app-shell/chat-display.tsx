import * as React from "react"
import { useTranslation } from "react-i18next"
import { useEffect, useState, useMemo, useCallback } from "react"
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Info,
} from "lucide-react"
import { motion, AnimatePresence } from "motion/react"
import { useSetAtom } from "jotai"
import { loadOlderSessionMessagesAtom } from "@/atoms/sessions"
import { toast } from '@workspace/ui/components/sonner'

import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { coerceInputText } from "@/lib/input-text"
import { AnimatedCollapsibleContent } from "@/components/ui/collapsible"
import { Spinner } from "@workspace/ui/components/spinner"
import { useFocusZone } from "@/hooks/keyboard"
import type { Session, Message, FileAttachment, PermissionRequest, CredentialRequest, CredentialResponse, LoadedSource, SendMessageOptions } from "../../../shared/types"
import type { PermissionMode } from "@otto/shared/agent/modes"
import type { ThinkingLevel } from "@otto/shared/agent/thinking-levels"
import {
  TurnCard,
  UserMessage,
  groupMessagesByTurn,
  getAssistantTurnUiKey,
  asRecord,
  getAnnotationNoteText,
  isAnnotationFollowUpSent,
  extractAnnotationSelectedText,
  normalizeFollowUpText,
  type Turn,
} from "@otto/ui"
import { MemoizedAuthRequestCard } from "@/components/chat/auth-request-card"
import type { StructuredInputState, StructuredResponse, PermissionResponse, AdminApprovalResponse } from "./input"
import { FreeFormInput } from "./input/free-form-input"
import { useChatComposer } from "./input/use-chat-composer"
import { usePlanApproval } from "./input/use-plan-approval"
import { useComposer } from "@/components/composer/composer-provider"
import { EntityText } from "@/components/entities/entity-text"
import { useEntityData } from "@/components/entities/entity-chip"
import { Button } from "@/components/ui/button"
import { useTurnCardExpansion } from "@/hooks/use-turn-card-expansion"
import { navigate, routes } from "@/lib/navigate"
import { CHAT_LAYOUT } from "@/config/layout"
import { handleErrorMessageAction } from "./error-message-actions"
import { Marker, MarkerContent, MarkerIcon } from "@workspace/ui/components/marker"
import { dayLabel, firstUnreadTurn, layoutTranscript, turnActor } from "./chat-transcript"
import { MessageRow, WindowedRow, useTranscriptPeople, useTranscriptWindowing } from "./chat-message"

// ============================================================================
// CSS Custom Highlight API helper
// ============================================================================

/** Access CSS.highlights lazily — avoids stale ref from module-init / HMR timing */
function getCSSHighlights(): Map<string, Highlight> | undefined {
  try {
    return (CSS as any).highlights as Map<string, Highlight> | undefined
  } catch {
    return undefined
  }
}

function getTurnKey(turn: Turn): string {
  if (turn.type === 'user') return `user-${turn.message.id}`
  if (turn.type === 'system') return `system-${turn.message.id}`
  if (turn.type === 'auth-request') return `auth-${turn.message.id}`
  return `turn-${turn.turnId}-${turn.timestamp}`
}

interface ChatDisplayProps {
  session: Session | null
  onSendMessage: (message: string, attachments?: FileAttachment[], skillSlugs?: string[], options?: SendMessageOptions) => void | boolean | Promise<void | boolean>
  onOpenFile: (path: string) => void
  onOpenUrl: (url: string) => void
  // Model selection
  currentModel: string
  onModelChange: (model: string, connection?: string) => void
  // Connection selection (locked after first message)
  /** Callback when LLM connection changes (only works when session is empty) */
  onConnectionChange?: (connectionSlug: string) => void
  /** When true, disables input (e.g., when agent needs activation) */
  disabled?: boolean
  /** Pending permission request for this session */
  pendingPermission?: PermissionRequest
  /** Callback to respond to permission request */
  onRespondToPermission?: (
    sessionId: string,
    requestId: string,
    allowed: boolean,
    alwaysAllow: boolean,
    options?: import('../../../shared/types').PermissionResponseOptions
  ) => Promise<boolean>
  /** Pending credential request for this session */
  pendingCredential?: CredentialRequest
  /** Callback to respond to credential request */
  onRespondToCredential?: (sessionId: string, requestId: string, response: CredentialResponse) => void
  // Thinking level (session-level setting)
  /** Current thinking level ('off', 'think', 'max') */
  thinkingLevel?: ThinkingLevel
  /** Callback when thinking level changes */
  onThinkingLevelChange?: (level: ThinkingLevel) => void
  // Advanced options
  /** Current permission mode */
  permissionMode?: PermissionMode
  /** Mode before the last change (plan approval returns to Guarded from it) */
  previousPermissionMode?: PermissionMode
  onPermissionModeChange?: (mode: PermissionMode) => void
  // Source selection
  /** Available sources (enabled only): `@` turns them on for the chat */
  sources?: LoadedSource[]
  /** Callback when source selection changes */
  onSourcesChange?: (slugs: string[]) => void
  /** Callback when session state changes (the `/` status command) */
  onSessionStatusChange?: (stateId: string) => void
  // Working directory (per session)
  /** Current working directory for this session (where `@` finds files) */
  workingDirectory?: string
  /** Callback when working directory changes (the `/` folder command) */
  onWorkingDirectoryChange?: (path: string) => void
  // Lazy loading
  /** When true, messages are still loading - show spinner in messages area */
  messagesLoading?: boolean
  /** Message load failure shown instead of an infinite spinner */
  messagesLoadError?: string | null
  /** Whether a retry is currently in flight */
  messagesRetrying?: boolean
  /** Retry lazy-loading the session transcript */
  onRetryMessagesLoad?: () => void
  // Tutorial
  /** Disable send action (for tutorial guidance) */
  disableSend?: boolean
  // Search highlighting (from session list search)
  /** Search query for highlighting matches - passed from session list */
  searchQuery?: string
  /** Whether search mode is active (prevents focus stealing to chat input) */
  isSearchModeActive?: boolean
  /** Callback when match info changes - for immediate UI updates */
  onMatchInfoChange?: (info: { count: number; index: number; isHighlighting: boolean; sessionId: string | null }) => void
  // Compact mode (auto-compact / WebUI mobile)
  /** Enable compact mode - hides non-essential UI elements for popover embedding */
  compactMode?: boolean
  /**
   * The chat page: its input is the shell composer (registered here, drawn by the shell). Without it (the edit
   * popover) the chat draws its own small input.
   */
  shellComposer?: boolean
  /** Custom placeholder(s) for the popover's input (the first is shown) */
  placeholder?: string | string[]
  /** Label shown as empty state in compact mode (e.g., "Permission Settings") */
  emptyStateLabel?: string
  /** When true, the session's locked connection has been removed - disables send and shows unavailable state */
  connectionUnavailable?: boolean
}

import {
  formatFollowUpSection,
  normalizeFollowUpsMarkdown,
  truncateForChipTooltip,
  type PendingFollowUpAnnotation,
} from './chat-display.follow-ups'

/**
 * Imperative handle exposed via forwardRef for navigation between matches
 */
export interface ChatDisplayHandle {
  goToNextMatch: () => void
  goToPrevMatch: () => void
  matchCount: number
  currentMatchIndex: number
  isHighlighting: boolean
}
function ProcessingIndicator({ statusMessage }: { statusMessage?: string }) {
  const { t } = useTranslation()
  return (
    <Marker role="status" aria-live="polite">
      <MarkerIcon><Spinner role="presentation" aria-hidden="true" aria-label={undefined} /></MarkerIcon>
      <MarkerContent>{statusMessage || t('chat.processing.working')}</MarkerContent>
    </Marker>
  )
}


/**
 * Scrolls to target element on mount, before browser paint.
 * Uses useLayoutEffect to ensure scroll happens before content is visible.
 */
function ScrollOnMount({
  targetRef,
  onScroll,
  skip = false
}: {
  targetRef: React.RefObject<HTMLDivElement | null>
  onScroll?: () => void
  skip?: boolean
}) {
  React.useLayoutEffect(() => {
    if (skip) return
    const scroll = () => {
      targetRef.current?.scrollIntoView({ behavior: 'instant' })
      onScroll?.()
    }
    // On the first mount the anchor (a later sibling) has no ref yet: scroll in the next frame, still before paint.
    // Without it a chat opened by URL stayed at its top, and the follow-up smooth scroll paged older messages in.
    if (targetRef.current) scroll()
    else requestAnimationFrame(scroll)
  }, [skip])
  return null
}

/**
 * ChatDisplay - Main chat interface for a selected session
 *
 * Structure:
 * - Session Header: Avatar + workspace name
 * - Messages Area: Scrollable list of MessageBubble components
 * - Input Area: Textarea + Send button
 *
 * Shows empty state when no session is selected
 */
export const ChatDisplay = React.forwardRef<ChatDisplayHandle, ChatDisplayProps>(function ChatDisplay({
  session,
  onSendMessage,
  onOpenFile,
  onOpenUrl,
  currentModel,
  onModelChange,
  onConnectionChange,
  disabled = false,
  pendingPermission,
  onRespondToPermission,
  pendingCredential,
  onRespondToCredential,
  // Thinking level
  thinkingLevel = 'medium',
  onThinkingLevelChange,
  // Advanced options
  permissionMode = 'ask',
  previousPermissionMode,
  onPermissionModeChange,
  // Sources
  sources,
  onSourcesChange,
  onSessionStatusChange,
  // Working directory
  workingDirectory,
  onWorkingDirectoryChange,
  // Lazy loading
  messagesLoading = false,
  messagesLoadError,
  messagesRetrying = false,
  onRetryMessagesLoad,
  // Tutorial
  disableSend = false,
  // Search highlighting
  searchQuery: externalSearchQuery,
  isSearchModeActive = false,
  onMatchInfoChange,
  // Compact mode (auto-compact / WebUI mobile)
  compactMode = false,
  shellComposer = false,
  placeholder,
  emptyStateLabel,
  // Connection unavailable
  connectionUnavailable = false,
}, ref) {
  const { t, i18n } = useTranslation()

  // Input is only disabled when explicitly disabled (e.g., agent needs activation)
  // User can type during streaming - submitting will stop the stream and send
  const isInputDisabled = disabled
  const messagesEndRef = React.useRef<HTMLDivElement>(null)
  const scrollViewportRef = React.useRef<HTMLDivElement>(null)
  const prevSessionIdRef = React.useRef<string | null>(null)
  // Reverse pagination: show last N turns initially, load more on scroll up
  const TURNS_PER_PAGE = 20
  const [visibleTurnCount, setVisibleTurnCount] = React.useState(TURNS_PER_PAGE)
  // Sticky-bottom: When true, auto-scroll on content changes. Toggled by user scroll behavior.
  const isStickToBottomRef = React.useRef(true)
  // Skip smooth scroll briefly after session switch (instant scroll already happened)
  const skipSmoothScrollUntilRef = React.useRef(0)
  // Track message commit boundaries so we can auto-scroll when a new user message
  // actually lands in state (important when attachments delay optimistic insertion).
  const prevLastMessageIdRef = React.useRef<string | null>(null)
  const prevMessageCountRef = React.useRef(0)
  const prevSessionIdForCommitScrollRef = React.useRef<string | null>(null)
  const composer = useComposer()
  // User messages draw their typed references (`task:<id>`) as chips, which read the shared lists.
  useEntityData()
  const [sendMessageKey, setSendMessageKey] = useState<'enter' | 'cmd-enter'>('enter')
  const [openAnnotationRequest, setOpenAnnotationRequest] = React.useState<{
    messageId: string
    annotationId: string
    mode: 'view' | 'edit'
    anchorX?: number
    anchorY?: number
    nonce: number
  } | null>(null)
  const followUpOpenNonceRef = React.useRef(0)

  // Register as focus zone - when zone gains focus, focus the textarea
  const { zoneRef, isFocused } = useFocusZone({
    zoneId: 'chat',
    focusFirst: () => {
      composer.focus()
    },
  })

  // TurnCard expansion state — persisted to localStorage across session switches
  const {
    expandedTurns,
    toggleTurn,
    expandedActivityGroups,
    setExpandedActivityGroups,
  } = useTurnCardExpansion(session?.id)


  // ============================================================================
  // Search Highlighting (from session list search)
  // ============================================================================
  // Current match index for navigation (internal state, exposed via ref)
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0)
  const turnRefs = React.useRef<Map<string, HTMLDivElement>>(new Map())
  // Inject ::highlight() styles at runtime to avoid LightningCSS build warnings
  // (the optimizer doesn't recognize ::highlight as a valid pseudo-element yet)
  React.useEffect(() => {
    const id = 'search-highlight-styles'
    if (document.getElementById(id)) return
    const style = document.createElement('style')
    style.id = id
    style.textContent = `
      ::highlight(search-passive) { background-color: rgb(253 224 71 / 0.3); color: inherit; }
      ::highlight(search-active) { background-color: rgb(253 224 71); color: rgb(0 0 0 / 0.9); }
    `
    document.head.appendChild(style)
  }, [])
  // Flag to control when scrolling to matches should happen
  // Only scroll when: session changes with search active, or user clicks navigation
  const shouldScrollToMatchRef = React.useRef(false)
  const prevSessionIdForScrollRef = React.useRef<string | null>(null)

  // Use the external search query from props
  const searchQuery = externalSearchQuery || ''
  // Require 2+ characters to activate in-chat search (aligned with session list isSearchMode)
  const isSearchActive = searchQuery.trim().length >= 2

  // Focus textarea when zone gains focus via keyboard (Tab, Cmd+3, ArrowRight)
  // Requires isFocused to be true - respects zone architecture
  // Does NOT auto-focus just because session changed (that would steal focus from SessionList)
  // Uses isSearchModeActive (prop) instead of isSearchActive (query-based) to prevent
  // focus stealing when search is open but query is empty
  useEffect(() => {
    if (session && !isSearchModeActive && isFocused) {
      composer.focus()
    }
  }, [session?.id, isFocused, isSearchModeActive])

  useEffect(() => {
    let isMounted = true

    const loadSendMessageKey = async () => {
      if (!window.electronAPI) return

      try {
        const key = await window.electronAPI.getSendMessageKey()
        if (!isMounted) return
        setSendMessageKey(key ?? 'enter')
      } catch (error) {
        console.error('Failed to load send message key for follow-up view:', error)
      }
    }

    loadSendMessageKey()

    return () => {
      isMounted = false
    }
  }, [])

  // Reset match state when session or search query changes
  useEffect(() => {
    const isSessionSwitch = prevSessionIdForScrollRef.current !== null && prevSessionIdForScrollRef.current !== session?.id
    prevSessionIdForScrollRef.current = session?.id ?? null

    // If session switched with search active, trigger scroll to first match
    if (isSessionSwitch && isSearchActive) {
      shouldScrollToMatchRef.current = true
    }

    setCurrentMatchIndex(0)
  }, [session?.id, searchQuery, isSearchActive])

  // Helper to count occurrences of a substring
  const countOccurrences = useCallback((text: string, query: string): number => {
    const lowerText = text.toLowerCase()
    const lowerQuery = query.toLowerCase()
    let count = 0
    let pos = 0
    while ((pos = lowerText.indexOf(lowerQuery, pos)) !== -1) {
      count++
      pos += lowerQuery.length
    }
    return count
  }, [])

  // Find ALL individual match occurrences (not just turns)
  // Returns array with unique matchId for each occurrence
  const matchingOccurrences = useMemo(() => {
    if (!searchQuery.trim() || !session?.messages) return []
    const query = searchQuery.toLowerCase()
    const turns = groupMessagesByTurn(session.messages, { isSessionProcessing: session.isProcessing })
    const matches: { matchId: string; turnId: string; turnIndex: number; matchIndexInTurn: number }[] = []

    for (let turnIndex = 0; turnIndex < turns.length; turnIndex++) {
      const turn = turns[turnIndex]
      let textContent = ''
      let turnId = ''

      // Use getTurnKey() for consistent IDs between text scan and DOM refs
      turnId = getTurnKey(turn)

      if (turn.type === 'user') {
        const content = turn.message.content as unknown
        if (typeof content === 'string') {
          textContent = content
        } else if (Array.isArray(content)) {
          textContent = content
            .filter((block: { type?: string }) => block.type === 'text')
            .map((block: { text?: string }) => block.text || '')
            .join('\n')
        }
      } else if (turn.type === 'assistant') {
        if (turn.response?.text) {
          textContent = turn.response.text
        }
      } else if (turn.type === 'system') {
        textContent = turn.message.content
      }

      // Count occurrences in this turn's text content
      const occurrenceCount = countOccurrences(textContent, query)
      for (let i = 0; i < occurrenceCount; i++) {
        matches.push({
          matchId: `${turnId}-match-${i}`,
          turnId,
          turnIndex,
          matchIndexInTurn: i,
        })
      }
    }
    return matches
  }, [searchQuery, session?.messages, session?.isProcessing, countOccurrences])

  // Auto-expand pagination when search is active to show all matching turns
  // This ensures match count is stable and all matches are highlightable from the start
  useEffect(() => {
    if (!isSearchActive || matchingOccurrences.length === 0) return

    // Find the earliest matching turn index (reduce to avoid RangeError on large arrays)
    const earliestMatchTurnIndex = matchingOccurrences.reduce(
      (min, m) => m.turnIndex < min ? m.turnIndex : min,
      matchingOccurrences[0]!.turnIndex
    )
    const totalTurns = groupMessagesByTurn(session?.messages || [], { isSessionProcessing: session?.isProcessing }).length

    // Calculate how many turns we need to show to include all matches
    // totalTurns - visibleTurnCount = startIndex, so we need visibleTurnCount = totalTurns - earliestMatchTurnIndex + buffer
    const requiredVisibleCount = totalTurns - earliestMatchTurnIndex + 5 // +5 buffer for context

    if (requiredVisibleCount > visibleTurnCount) {
      setVisibleTurnCount(requiredVisibleCount)
    }
  }, [isSearchActive, matchingOccurrences, session?.messages, session?.isProcessing, visibleTurnCount])

  // Extract unique turn IDs that have matches (for highlighting)
  const matchingTurnIds = useMemo(() => {
    const uniqueTurnIds = new Set(matchingOccurrences.map(m => m.turnId))
    return Array.from(uniqueTurnIds)
  }, [matchingOccurrences])

  // With CSS Custom Highlight API, navigation is driven by logical matches — no DOM verification needed.
  const validMatches = matchingOccurrences

  // Auto-scroll to match ONLY when there's exactly one match
  // Multiple matches: user navigates with chevrons to avoid jarring scroll
  useEffect(() => {
    if (validMatches.length === 1 && isSearchActive) {
      shouldScrollToMatchRef.current = true
    }
  }, [validMatches.length, isSearchActive])

  // Scroll to current match turn
  // Only scrolls when shouldScrollToMatchRef is true (single match auto-scroll or nav button click)
  useEffect(() => {
    if (!shouldScrollToMatchRef.current) return

    if (validMatches.length > 0 && currentMatchIndex < validMatches.length) {
      const matchData = validMatches[currentMatchIndex]
      const { turnId, turnIndex } = matchData
      const totalTurns = totalTurnCountRef.current

      // Check if the match is outside the visible range
      const currentStartIndex = Math.max(0, totalTurns - visibleTurnCount)
      if (turnIndex < currentStartIndex) {
        const newVisibleCount = totalTurns - turnIndex + 5
        setVisibleTurnCount(newVisibleCount)
        return
      }

      // Scroll the turn into view
      const turnEl = turnRefs.current.get(turnId)
      if (turnEl) {
        const rect = turnEl.getBoundingClientRect()
        const buffer = 128
        const isVisible = rect.top >= buffer && rect.bottom <= window.innerHeight - buffer
        if (!isVisible) {
          turnEl.scrollIntoView({ behavior: 'instant', block: 'center' })
        }
      }
      shouldScrollToMatchRef.current = false
    }
  }, [validMatches, currentMatchIndex, session?.id, visibleTurnCount])

  // ---------------------------------------------------------------------------
  // CSS Custom Highlight API — non-destructive text highlighting
  // Creates browser-native highlight ranges over matching text without
  // modifying the DOM tree. Safe with React re-renders and streaming.
  // Uses cross-node matching: concatenates text across node boundaries
  // to find matches that span multiple DOM nodes (e.g. Shiki-split tokens).
  // ---------------------------------------------------------------------------

  const MAX_HIGHLIGHT_RANGES = 5000
  // Store computed ranges so the active-match effect can restyle without re-walking the DOM
  const highlightRangesRef = React.useRef<Range[]>([])

  // Effect 1: Walk DOM and collect highlight ranges when search/session/pagination changes
  useEffect(() => {
    const cssHighlights = getCSSHighlights()
    highlightRangesRef.current = []

    // Clear previous highlights
    try {
      cssHighlights?.delete('search-passive')
      cssHighlights?.delete('search-active')
    } catch { /* API unavailable — no-op */ }

    if (!searchQuery.trim() || !isSearchActive || !cssHighlights) return

    const query = searchQuery.toLowerCase()
    const matchingTurnIdSet = new Set(matchingTurnIds)
    if (matchingTurnIdSet.size === 0) return

    const rafId = requestAnimationFrame(() => {
      const allRanges: Range[] = []

      turnRefs.current.forEach((container, turnKey) => {
        if (allRanges.length >= MAX_HIGHLIGHT_RANGES) return
        if (!matchingTurnIdSet.has(turnKey)) return

        // For assistant turns, narrow search to response content root
        const searchRoot = container.querySelector('[data-search-root="response"]') || container

        // Collect ALL eligible text nodes (no query filter — needed for cross-node matching)
        const walker = document.createTreeWalker(
          searchRoot,
          NodeFilter.SHOW_TEXT,
          {
            acceptNode: (node) => {
              const parent = node.parentElement
              if (!parent) return NodeFilter.FILTER_REJECT
              const tag = parent.tagName.toLowerCase()
              if (tag === 'script' || tag === 'style') return NodeFilter.FILTER_REJECT
              if (parent.closest('[data-search-exclude="true"]')) return NodeFilter.FILTER_REJECT
              return NodeFilter.FILTER_ACCEPT
            },
          }
        )

        // Build concatenated string with node offset mapping for cross-node matching
        const textNodes: Text[] = []
        let currentNode: Node | null
        while ((currentNode = walker.nextNode())) {
          textNodes.push(currentNode as Text)
        }
        if (textNodes.length === 0) return

        const nodeOffsets: { node: Text; start: number; end: number }[] = []
        let totalLength = 0
        for (const node of textNodes) {
          const text = node.textContent || ''
          nodeOffsets.push({ node, start: totalLength, end: totalLength + text.length })
          totalLength += text.length
        }
        const concatenated = textNodes.map(n => n.textContent || '').join('')
        const lowerConcatenated = concatenated.toLowerCase()

        // Find all matches in the concatenated string
        let searchPos = 0
        while (searchPos < lowerConcatenated.length && allRanges.length < MAX_HIGHLIGHT_RANGES) {
          const idx = lowerConcatenated.indexOf(query, searchPos)
          if (idx === -1) break
          const matchEnd = idx + query.length

          // Create a Range spanning the match (may cross node boundaries)
          try {
            const range = new Range()
            let startSet = false

            for (const offset of nodeOffsets) {
              if (offset.end <= idx) continue
              if (offset.start >= matchEnd) break

              if (!startSet) {
                range.setStart(offset.node, idx - offset.start)
                startSet = true
              }
              range.setEnd(offset.node, Math.min(offset.end - offset.start, matchEnd - offset.start))
            }

            if (startSet) {
              allRanges.push(range)
            }
          } catch {
            // Range creation can fail if node was removed during walk
          }

          searchPos = matchEnd
        }
      })

      // Store ranges for the active-match effect to use
      highlightRangesRef.current = allRanges

      if (allRanges.length === 0 && matchingTurnIdSet.size > 0) {
        console.warn('[search-highlight] 0 ranges from', matchingTurnIdSet.size, 'matching turns — possible turn ID mismatch')
      }

      if (allRanges.length === 0) return

      try {
        // Apply all ranges as passive initially — the active-match effect will restyle
        cssHighlights.set('search-passive', new Highlight(...allRanges))
      } catch {
        // Highlight API call failed — degrade gracefully
      }
    })

    return () => cancelAnimationFrame(rafId)
  }, [searchQuery, isSearchActive, matchingTurnIds, session?.id, visibleTurnCount])

  // Effect 2: Update active/passive highlight split when navigation index changes
  // Lightweight — just reshuffles existing Range objects between two Highlight instances
  useEffect(() => {
    const cssHighlights = getCSSHighlights()
    const allRanges = highlightRangesRef.current
    if (!cssHighlights || allRanges.length === 0) return

    try {
      const activeRange = allRanges[currentMatchIndex]
      if (activeRange) {
        const passiveRanges = allRanges.filter((_, i) => i !== currentMatchIndex)
        cssHighlights.set('search-passive', new Highlight(...passiveRanges))
        cssHighlights.set('search-active', new Highlight(activeRange))
      } else {
        cssHighlights.set('search-passive', new Highlight(...allRanges))
        cssHighlights.delete('search-active')
      }
    } catch { /* graceful degradation */ }
  }, [currentMatchIndex])

  // Navigate to next match (no looping - stops at last match)
  const goToNextMatch = useCallback(() => {
    if (validMatches.length === 0) return
    setCurrentMatchIndex(prev => {
      // Don't loop - stop at last match
      if (prev >= validMatches.length - 1) return prev
      shouldScrollToMatchRef.current = true
      return prev + 1
    })
  }, [validMatches])

  // Navigate to previous match (no looping - stops at first match)
  const goToPrevMatch = useCallback(() => {
    if (validMatches.length === 0) return
    setCurrentMatchIndex(prev => {
      // Don't loop - stop at first match
      if (prev <= 0) return prev
      shouldScrollToMatchRef.current = true
      return prev - 1
    })
  }, [validMatches])

  // With CSS Highlight API, highlighting is instant — no settling phase
  const isHighlighting = false

  // Expose navigation via imperative handle (for session list navigation controls)
  React.useImperativeHandle(ref, () => ({
    goToNextMatch,
    goToPrevMatch,
    matchCount: validMatches.length,
    currentMatchIndex,
    isHighlighting,
  }), [goToNextMatch, goToPrevMatch, validMatches.length, currentMatchIndex])

  // Notify parent when match info (count, index, highlighting state) changes
  useEffect(() => {
    onMatchInfoChange?.({
      count: validMatches.length,
      index: currentMatchIndex,
      isHighlighting,
      sessionId: session?.id ?? null,
    })
  }, [validMatches.length, currentMatchIndex, isHighlighting, session?.id, onMatchInfoChange])

  // Ref to track total turn count for scroll handler
  const totalTurnCountRef = React.useRef(0)
  // Older pages from the server (scrolling up past the loaded turns)
  const loadOlderMessages = useSetAtom(loadOlderSessionMessagesAtom)
  const visibleTurnCountRef = React.useRef(visibleTurnCount)
  visibleTurnCountRef.current = visibleTurnCount
  const olderPageRef = React.useRef<{ sessionId?: string; olderCount: number }>({ olderCount: 0 })
  olderPageRef.current = { sessionId: session?.id, olderCount: session?.olderMessageCount ?? 0 }

  // Latest message metadata (for commit-time auto-scroll)
  const messageCount = session?.messages.length ?? 0
  const lastMessage = messageCount > 0 ? session?.messages[messageCount - 1] : undefined
  const lastMessageId = lastMessage?.id
  const lastMessageRole = lastMessage?.role

  const pendingFollowUpAnnotations = useMemo<PendingFollowUpAnnotation[]>(() => {
    if (!session?.messages?.length) return []

    const pending: PendingFollowUpAnnotation[] = []

    for (const message of session.messages) {
      if (message.role !== 'assistant' && message.role !== 'plan') continue
      if (!message.annotations?.length) continue

      for (const annotation of message.annotations) {
        const note = getAnnotationNoteText(annotation)
        if (!note) continue
        if (isAnnotationFollowUpSent(annotation)) continue

        pending.push({
          messageId: message.id,
          annotationId: annotation.id,
          note,
          selectedText: extractAnnotationSelectedText(annotation, message.content),
          createdAt: annotation.updatedAt ?? annotation.createdAt,
          color: annotation.style?.color,
          meta: asRecord(annotation.meta) ?? undefined,
        })
      }
    }

    return pending.sort((a, b) => a.createdAt - b.createdAt)
  }, [session?.messages])

  const followUpInputItems = useMemo(() => {
    return pendingFollowUpAnnotations.map((followUp, idx) => ({
      id: `${followUp.messageId}:${followUp.annotationId}`,
      messageId: followUp.messageId,
      annotationId: followUp.annotationId,
      index: idx + 1,
      noteLabel: normalizeFollowUpText(followUp.note),
      selectedText: truncateForChipTooltip(followUp.selectedText, 260),
      color: followUp.color,
    }))
  }, [pendingFollowUpAnnotations])

  // Track scroll position to toggle sticky-bottom behavior
  // - User scrolls up → unstick (stop auto-scrolling)
  // - User scrolls back to bottom → re-stick (resume auto-scrolling)
  // Also handles loading more turns when scrolling near top
  const handleScroll = React.useCallback(() => {
    const viewport = scrollViewportRef.current
    if (!viewport) return
    const { scrollTop, scrollHeight, clientHeight } = viewport
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight
    // 20px threshold for "at bottom" detection
    isStickToBottomRef.current = distanceFromBottom < 20

    // Load more turns when scrolling near top (within 100px)
    if (scrollTop < 100) {
      // Every loaded turn is shown: ask the server for the page before them, then show it in place
      const { sessionId, olderCount } = olderPageRef.current
      if (totalTurnCountRef.current <= visibleTurnCountRef.current && olderCount > 0 && sessionId) {
        void loadOlderMessages(sessionId).then((added) => {
          if (!added || olderPageRef.current.sessionId !== sessionId) return
          const prevScrollHeight = viewport.scrollHeight
          const prevScrollTop = viewport.scrollTop
          setVisibleTurnCount(prev => prev + TURNS_PER_PAGE)
          requestAnimationFrame(() => {
            viewport.scrollTop = viewport.scrollHeight - prevScrollHeight + prevScrollTop
          })
        })
        return
      }
      setVisibleTurnCount(prev => {
        // Check if there are more turns to load
        const currentStartIndex = Math.max(0, totalTurnCountRef.current - prev)
        if (currentStartIndex <= 0) return prev // Already showing all

        // Remember scroll height before adding more items
        const prevScrollHeight = viewport.scrollHeight

        // Schedule scroll position adjustment after render
        requestAnimationFrame(() => {
          const newScrollHeight = viewport.scrollHeight
          viewport.scrollTop = newScrollHeight - prevScrollHeight + scrollTop
        })

        return prev + TURNS_PER_PAGE
      })
    }
  }, [loadOlderMessages])

  // Set up scroll event listener
  React.useEffect(() => {
    const viewport = scrollViewportRef.current
    if (!viewport) return
    viewport.addEventListener('scroll', handleScroll)
    return () => viewport.removeEventListener('scroll', handleScroll)
  }, [handleScroll])

  // Auto-scroll using ResizeObserver for streaming content
  // Initial scroll is handled by ScrollOnMount (useLayoutEffect, before paint)
  React.useEffect(() => {
    const viewport = scrollViewportRef.current
    if (!viewport) return

    const isSessionSwitch = prevSessionIdRef.current !== session?.id
    prevSessionIdRef.current = session?.id ?? null

    // On session switch: reset UI state (scroll handled by ScrollOnMount)
    if (isSessionSwitch) {
      isStickToBottomRef.current = true
      setVisibleTurnCount(TURNS_PER_PAGE)
    }

    // Debounced scroll for streaming - waits for layout to settle
    let debounceTimer: ReturnType<typeof setTimeout> | null = null

    const resizeObserver = new ResizeObserver(() => {
      // Focused panel: respect sticky-bottom preference
      if (!isStickToBottomRef.current) return

      // Clear pending scroll and wait for layout to settle
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        if (!isStickToBottomRef.current) return
        // Right after an instant scroll (session switch/lazy load) stay on the end without animating: late
        // layout (the composer's lift) still grows the content then
        if (Date.now() < skipSmoothScrollUntilRef.current) {
          viewport.scrollTop = viewport.scrollHeight
          return
        }
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
      }, 200)
    })

    // Observe the scroll content container (first child of viewport)
    const content = viewport.firstElementChild
    if (content) {
      resizeObserver.observe(content)
    }

    return () => {
      resizeObserver.disconnect()
      if (debounceTimer) clearTimeout(debounceTimer)
    }
  }, [session?.id])

  // Commit-time auto-scroll for new user messages.
  // This complements submit-time scrolling and covers cases where attachments delay
  // optimistic message insertion (e.g., thumbnail generation/resizing).
  React.useEffect(() => {
    const currentSessionId = session?.id ?? null

    // Reset baseline on session switch; defer to ScrollOnMount/session-switch logic.
    if (prevSessionIdForCommitScrollRef.current !== currentSessionId) {
      prevSessionIdForCommitScrollRef.current = currentSessionId
      prevLastMessageIdRef.current = lastMessageId ?? null
      prevMessageCountRef.current = messageCount
      return
    }

    const previousCount = prevMessageCountRef.current
    const previousLastId = prevLastMessageIdRef.current
    const messageActuallyChanged = !!lastMessageId && lastMessageId !== previousLastId
    const countIncreased = messageCount > previousCount

    // Update baselines before early returns to keep refs consistent.
    prevLastMessageIdRef.current = lastMessageId ?? null
    prevMessageCountRef.current = messageCount

    if (!messageActuallyChanged || !countIncreased) return
    if (lastMessageRole !== 'user') return

    // Sending a message should always re-stick to bottom.
    isStickToBottomRef.current = true

    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    })
  }, [session?.id, messageCount, lastMessageId, lastMessageRole])

  // Handle message submission from the composer
  // Backend handles interruption and queueing if currently processing
  const handleSubmit = async (message: string, attachments?: FileAttachment[], skillSlugs?: string[], options?: SendMessageOptions) => {
    const hasBaseMessage = message.trim().length > 0
    const followUpSection = formatFollowUpSection(pendingFollowUpAnnotations, {
      includeTopSeparator: hasBaseMessage,
    })
    const messageWithFollowUps = followUpSection.length > 0
      ? (hasBaseMessage ? `${message}\n\n${followUpSection}` : followUpSection)
      : message
    const normalizedMessage = normalizeFollowUpsMarkdown(messageWithFollowUps)

    // Force stick-to-bottom when user sends a message
    isStickToBottomRef.current = true
    const accepted = await onSendMessage(normalizedMessage, attachments, skillSlugs, options)
    if (accepted === false) return false

    // Persist sent marker on follow-up annotations so TurnCard can distinguish
    // sent vs pending follow-ups. If user edits a follow-up later, TurnCard
    // clears these markers and the annotation becomes pending again.
    if (session && pendingFollowUpAnnotations.length > 0) {
      const sentAt = Date.now()
      void Promise.all(pendingFollowUpAnnotations.map((followUp) => {
        const currentMeta = followUp.meta ?? {}
        const currentFollowUpMeta = asRecord(currentMeta.followUp) ?? {}

        return window.electronAPI.sessionCommand(session.id, {
          type: 'updateAnnotation',
          messageId: followUp.messageId,
          annotationId: followUp.annotationId,
          patch: {
            meta: {
              ...currentMeta,
              followUp: {
                ...currentFollowUpMeta,
                text: followUp.note,
                lastSentAt: sentAt,
                lastSentText: followUp.note,
              },
            },
          },
        })
      })).catch((error) => {
        console.error('[ChatDisplay] Failed to mark follow-up annotations as sent:', error)
      })
    }

    // Immediately scroll to bottom after sending - use requestAnimationFrame
    // to ensure the DOM has updated with the new message
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    })
    return true
  }

  const handleSaveAndSendFollowUp = useCallback((_target: {
    messageId: string
    annotationId: string
    note: string
    selectedText: string
  }) => {
    if (!session) return

    if (isInputDisabled || disableSend || connectionUnavailable) {
      toast.error(t('toast.cannotSendRightNow'), {
        description: 'Sending is currently disabled for this session.',
      })
      return
    }

    // Mimic pressing Send in the input after Save completes.
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('otto:submit-input', {
        detail: { sessionId: session.id },
      }))
    }, 0)
  }, [session, isInputDisabled, disableSend, connectionUnavailable])

  // Handle stop request from the composer
  // silent=true when redirecting (sending new message), silent=false when user clicks Stop button
  const handleStop = (silent = false) => {
    if (!session?.isProcessing) return

    // Explicit Stop (not a redirect/new-message send): put the in-flight prompt
    // back in the input so the user can tweak and resend. Append to any draft.
    // Exclude isQueued messages — those are restored separately by the backend
    // `restore_input` effect (app.tsx) and would otherwise double up here.
    if (!silent) {
      const lastUserMsg = [...session.messages].reverse().find(m => m.role === 'user' && !m.isQueued)
      const restoredText = coerceInputText(lastUserMsg?.content)
      if (restoredText) {
        window.dispatchEvent(new CustomEvent('otto:restore-input', { detail: { sessionId: session.id, text: restoredText } }))
      }
    }

    window.electronAPI.cancelProcessing(session.id, silent).catch(error => {
      console.error('[ChatDisplay] Failed to cancel processing:', error)
    })
  }

  // Handle structured input responses (permissions and credentials)
  const handleStructuredResponse = (response: StructuredResponse) => {
    if ((response.type === 'permission' || response.type === 'admin_approval') && pendingPermission && onRespondToPermission) {
      if (response.type === 'permission') {
        const permResponse = response as PermissionResponse
        onRespondToPermission(
          pendingPermission.sessionId,
          pendingPermission.requestId,
          permResponse.allowed,
          permResponse.alwaysAllow
        )
        return
      }

      const adminResponse = response as AdminApprovalResponse
      onRespondToPermission(
        pendingPermission.sessionId,
        pendingPermission.requestId,
        adminResponse.approved,
        false,
        { rememberForMinutes: adminResponse.rememberForMinutes }
      )
    } else if (response.type === 'credential' && pendingCredential && onRespondToCredential) {
      const credResponse = response as CredentialResponse
      onRespondToCredential(
        pendingCredential.sessionId,
        pendingCredential.requestId,
        credResponse
      )
    }
  }

  const [durableRequestsReady, setDurableRequestsReady] = React.useState(false)
  React.useEffect(() => {
    if (typeof window.electronAPI.getNativeFeatures !== 'function') return
    let disposed = false
    void window.electronAPI.getNativeFeatures().then(features => {
      if (!disposed) setDurableRequestsReady(features.durableRequests)
    }).catch(() => {})
    return () => { disposed = true }
  }, [])
  const hasLiveNativeAction = session?.messages.some(message => message.nativeAction?.status === 'pending' || message.nativeAction?.status === 'resolving') ?? false
  const hasInlinePermission = durableRequestsReady && !!pendingPermission && !!onRespondToPermission && !!session?.isProcessing && session.messages.some(message => message.toolUseId === pendingPermission.requestId && message.nativeAction?.kind === 'approval' && (!session.currentRunId || message.nativeAction.runId === session.currentRunId) && (message.nativeAction.status === 'pending' || message.nativeAction.status === 'resolving'))

  // Build structured input state from pending requests (permissions take priority)
  const structuredInput: StructuredInputState | undefined = React.useMemo(() => {
    if (pendingPermission && !hasInlinePermission) {
      if (pendingPermission.type === 'admin_approval') {
        return {
          type: 'admin_approval',
          data: {
            appName: pendingPermission.appName || pendingPermission.toolName || 'System action',
            reason: pendingPermission.reason || pendingPermission.description,
            impact: pendingPermission.impact,
            command: pendingPermission.command || '',
            requiresSystemPrompt: pendingPermission.requiresSystemPrompt ?? true,
            rememberForMinutes: pendingPermission.rememberForMinutes ?? 10,
          },
        }
      }
      return { type: 'permission', data: pendingPermission }
    }
    if (pendingCredential) {
      return { type: 'credential', data: pendingCredential }
    }
    return undefined
  }, [pendingPermission, pendingCredential, hasInlinePermission])

  // Memoize turn grouping - avoids O(n) iteration on every render/keystroke
  const allTurns = React.useMemo(() => {
    if (!session) return []
    return groupMessagesByTurn(session.messages, { isSessionProcessing: session.isProcessing })
  }, [session?.messages, session?.isProcessing])

  // Keep ref in sync for scroll handler
  totalTurnCountRef.current = allTurns.length

  // Reverse pagination: only render last N turns for fast initial render
  const startIndex = Math.max(0, allTurns.length - visibleTurnCount)
  const turns = allTurns.slice(startIndex)
  // Turns loaded but not shown yet, else messages still on the server
  const hiddenAbove = startIndex > 0 ? startIndex : (session?.olderMessageCount ?? 0)
  const hasMoreAbove = hiddenAbove > 0

  // The Slack-like layout (chat-transcript.ts): authors, group headers, day dividers, the unread divider.
  const { me, personOf } = useTranscriptPeople()
  const creator = session?.members?.find(member => member.startsWith('user:')) ?? me
  const chatAgent = session?.agentId ? `agent:${session.agentId}` : null
  const actorOfTurn = useCallback(
    (turn: Turn) => turnActor(turn, { user: creator, agent: chatAgent ?? 'agent:default' }),
    [creator, chatAgent]
  )
  // The viewer's read marker as the chat opened: opening it marks it read, and the divider stays where it was.
  const [readMarker, setReadMarker] = useState<{ sessionId?: string; lastReadMessageId?: string }>({})
  if (session && readMarker.sessionId !== session.id) {
    setReadMarker({ sessionId: session.id, lastReadMessageId: session.hasUnread ? session.lastReadMessageId : undefined })
  }
  const unreadTurnIndex = useMemo(
    () => firstUnreadTurn(allTurns, readMarker.lastReadMessageId, turn => !!me && actorOfTurn(turn) === me),
    [allTurns, readMarker.lastReadMessageId, me, actorOfTurn]
  )
  const transcript = useMemo(
    () => layoutTranscript(turns, { actorOf: actorOfTurn, unreadIndex: unreadTurnIndex - startIndex }),
    // `turns` is a new slice every render: its inputs are the keys
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allTurns, startIndex, actorOfTurn, unreadTurnIndex]
  )
  const hasRunningTurn = turns.some(turn => turn.type === 'assistant' && !turn.isComplete)
  const pendingAgent = chatAgent
  const lastUserMessageAt = session?.messages.findLast(m => m.role === 'user')?.timestamp
  // Only the rows near the viewport render (a long chat's DOM stays flat); in-chat search needs every row.
  const transcriptWindowing = useTranscriptWindowing(scrollViewportRef, !isSearchActive && !compactMode, session?.id)

  const assistantTurnIndexByMessageId = useMemo(() => {
    const map = new Map<string, number>()
    allTurns.forEach((turn, index) => {
      if (turn.type !== 'assistant') return
      const messageId = turn.response?.messageId
      if (messageId) map.set(messageId, index)
    })
    return map
  }, [allTurns])

  const scrollToFollowUpTurn = useCallback((item: {
    messageId: string
    annotationId: string
  }) => {
    const targetTurnIndex = assistantTurnIndexByMessageId.get(item.messageId)
    if (targetTurnIndex == null) return

    const ensureVisibleCount = allTurns.length - targetTurnIndex

    const scrollToTurn = () => {
      const targetTurn = allTurns[targetTurnIndex]
      if (!targetTurn) return false

      const turnKey = getTurnKey(targetTurn)
      const turnContainer = turnRefs.current.get(turnKey)
      if (!turnContainer) return false

      turnContainer.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return true
    }

    if (ensureVisibleCount > visibleTurnCount) {
      setVisibleTurnCount(ensureVisibleCount)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!scrollToTurn()) {
            setTimeout(() => {
              void scrollToTurn()
            }, 80)
          }
        })
      })
      return
    }

    if (!scrollToTurn()) {
      requestAnimationFrame(() => {
        void scrollToTurn()
      })
    }
  }, [assistantTurnIndexByMessageId, allTurns, visibleTurnCount])

  const handleFollowUpChipClick = useCallback((item: {
    messageId: string
    annotationId: string
  }, anchor?: { x: number; y: number }) => {
    const targetTurnIndex = assistantTurnIndexByMessageId.get(item.messageId)
    if (targetTurnIndex != null) {
      const ensureVisibleCount = allTurns.length - targetTurnIndex
      if (ensureVisibleCount > visibleTurnCount) {
        setVisibleTurnCount(ensureVisibleCount)
      }
    }

    followUpOpenNonceRef.current += 1
    setOpenAnnotationRequest({
      messageId: item.messageId,
      annotationId: item.annotationId,
      mode: 'view',
      anchorX: anchor?.x,
      anchorY: anchor?.y,
      nonce: followUpOpenNonceRef.current,
    })
  }, [assistantTurnIndexByMessageId, allTurns, visibleTurnCount])

  const handleFollowUpIndexClick = useCallback((item: {
    messageId: string
    annotationId: string
  }) => {
    scrollToFollowUpTurn(item)
  }, [scrollToFollowUpTurn])

  // The chat's input: the shell composer, full (the chat page).
  const chatComposer = useChatComposer({
    enabled: shellComposer,
    placeholder: shellComposer ? undefined : (Array.isArray(placeholder) ? placeholder[0] : placeholder),
    session,
    onSubmit: handleSubmit,
    onStop: handleStop,
    disabled: isInputDisabled || disableSend || connectionUnavailable,
    sources,
    enabledSourceSlugs: session?.enabledSourceSlugs,
    onSourcesChange,
    model: { currentModel, onModelChange, thinkingLevel, onThinkingLevelChange, onConnectionChange, connectionUnavailable },
    permissionMode,
    onPermissionModeChange,
    onSessionStatusChange,
    workingDirectory,
    onWorkingDirectoryChange,
    structuredInput,
    onStructuredResponse: handleStructuredResponse,
    followUps: followUpInputItems,
    onFollowUpClick: handleFollowUpChipClick,
    onFollowUpIndexClick: handleFollowUpIndexClick,
  })
  usePlanApproval({
    sessionId: session?.id,
    isProcessing: !!session?.isProcessing,
    permissionMode,
    previousPermissionMode,
    onPermissionModeChange,
    submit: (message) => handleSubmit(message),
    takeDraft: shellComposer ? composer.take : () => '',
  })

  // The full composer grows and shrinks under the transcript: a chat stuck to its end stays there.
  useEffect(() => {
    const viewport = scrollViewportRef.current
    if (!viewport) return
    let height = viewport.clientHeight
    const observer = new ResizeObserver(() => {
      if (viewport.clientHeight !== height && isStickToBottomRef.current) viewport.scrollTop = viewport.scrollHeight
      height = viewport.clientHeight
    })
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [session?.id])

  // Compute if we should skip scroll-to-bottom (when search is active on session switch)
  // At render time, prevSessionIdForScrollRef still has the OLD session ID, so we can detect the switch
  const isSessionSwitchForScroll = prevSessionIdForScrollRef.current !== null && prevSessionIdForScrollRef.current !== session?.id
  const skipScrollToBottom = isSessionSwitchForScroll && isSearchActive
  const hasUnrenderedLoadedMessages = !messagesLoading
    && turns.length === 0
    && ((session?.messages?.length ?? 0) > 0 || (session?.messageCount ?? 0) > 0)

  return (
    <div ref={zoneRef} className="flex h-full flex-col min-w-0" data-focus-zone="chat">
      {session ? (
        <div className="flex flex-1 flex-col min-h-0 min-w-0 relative">
          {/* Content layer; on the chat page the shell composer floats over the transcript's bottom (`--composer-lift`). */}
          <div className="flex flex-1 flex-col gap-2 min-h-0 min-w-0 relative z-10">
          {/* === MESSAGES AREA: the transcript scrolls on the frame, no card or wrapper (DESIGN.md, Chat page) === */}
          <div className="relative flex min-h-0 flex-1 flex-col">
            {/* Mask wrapper - fades content at top and bottom over transparent/image backgrounds */}
            <div
              className="h-full"
              style={{
                maskImage: shellComposer ? undefined : 'linear-gradient(to bottom, transparent 0%, black 32px, black calc(100% - 32px), transparent 100%)',
                WebkitMaskImage: shellComposer ? undefined : 'linear-gradient(to bottom, transparent 0%, black 32px, black calc(100% - 32px), transparent 100%)'
              }}
            >
              <ScrollArea className="h-full min-w-0" viewportRef={scrollViewportRef} viewportClassName={shellComposer ? "[mask-image:linear-gradient(to_bottom,transparent,black_1rem,black_calc(100%_-_32px),transparent)]" : undefined}>
              <div data-slot={shellComposer ? "chat-transcript" : undefined} className={cn(
                "min-w-0",
                compactMode ? "px-3 py-4" : [CHAT_LAYOUT.containerPaddingX, CHAT_LAYOUT.containerPaddingY],
                // On the chat page the transcript is on the column's content edges (24px sides from 768px, the
                // compact title's and the composer's left and right); its top is the 16px the first row (the day
                // divider, `pt-4`) carries itself, as tall as the top fade, so it starts 16px under the header (`--nav-top-compact`);
                // the composer floats over its bottom, so it ends `--composer-gap` above it.
                shellComposer && "pt-0 pb-(--composer-clearance)"
              )}>
                {/* Session-level AnimatePresence: Prevents layout jump when switching sessions */}
                <AnimatePresence mode={compactMode ? "sync" : "wait"} initial={false}>
                  <motion.div
                    key={compactMode ? 'compact-session' : session?.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={compactMode ? { duration: 0 } : { duration: 0.1, ease: 'easeOut' }}
                  >
                    {/* Loading/Content AnimatePresence: sync mode avoids stale loading exits masking ready content */}
                    <AnimatePresence mode="sync" initial={false}>
                    {messagesLoading ? (
                      /* Loading State: Show spinner while messages are being lazy loaded */
                      <motion.div
                        key="loading"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={compactMode ? { duration: 0 } : { duration: 0.1 }}
                        className="flex items-center justify-center h-64"
                      >
                        <Spinner className="text-foreground/30" />
                      </motion.div>
                    ) : messagesLoadError ? (
                      <motion.div
                        key="load-error"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={compactMode ? { duration: 0 } : { duration: 0.1 }}
                        className="flex items-center justify-center h-64 px-4"
                      >
                        <div className="max-w-sm rounded-md bg-destructive/10 px-4 py-3 text-center">
                          <AlertTriangle className="mx-auto mb-2 size-3.5 text-destructive/70" />
                          <div className="text-sm font-medium text-destructive">{t("chat.failedToLoadConversation")}</div>
                          <p className="mt-1 break-words text-xs text-destructive/70">{messagesLoadError}</p>
                          {onRetryMessagesLoad && (
                            <Button variant="outline" size="xs" onClick={onRetryMessagesLoad} loading={messagesRetrying} className="mt-3">
                              {t("common.retry")}
                            </Button>
                          )}
                        </div>
                      </motion.div>
                    ) : (
                    /* Turn-based Message Display - memoized to avoid re-grouping on every render */
                    /* AnimatePresence handles the fade-in animation when transitioning from loading */
                    <motion.div
                      key={compactMode ? 'loaded-compact' : `loaded-${session?.id}`}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={compactMode ? { duration: 0 } : { duration: 0.1, ease: 'easeOut' }}
                    >
                  {/* Scroll to bottom before paint - fires via useLayoutEffect */}
                  {/* Skip when search is active on session switch - scroll to first match instead */}
                  <ScrollOnMount
                    targetRef={messagesEndRef}
                    skip={skipScrollToBottom}
                    onScroll={() => {
                      skipSmoothScrollUntilRef.current = Date.now() + 500
                    }}
                  />
                  {!compactMode && hasUnrenderedLoadedMessages && (
                    <div className="flex h-64 items-center justify-center px-4 text-center">
                      <div className="max-w-sm rounded-md border border-border/50 bg-foreground/[0.03] px-4 py-3">
                        <CircleAlert className="mx-auto mb-2 size-3.5 text-foreground/50" />
                        <div className="text-sm font-medium text-foreground/70">Conversation loaded, but no renderable messages were found.</div>
                        <p className="mt-1 text-xs text-foreground/50">Try reloading the session. If this persists, the message history may contain an unsupported format.</p>
                      </div>
                    </div>
                  )}
                  {/* Load more indicator - shown when there are older messages */}
                  {hasMoreAbove && (
                    <div className="text-center text-muted-foreground/60 text-xs py-3 select-none">
                      ↑ {t('chat.scrollUpForEarlier', { count: hiddenAbove })}
                    </div>
                  )}
                  {transcript.map((entry) => {
                    if (entry.type === 'day') {
                      return (
                        <Marker key={entry.key} variant="separator" className="pt-4 select-none" data-search-exclude="true">
                          <MarkerContent>{dayLabel(entry.at, Date.now(), i18n.resolvedLanguage ?? 'en', { today: t('common.today'), yesterday: t('common.yesterday') })}</MarkerContent>
                        </Marker>
                      )
                    }
                    if (entry.type === 'unread') {
                      return (
                        <Marker key={entry.key} variant="unread" className="pt-4 select-none" data-search-exclude="true">
                          <MarkerContent>{t('chat.newMessages')}</MarkerContent>
                        </Marker>
                      )
                    }
                    const { turn, index, actor, header } = entry
                    // Compute turn key and check if it's a search match
                    const turnKey = getTurnKey(turn)
                    const isCurrentMatch = isSearchActive && matchingTurnIds[currentMatchIndex] === turnKey
                    const isAnyMatch = isSearchActive && matchingTurnIds.includes(turnKey)
                    // One row of the transcript: the author's group header or the gutter, windowed when far away
                    const row = (content: React.ReactNode) => (
                      <WindowedRow
                        key={turnKey}
                        windowing={turn.type === 'assistant' && !turn.isComplete ? null : transcriptWindowing}
                        rowRef={el => { if (el) turnRefs.current.set(turnKey, el); else turnRefs.current.delete(turnKey) }}
                        className={cn(
                          header ? "pt-4" : actor ? "pt-1" : "pt-2",
                          "rounded-lg transition-all duration-200",
                          isCurrentMatch && "ring-2 ring-info ring-offset-2 ring-offset-background",
                          isAnyMatch && !isCurrentMatch && "ring-1 ring-info/30"
                        )}
                      >
                        <MessageRow actor={actor} me={me} person={actor ? personOf(actor) : null} header={header} at={turn.timestamp}>
                          {content}
                        </MessageRow>
                      </WindowedRow>
                    )

                    // A person's message: their text and attachments, flat under their header
                    if (turn.type === 'user') {
                      return row(
                        <UserMessage
                          content={turn.message.content}
                          attachments={turn.message.attachments}
                          badges={turn.message.badges}
                          isQueued={turn.message.isQueued}
                          onUrlClick={onOpenUrl}
                          onFileClick={onOpenFile}
                          renderContent={renderUserText}
                        />
                      )
                    }

                    // System turns (error, status, info, warning) - render with MemoizedMessageBubble
                    if (turn.type === 'system') {
                      return row(
                        <MemoizedMessageBubble
                          message={turn.message}
                          onOpenUrl={onOpenUrl}
                          sessionId={session?.id}
                          onRetry={turn.message.role === 'error' ? () => {
                            const msgs = session?.messages
                            if (!msgs) return
                            const errorIdx = msgs.findIndex(m => m.id === turn.message.id)
                            const lastUserMsg = msgs.slice(0, errorIdx).findLast(m => m.role === 'user')
                            if (lastUserMsg) {
                              onSendMessage(lastUserMsg.content)
                            }
                          } : undefined}
                        />
                      )
                    }

                    // Auth-request turns - render inline auth UI
                    // mt-2 matches ResponseCard spacing for visual consistency
                    if (turn.type === 'auth-request') {
                      // Interactive only if no user message follows
                      const isAuthInteractive = !turns.slice(index + 1).some(t => t.type === 'user')
                      return row(
                        <MemoizedAuthRequestCard
                          message={turn.message}
                          sessionId={session.id}
                          onRespondToCredential={onRespondToCredential}
                          isInteractive={isAuthInteractive}
                        />
                      )
                    }

                    // Check if this is the last response (for Accept Plan button visibility)
                    const isLastResponse = index === turns.length - 1 || !turns.slice(index + 1).some(t => t.type === 'user')

                    // Assistant turns - render with TurnCard (buffered streaming)
                    const assistantUiKey = getAssistantTurnUiKey(turn, index)
                    const published = session.messages.flatMap((message) => {
                      if (message.nativeAction || message.role !== 'tool' || message.toolStatus !== 'completed' || !turn.activities.some((activity) => activity.toolUseId === message.toolUseId) || message.toolName !== 'publish_file' || !message.toolResult) return []
                      try {
                        const result = JSON.parse(message.toolResult) as { libraryId?: string }
                        return result.libraryId && /^[0-9a-f-]{36}$/.test(result.libraryId) ? [result.libraryId] : []
                      } catch { return [] }
                    })
                    return row(
                      <>
                      <TurnCard
                        nativeActionActor={me}
                        nativeActionRunId={session.currentRunId}
                        nativeActionsEnabled={durableRequestsReady && session.isProcessing}
                        onRespondToNativeApproval={onRespondToPermission ? async (toolUseId, allowed) => {
                          try {
                            const accepted = await onRespondToPermission(session.id, toolUseId, allowed, false)
                            if (accepted) return
                          } catch {}
                          throw new Error('Could not submit your response.')
                        } : undefined}
                        onRespondToNativeQuestion={typeof window.electronAPI.respondToNativeQuestion === 'function' ? async (toolUseId, answer) => {
                          try {
                            const accepted = await window.electronAPI.respondToNativeQuestion(session.id, toolUseId, answer)
                            if (accepted) return
                          } catch {}
                          throw new Error('Could not submit your response.')
                        } : undefined}
                        onOpenNativeArtifact={(artifact) => {
                          if (artifact.type === 'library') navigate(routes.view.library({ itemId: artifact.id }))
                          else if (artifact.type === 'project') navigate(routes.view.projects({ projectId: artifact.id }))
                          else if (artifact.type === 'task') navigate(routes.view.tasks({ taskId: artifact.id }))
                        }}
                        sessionId={session.id}
                        sessionFolderPath={session.sessionFolderPath}
                        hasActiveFollowUpAnnotations={pendingFollowUpAnnotations.length > 0}
                        turnId={turn.turnId}
                        activities={turn.activities}
                        response={turn.response}
                        intent={turn.intent}
                        isStreaming={turn.isStreaming}
                        isComplete={turn.isComplete}
                        isExpanded={expandedTurns.has(assistantUiKey)}
                        onExpandedChange={(expanded) => toggleTurn(assistantUiKey, expanded)}
                        expandedActivityGroups={expandedActivityGroups}
                        onExpandedActivityGroupsChange={setExpandedActivityGroups}
                        todos={turn.todos}
                        onOpenFile={onOpenFile}
                        onOpenUrl={onOpenUrl}
                        isLastResponse={isLastResponse}
                        compactMode={compactMode}
                        sendMessageKey={sendMessageKey}
                        openAnnotationRequest={openAnnotationRequest}
                        onAddAnnotation={async (messageId, annotation) => {
                          if (!session) return
                          try {
                            await window.electronAPI.sessionCommand(session.id, {
                              type: 'addAnnotation',
                              messageId,
                              annotation,
                            })
                          } catch (error) {
                            toast.error(t('toast.couldNotSaveHighlight'), {
                              description: error instanceof Error ? error.message : 'Unknown error',
                            })
                            throw error
                          }
                        }}
                        onRemoveAnnotation={async (messageId, annotationId) => {
                          if (!session) return
                          try {
                            await window.electronAPI.sessionCommand(session.id, {
                              type: 'removeAnnotation',
                              messageId,
                              annotationId,
                            })
                          } catch (error) {
                            toast.error(t('toast.couldNotRemoveHighlight'), {
                              description: error instanceof Error ? error.message : 'Unknown error',
                            })
                          }
                        }}
                        onUpdateAnnotation={async (messageId, annotationId, patch) => {
                          if (!session) return
                          try {
                            await window.electronAPI.sessionCommand(session.id, {
                              type: 'updateAnnotation',
                              messageId,
                              annotationId,
                              patch,
                            })
                          } catch (error) {
                            toast.error(t('toast.couldNotUpdateHighlight'), {
                              description: error instanceof Error ? error.message : 'Unknown error',
                            })
                            throw error
                          }
                        }}
                        onSaveAndSendFollowUp={handleSaveAndSendFollowUp}
                        onAcceptPlan={() => {
                          const planMessage = session?.messages.findLast(m => m.role === 'plan')
                          const planPath = planMessage?.planPath

                          window.dispatchEvent(new CustomEvent('otto:approve-plan', {
                            detail: {
                              sessionId: session?.id,
                              planPath,
                              includeDraftInput: true,
                              source: 'plan-card',
                            },
                          }))
                        }}
                        onAcceptPlanWithCompact={() => {
                          const planMessage = session?.messages.findLast(m => m.role === 'plan')
                          const planPath = planMessage?.planPath

                          window.dispatchEvent(new CustomEvent('otto:approve-plan-with-compact', {
                            detail: {
                              sessionId: session?.id,
                              planPath,
                              includeDraftInput: true,
                              source: 'plan-card',
                            },
                          }))
                        }}
                      />
                      {published.map((id) => <EntityText key={id} content={`library:${id}`} />)}
                      </>
                    )
                  })}
                    </motion.div>
                    )}
                    </AnimatePresence>
                  </motion.div>
                </AnimatePresence>
                {/* Processing before the agent's turn has a row: its header and live state (no header without an agent) */}
                {session.isProcessing && !hasRunningTurn && !hasLiveNativeAction && (
                  <div className="pt-4">
                    <MessageRow actor={pendingAgent} me={me} person={pendingAgent ? personOf(pendingAgent) : null} header={!!pendingAgent} at={lastUserMessageAt ?? Date.now()}>
                      <ProcessingIndicator
                        statusMessage={session.currentStatus?.message}
                      />
                    </MessageRow>
                  </div>
                )}
                {/* Scroll Anchor: For auto-scroll to bottom */}
                <div ref={messagesEndRef} />
              </div>
              </ScrollArea>
            </div>
          </div>

          {/* The chat page's input is the shell's composer (registered below); the edit popover draws its own instance. */}
          {!shellComposer && <FreeFormInput context={chatComposer} />}
          </div>
        </div>
      ) : null}

    </div>
  )
})

/**
 * MessageBubble - A system row of the transcript, in the text column under no header
 *
 * - error:   red tinted block with the error, its actions and collapsible details
 * - info:    icon and color by level (compaction complete draws a divider)
 * - warning: info tinted block
 *
 * Note: user messages are `UserMessage`, agent turns `TurnCard`
 */
interface MessageBubbleProps {
  message: Message
  onOpenUrl: (url: string) => void
  sessionId?: string
  /** Callback to resend the user message that preceded an error */
  onRetry?: () => void
}

/**
 * ErrorMessage - Separate component for error messages to allow useState hook
 */
function ErrorMessage({ message, onOpenUrl, sessionId, onRetry }: { message: Message; onOpenUrl?: (url: string) => void; sessionId?: string; onRetry?: () => void }) {
  const { t } = useTranslation()
  const hasDetails = (message.errorDetails && message.errorDetails.length > 0) || message.errorOriginal
  const [detailsOpen, setDetailsOpen] = React.useState(false)
  const actions = message.errorActions?.filter(a => {
    if (a.action === 'open_url') return !!a.url && !!onOpenUrl
    return true
  })

  return (
    <div className="flex justify-start pt-2">
      {/* Flat tinted fill, no ring or shadow */}
      <div className="max-w-[80%] bg-destructive/10 rounded-md pl-5 pr-4 pt-2 pb-2.5 break-words">
        <div className="text-xs text-destructive/50 mb-0.5 font-semibold">
          {message.errorTitle || t('common.error')}
        </div>
        <p className="text-sm text-destructive">{message.content}</p>

        {/* Action buttons */}
        {actions && actions.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {actions.map((action) => (
              <button
                key={action.key}
                onClick={() => {
                  handleErrorMessageAction(action, {
                    sessionId,
                    onOpenUrl,
                    onRetry,
                  })
                }}
                className="text-xs px-2 py-0.5 rounded border border-destructive/20 text-destructive/70 hover:text-destructive hover:border-destructive/40 transition-colors"
              >
                {action.label}{action.action === 'open_url' ? ' ↗' : ''}
              </button>
            ))}
          </div>
        )}

        {/* Collapsible Details Toggle */}
        {hasDetails && (
          <div className="mt-2">
            <button
              onClick={() => setDetailsOpen(!detailsOpen)}
              className="flex items-center gap-1 text-xs text-destructive/70 hover:text-destructive transition-colors"
            >
              {detailsOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              <span>{detailsOpen ? t('chat.hideTechnicalDetails') : t('chat.showTechnicalDetails')}</span>
            </button>

            <AnimatedCollapsibleContent isOpen={detailsOpen} className="overflow-hidden">
              <div className="mt-2 pt-2 border-t border-destructive/20 text-xs text-destructive/60 font-mono space-y-0.5">
                {message.errorDetails?.map((detail, i) => (
                  <div key={i}>{detail}</div>
                ))}
                {message.errorOriginal && !message.errorDetails?.some(d => d.includes('Raw error:')) && (
                  <div className="mt-1">Raw: {message.errorOriginal.slice(0, 200)}{message.errorOriginal.length > 200 ? '...' : ''}</div>
                )}
              </div>
            </AnimatedCollapsibleContent>
          </div>
        )}
      </div>
    </div>
  )
}

/** A user message's text with its typed references (`task:<id>`, a chat started from a page) as chips. */
const renderUserText = (content: string) => <EntityText content={content} className="[&_p]:whitespace-pre-wrap" />

function MessageBubble({
  message,
  onOpenUrl,
  sessionId,
  onRetry,
}: MessageBubbleProps) {
  // === ERROR MESSAGE: Red bordered bubble with warning icon and collapsible details ===
  if (message.role === 'error') {
    return <ErrorMessage message={message} onOpenUrl={onOpenUrl} sessionId={sessionId} onRetry={onRetry} />
  }

  // === INFO MESSAGE: Icon and color based on level ===
  if (message.role === 'info') {
    // Compaction complete message - render as horizontal rule with centered label
    // This persists after reload to show where context was compacted
    if (message.statusType === 'compaction_complete') {
      return (
        <div className="flex items-center gap-3 my-12 px-3">
          <div className="flex-1 h-px bg-border" />
          <span className="text-sm text-muted-foreground/70 select-none">
            Conversation Compacted
          </span>
          <div className="flex-1 h-px bg-border" />
        </div>
      )
    }

    const level = message.infoLevel || 'info'
    const config = {
      info: { icon: Info, className: 'text-muted-foreground' },
      warning: { icon: AlertTriangle, className: 'text-info' },
      error: { icon: CircleAlert, className: 'text-destructive' },
      success: { icon: CheckCircle2, className: 'text-success' },
    }[level]
    const Icon = config.icon

    return (
      <div className={cn('flex items-center gap-2 px-3 py-1 text-[13px] select-none', config.className)}>
        <div className="w-3 h-3 flex items-center justify-center shrink-0">
          <Icon className="w-3 h-3" />
        </div>
        <span>{message.content}</span>
      </div>
    )
  }

  // === WARNING MESSAGE: Info themed bubble ===
  if (message.role === 'warning') {
    return (
      <div className="flex justify-start">
        <div className="max-w-[80%] bg-info/10 rounded-md pl-5 pr-4 pt-2 pb-2.5 break-words select-none">
          <div className="text-xs text-info/50 mb-0.5 font-semibold">
            Warning
          </div>
          <p className="text-sm text-info">{message.content}</p>
        </div>
      </div>
    )
  }

  return null
}

/**
 * MemoizedMessageBubble - Prevents re-renders of unchanged system rows
 *
 * During streaming, the entire message list gets updated on each delta.
 * This wrapper skips re-renders for messages that haven't changed,
 * significantly improving performance for long conversations.
 */
const MemoizedMessageBubble = React.memo(MessageBubble, (prev, next) => {
  // Skip re-render if key props unchanged
  return (
    prev.message.id === next.message.id &&
    prev.message.content === next.message.content &&
    prev.message.role === next.message.role &&
    prev.sessionId === next.sessionId
  )
})
