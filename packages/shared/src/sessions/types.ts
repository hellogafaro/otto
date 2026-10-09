/**
 * Session Types
 *
 * Types for workspace-scoped sessions (chats). A chat is a `chats` row and its `messages` rows (./schema.ts); how
 * these fields map to columns is in ./chats.ts.
 */

import type { PermissionMode } from '../agent/mode-manager.ts';
import type { ThinkingLevel } from '../agent/thinking-levels.ts';
import type { StoredMessage, ContextUsageSnapshot } from '@otto/core/types';

/**
 * Session fields that persist and reach the clients (pickSessionFields()). A new field goes here, in SessionConfig
 * below, and in ./chats.ts: a column if SQL filters on it, else `ChatMetadata`.
 */
export const SESSION_PERSISTENT_FIELDS = [
  // Identity
  'id', 'workspaceRootPath', 'sdkSessionId', 'piSession',
  // Who the chat belongs to ('user:<id>'); absent on chats made before chats were private
  'createdBy',
  // The chat's primary agent (an `agents` row id); absent = a people chat (a DM or a group). Members are `chats_members`.
  'agentId',
  // A direct message's pair key ('user:<a>|user:<b>'), absent on every other chat
  'dmKey',
  // Timestamps
  'createdAt', 'lastUsedAt', 'lastMessageAt',
  // Display
  'name', 'isFlagged', 'sessionStatus', 'labels',
  // Read tracking (unread is per member: `chats_members.read_at`, computed per viewer)
  'lastReadMessageId',
  // Config
  'enabledSourceSlugs', 'permissionMode', 'previousPermissionMode', 'workingDirectory',
  // Model/Connection
  'model', 'llmConnection', 'llmConnectionId', 'connectionLocked', 'thinkingLevel',
  // Sharing
  'sharedUrl', 'sharedId',
  // Plan execution
  'pendingPlanExecution',
  // Archive (read from the status: archived is the `archived` status)
  'isArchived',
  // Branching
  'branchFromMessageId',
  'branchFromSdkSessionId',
  'branchFromSessionPath',
  'branchFromSdkTurnId',
  // Remote transfer handoff
  'transferredSessionSummary',
  'transferredSessionSummaryApplied',
  'contextSummary',
  'contextThroughId',
  // Automation origin
  'triggeredBy',
  // Project binding (workspace-scoped grouping)
  'projectId',
  'contextEntity',
  // Subtask hierarchy (sessions spawned by spawn_session)
  'parentSessionId',
] as const;

export type SessionPersistentField = typeof SESSION_PERSISTENT_FIELDS[number];

/**
 * Session status (user-controlled, never automatic)
 *
 * Dynamic status ID referencing workspace status config.
 * Validated at runtime via validateSessionStatus().
 * Falls back to 'todo' if status doesn't exist.
 */
export type SessionStatus = string;

/**
 * Built-in status IDs (for TypeScript consumers)
 * These are the default statuses but users can add/remove custom ones
 */
export type BuiltInStatusId = 'todo' | 'in-progress' | 'needs-review' | 'done' | 'cancelled';

/**
 * Session token usage tracking
 */
export interface SessionTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  contextTokens: number;
  costUsd: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  /** Model's context window size in tokens (from SDK modelUsage) */
  contextWindow?: number;
  /** Current occupancy, independent from billable/cumulative token counters. */
  contextUsage?: ContextUsageSnapshot;
}

/**
 * Stored message format (simplified for persistence)
 * Re-exported from @otto/core for convenience
 */
export type { StoredMessage } from '@otto/core/types';

/**
 * Session configuration (persisted metadata)
 */
