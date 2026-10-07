/**
 * Tool Event Handlers
 *
 * Handles tool_start and tool_result events.
 * Pure functions that return new state - no side effects.
 */

import type { SessionState, ToolStartEvent, ToolResultEvent } from '../types'
import type { Message } from '../../../shared/types'
import { isParentTaskTool } from '@otto/shared/utils/tool-names'
import {
  findToolMessage,
  updateMessageAt,
  appendMessage,
  generateMessageId
} from '../helpers'

/**
 * Handle tool_start - create or update tool message
 *
 * SDK sends two events per tool: first from stream_event (empty input),
 * second from assistant message (complete input). We handle both.
 */
export function handleToolStart(
  state: SessionState,
  event: ToolStartEvent
): SessionState {
  const { session, streaming } = state

  // Check if tool message already exists (SDK sends two events)
  const existingIndex = findToolMessage(session.messages, event.toolUseId)

  if (existingIndex !== -1) {
    // Update with complete input (second event has full input)
    const updatedSession = updateMessageAt(session, existingIndex, {
      toolInput: event.toolInput,
      toolIntent: event.toolIntent,
      toolDisplayName: event.toolDisplayName,
      toolDisplayMeta: event.toolDisplayMeta,
      turnId: event.turnId,
      parentToolUseId: event.parentToolUseId,
    })
    return { session: updatedSession, streaming }
  }

  // Create new tool message
  const toolMessage: Message = {
    id: generateMessageId(),
    role: 'tool',
    content: '',
    timestamp: event.timestamp ?? Date.now(),
    toolUseId: event.toolUseId,
    toolName: event.toolName,
    toolInput: event.toolInput,
    toolStatus: 'executing',
    turnId: event.turnId,
    parentToolUseId: event.parentToolUseId,
    toolIntent: event.toolIntent,
    toolDisplayName: event.toolDisplayName,
    toolDisplayMeta: event.toolDisplayMeta,
  }

  return {
    session: appendMessage(session, toolMessage),
    streaming,
  }
}

/**
 * Handle tool_result - complete tool execution
 *
 * Updates the tool message with result. If tool not found (out-of-order),
 * creates the tool message with result included.
 */
export function handleToolResult(
  state: SessionState,
  event: ToolResultEvent
): SessionState {
  const { session, streaming } = state

  const toolIndex = findToolMessage(session.messages, event.toolUseId)

  const inferredError = event.isError === true || /^\s*(\[ERROR\]|Error:|error:)/.test(event.result || '')

  if (toolIndex !== -1) {
    // Detect "persisted output" - SDK marks as error but data was actually saved successfully
    const isPersistedOutput = inferredError && (
      event.result?.includes('Output has been saved to') ||
      event.result?.includes('Full output saved to')
    )

    const effectiveIsError = isPersistedOutput ? false : inferredError

    const newToolStatus = effectiveIsError ? 'error' : 'completed'

    // Update existing tool message
    let updatedSession = updateMessageAt(session, toolIndex, {
      toolResult: event.result,
      toolStatus: newToolStatus,
      isError: effectiveIsError,
      errorCode: isPersistedOutput ? 'response_too_large' : undefined,
    })

    // Safety net: when a parent Task completes, auto-complete any still-pending child tools.
    // This handles the case where child tool_result events never arrive.
    const completedTool = updatedSession.messages[toolIndex]
    if (completedTool && (isParentTaskTool(completedTool.toolName || '') || completedTool.toolName === 'TaskOutput')) {
      const hasOrphanedChildren = updatedSession.messages.some(
        m => m.parentToolUseId === event.toolUseId
          && m.toolStatus !== 'completed'
          && m.toolStatus !== 'error'
      )
      if (hasOrphanedChildren) {
        const updatedMessages = updatedSession.messages.map(m => {
          if (
            m.parentToolUseId === event.toolUseId
            && m.toolStatus !== 'completed'
            && m.toolStatus !== 'error'
          ) {
            return { ...m, toolStatus: 'completed' as const, toolResult: m.toolResult || '' }
          }
          return m
        })
        updatedSession = { ...updatedSession, messages: updatedMessages }
      }
    }

    return { session: updatedSession, streaming }
  }

  // No matching tool_start found — create message from result.
  // This is normal for background subagent child tools where tool_result arrives
  // without a prior tool_start. If tool_start arrives later, findToolMessage will
  // locate this message by toolUseId and update it with input/intent/displayMeta.

  // Detect "persisted output" - SDK marks as error but data was actually saved successfully
  const isPersistedOutput = inferredError && (
    event.result?.includes('Output has been saved to') ||
    event.result?.includes('Full output saved to')
  )

  const effectiveIsError = isPersistedOutput ? false : inferredError

  const toolMessage: Message = {
    id: generateMessageId(),
    role: 'tool',
    content: '',
    timestamp: event.timestamp ?? Date.now(),
    toolUseId: event.toolUseId,
    toolName: event.toolName,
    toolResult: event.result,
    toolStatus: effectiveIsError ? 'error' : 'completed',
    isError: effectiveIsError,
    errorCode: isPersistedOutput ? 'response_too_large' : undefined,
    turnId: event.turnId,
    parentToolUseId: event.parentToolUseId,
  }

  return {
    session: appendMessage(session, toolMessage),
    streaming,
  }
}
