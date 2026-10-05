/**
 * Chat component exports for @otto/ui
 */

// Turn utilities (pure functions, no React)
export * from './turn-utils'
export * from './follow-up-helpers'

// Components
export { TurnCard, ResponseCard, SIZE_CONFIG, ActivityStatusIcon, type TurnCardProps, type ResponseCardProps, type ActivityItem, type ActivityStatus, type ResponseContent, type TodoItem } from './turn-card'
export { InlineExecution, mapToolEventToActivity, type InlineExecutionProps, type InlineExecutionStatus, type InlineActivityItem } from './inline-execution'
export { TurnCardActionsMenu, type TurnCardActionsMenuProps } from './turn-card-actions-menu'
export { SessionViewer, type SessionViewerProps, type SessionViewerMode } from './session-viewer'
export { UserMessageBubble, type UserMessageBubbleProps } from './user-message-bubble'
export { SystemMessage, type SystemMessageProps, type SystemMessageType } from './system-message'

// Attachment helpers
export { FileTypeIcon, getFileTypeLabel, type FileTypeIconProps } from './attachment-helpers'

// Accept plan dropdown (for plan cards)
export { AcceptPlanDropdown } from './accept-plan-dropdown'