export interface SessionConfig {
  id: string;
  /** SDK session ID (captured after first message) */
  sdkSessionId?: string;
  /** The Pi session file as last uploaded to object storage (sessions/pi-session-sync.ts); absent on disk storage. */
  piSession?: { hash: string; at: number };
  /** Workspace root path this session belongs to */
  workspaceRootPath: string;
  /** Optional user-defined name */
  name?: string;
  /** Actor ('user:<id>') the chat belongs to: only they see it. Set by the server at creation, never by a client. Absent: made before chats were private, visible to the workspace owners only. */
  createdBy?: string;
  /** A direct message's pair key ('user:<a>|user:<b>', sorted; unique per workspace); absent on every other chat. */
  dmKey?: string;
  /** The chat's primary agent (`agents` row id): it replies when one person talks to it; absent = a people chat (no agent replies unless mentioned). */
  agentId?: string;
  createdAt: number;
  lastUsedAt: number;
  /** Timestamp of last meaningful message (user or final assistant). Used for date grouping in session list.
   *  Separate from lastUsedAt which tracks any session access (auto-save, open to read, etc.). */
  lastMessageAt?: number;
  /** Whether this session is flagged */
  isFlagged?: boolean;
  /** Permission mode for this session ('safe', 'ask', 'guarded', 'allow-all') */
  permissionMode?: PermissionMode;
  /** Previous permission mode (used to preserve modeTransition context across restarts) */
  previousPermissionMode?: PermissionMode;
  /** User-controlled session status - determines inbox vs completed */
  sessionStatus?: SessionStatus;
  /** Labels applied to this session (bare IDs or "id::value" entries) */
  labels?: string[];
  /** ID of last message user has read */
  lastReadMessageId?: string;
  /** Unread for the viewer (computed from their `chats_members.read_at`; never stored on the chat). For an import: whether its creator has read it. */
  hasUnread?: boolean;
  /** Per-session source selection (source slugs) */
  enabledSourceSlugs?: string[];
  /** Working directory for this session (used by agent for bash commands and context) */
  workingDirectory?: string;
  /** Shared viewer URL (if shared via viewer) */
  sharedUrl?: string;
  /** Shared session ID in viewer (for revoke) */
  sharedId?: string;
  /** Model to use for this session (overrides global config if set) */
  model?: string;
  contextSummary?: string;
  contextThroughId?: string;
  /** LLM connection slug for this session (locked after first message) */
  llmConnection?: string;
  llmConnectionId?: string;
  /** Whether the connection is locked (cannot be changed after first agent creation) */
  connectionLocked?: boolean;
  /** Thinking level for this session ('off', 'think', 'max') */
  thinkingLevel?: ThinkingLevel;
  /**
   * Pending plan execution state - tracks "Accept & Compact" flow.
   * When set, indicates a plan needs to be executed after compaction completes.
   * Cleared on: successful execution, new user message, or manual clear.
   */
  pendingPlanExecution?: {
    /** Path to the plan file to execute */
    planPath: string;
    /** Optional snapshot of draft input captured at accept time */
    draftInputSnapshot?: string;
    /** Whether we're still waiting for compaction to complete */
    awaitingCompaction: boolean;
    /** Whether execution has already been dispatched from the UI. */
    executionDispatched?: boolean;
  };
  /** Whether this session is archived: its status is the `archived` one (category 'archived'). */
  isArchived?: boolean;
  /**
   * Message ID this session was branched from.
   * Branching semantics are a hard cutoff: model context must not include parent messages after this message.
   */
  branchFromMessageId?: string;
  /** Parent session's Pi session ID (set when the branch forks the parent's Pi history). */
  branchFromSdkSessionId?: string;
  /** Parent session's storage path, where its Pi session files are. */
  branchFromSessionPath?: string;
  /** The parent's Pi session entry at the branch point (used with Pi's SessionManager.branch(anchor)). */
  branchFromSdkTurnId?: string;
  /** One-shot hidden summary injected on the first turn after a remote transfer. */
  transferredSessionSummary?: string;
  /** Whether the transferred-session summary has already been injected. */
  transferredSessionSummaryApplied?: boolean;
  /** Metadata for sessions created by automations */
  triggeredBy?: {
    automationName?: string;
    /** Matcher id of the automation that created the session (loop guard: it never re-triggers itself). */
    automationId?: string;
    event?: string;
    timestamp?: number;
    /** 1 for a session an automation created from a user event; +1 per automation-created hop. */
    depth?: number;
  };
  /** Workspace-scoped project id this session belongs to (undefined = unbound). */
  projectId?: string;
  contextEntity?: string;
  /** Parent session id — when set, this session is a subtask of the parent (undefined = top-level task). */
  parentSessionId?: string;
}

/**
 * Stored session with conversation data
 */
export interface StoredSession extends SessionConfig {
  messages: StoredMessage[];
  tokenUsage: SessionTokenUsage;
}

/**
 * A chat's fields as a session bundle carries them (`bundle.ts`, export/import): the config plus the list fields.
 */
export interface SessionHeader {
  id: string;
  /** SDK session ID (captured after first message) */
  sdkSessionId?: string;
  /** Workspace root path (stored as portable path, e.g., ~/.otto/...) */
  workspaceRootPath: string;
  /** Optional user-defined name */
  name?: string;
  /** Actor ('user:<id>') the chat belongs to: only they see it. Set by the server at creation, never by a client. Absent: made before chats were private, visible to the workspace owners only. */
  createdBy?: string;
  /** A direct message's pair key ('user:<a>|user:<b>', sorted; unique per workspace); absent on every other chat. */
  dmKey?: string;
  /** The chat's primary agent (`agents` row id): it replies when one person talks to it; absent = a people chat (no agent replies unless mentioned). */
  agentId?: string;
  createdAt: number;
  lastUsedAt: number;
  /** Timestamp of last meaningful message — persisted separately from lastUsedAt for stable date grouping across restarts. */
  lastMessageAt?: number;
  /** Whether this session is flagged */
  isFlagged?: boolean;
  /** Permission mode for this session ('safe', 'ask', 'guarded', 'allow-all') */
  permissionMode?: PermissionMode;
  /** Previous permission mode (used to preserve modeTransition context across restarts) */
  previousPermissionMode?: PermissionMode;
  /** User-controlled session status - determines inbox vs completed */
  sessionStatus?: SessionStatus;
  /** Labels applied to this session (bare IDs or "id::value" entries) */
  labels?: string[];
  /** ID of last message user has read */
  lastReadMessageId?: string;
  /** Unread for the viewer (computed from their `chats_members.read_at`; never stored on the chat). For an import: whether its creator has read it. */
  hasUnread?: boolean;
  /** Per-session source selection (source slugs) */
  enabledSourceSlugs?: string[];
  /** Working directory for this session (used by agent for bash commands and context) */
  workingDirectory?: string;
  /** Shared viewer URL (if shared via viewer) */
  sharedUrl?: string;
  /** Shared session ID in viewer (for revoke) */
  sharedId?: string;
  /** Model to use for this session (overrides global config if set) */
  model?: string;
  /** LLM connection slug for this session (locked after first message) */
  llmConnection?: string;
  llmConnectionId?: string;
  /** Whether the connection is locked (cannot be changed after first agent creation) */
  connectionLocked?: boolean;
  /** Thinking level for this session ('off', 'think', 'max') */
  thinkingLevel?: ThinkingLevel;
  /**
   * Pending plan execution state - tracks "Accept & Compact" flow.
   * When set, indicates a plan needs to be executed after compaction completes.
   * Cleared on: successful execution, new user message, or manual clear.
   */
  pendingPlanExecution?: {
    /** Path to the plan file to execute */
    planPath: string;
    /** Optional snapshot of draft input captured at accept time */
    draftInputSnapshot?: string;
    /** Whether we're still waiting for compaction to complete */
    awaitingCompaction: boolean;
    /** Whether execution has already been dispatched from the UI. */
    executionDispatched?: boolean;
  };
  /** Whether this session is archived: its status is the `archived` one (category 'archived'). */
  isArchived?: boolean;
  /** One-shot hidden summary injected on the first turn after a remote transfer. */
  transferredSessionSummary?: string;
  /** Whether the transferred-session summary has already been injected. */
  transferredSessionSummaryApplied?: boolean;
  /** Metadata for sessions created by automations */
  triggeredBy?: {
    automationName?: string;
    /** Matcher id of the automation that created the session (loop guard: it never re-triggers itself). */
    automationId?: string;
    event?: string;
    timestamp?: number;
    /** 1 for a session an automation created from a user event; +1 per automation-created hop. */
    depth?: number;
  };
  /** Workspace-scoped project id this session belongs to (undefined = unbound). */
  projectId?: string;
  contextEntity?: string;
  /** Parent session id — when set, this session is a subtask of the parent (undefined = top-level task). */
  parentSessionId?: string;
  // Pre-computed fields for fast list loading
  /** Number of messages in session */
  messageCount: number;
  /** Role/type of the last message (for badge display without loading messages) */
  lastMessageRole?: 'user' | 'assistant' | 'plan' | 'tool' | 'error';
  /** Preview of first user message (first 150 chars) */
  preview?: string;
  /** Token usage statistics */
  tokenUsage: SessionTokenUsage;
  /** ID of the last final (non-intermediate) assistant message - for unread detection without loading messages */
  lastFinalMessageId?: string;
}

/**
 * Session metadata (lightweight, for lists)
 */
export interface SessionMetadata {
  id: string;
  workspaceRootPath: string;
  name?: string;
  /** Actor ('user:<id>') the chat belongs to; absent on chats made before chats were private. */
  createdBy?: string;
  /** A direct message's pair key ('user:<a>|user:<b>', sorted; unique per workspace); absent on every other chat. */
  dmKey?: string;
  /** The chat's primary agent (`agents` row id): it replies when one person talks to it; absent = a people chat (no agent replies unless mentioned). */
  agentId?: string;
  createdAt: number;
  lastUsedAt: number;
  /** Timestamp of last meaningful message — used for date grouping. Falls back to lastUsedAt for pre-fix sessions. */
  lastMessageAt?: number;
  messageCount: number;
  /** Preview of first user message */
  preview?: string;
  sdkSessionId?: string;
  /** Whether this session is flagged */
  isFlagged?: boolean;
  /** User-controlled session status */
  sessionStatus?: SessionStatus;
  /** Labels applied to this session (bare IDs or "id::value" entries) */
  labels?: string[];
  /** Explicit per-session source selection (absent = follow workspace defaults) */
  enabledSourceSlugs?: string[];
  /** Permission mode for this session */
  permissionMode?: PermissionMode;
  /** Previous permission mode (used to preserve modeTransition context across restarts) */
  previousPermissionMode?: PermissionMode;
  /** Number of plan files for this session */
  planCount?: number;
  /** Shared viewer URL (if shared via viewer) */
  sharedUrl?: string;
  /** Shared session ID in viewer (for revoke) */
  sharedId?: string;
  /** Working directory for this session */
  workingDirectory?: string;
  /** Role/type of the last message (for badge display without loading messages) */
  lastMessageRole?: 'user' | 'assistant' | 'plan' | 'tool' | 'error';
  /** Model to use for this session (overrides global config if set) */
  model?: string;
  /** LLM connection slug for this session (locked after first message) */
  llmConnection?: string;
  llmConnectionId?: string;
  /** Whether the connection is locked (cannot be changed after first agent creation) */
  connectionLocked?: boolean;
  /** Thinking level for this session ('off', 'think', 'max') */
  thinkingLevel?: ThinkingLevel;
  /** ID of last message user has read - for unread detection */
  lastReadMessageId?: string;
  /** ID of the last final (non-intermediate) assistant message - for unread detection */
  lastFinalMessageId?: string;
  /** Unread for the viewer (computed from their `chats_members.read_at`; never stored on the chat). For an import: whether its creator has read it. */
  hasUnread?: boolean;
  /** Token usage statistics (from JSONL header, available without loading messages) */
  tokenUsage?: SessionTokenUsage;
  /** Whether this session is archived: its status is the `archived` one (category 'archived'). */
  isArchived?: boolean;
  /** Message ID that this session was branched from (hard context cutoff marker). */
  branchFromMessageId?: string;
  /** Workspace-scoped project id this session belongs to (undefined = unbound). */
  projectId?: string;
  contextEntity?: string;
  /** Parent session id — when set, this session is a subtask of the parent (undefined = top-level task). */
  parentSessionId?: string;
}
