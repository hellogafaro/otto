/**
 * Sessions Module
 *
 * Public exports for workspace-scoped chats: `chats` and `messages` rows (./schema.ts), their write queue, list,
 * pages, search and boot recovery.
 */

// Types
export type {
  SessionStatus,
  SessionTokenUsage,
  StoredMessage,
  SessionConfig,
  StoredSession,
  SessionMetadata,
  SessionHeader,
  SessionPersistentField,
} from './types.ts';

// Field constants
export { SESSION_PERSISTENT_FIELDS } from './types.ts';

// Storage functions
export {
  // Directory utilities
  ensureSessionsDir,
  ensureSessionDir,
  getSessionPath,
  getSessionPlansPath,
  // Chats in the database
  type ChatWorkspace,
  createSession,
  createImportedSession,
  loadSession,
  getSessionMessages,
  listSessions,
  deleteSession,
  EMPTY_TOKEN_USAGE,
  // Plan storage
  formatPlanAsMarkdown,
  parsePlanFromMarkdown,
  savePlanToFile,
  loadPlanFromFile,
  loadPlanFromPath,
  listPlanFiles,
  deletePlanFile,
  getMostRecentPlanFile,
  // Write path
  sessionPersistenceQueue,
} from './storage.ts';
export type { ChatWrite } from './persistence-queue.ts';
export { onChatsChange, notifyChatsChange, getChatsFields, getChatWorkspaceId, toPreview, type ChatSnapshot, type AgentCursor } from './chats.ts';
export {
  initChatMembers,
  getChatMembers,
  getChatsMembers,
  addChatMembers,
  removeChatMember,
  updateChatMemberRead,
  clearChatDmKey,
  getDmChatId,
  toDmKey,
  type ChatMember,
} from './members.ts';
export { searchChats, getChatLog, type ChatLogRow, runChatsRecovery, initMessages, rebuildMessagesSearch, type ChatSearchResult, type RecoveryReport } from './messages.ts';

// Pi's session file in object storage
export { uploadPiSession, restorePiSession, deletePiSession, type PiSessionRef } from './pi-session-sync.ts';

// Field utilities
export { pickSessionFields } from './utils.ts';

// Session ID validation (security)
export {
  validateSessionId,
  sanitizeSessionId,
} from './validation.ts';

// Session bundle (export/import/dispatch)
export type {
  SessionBundle,
  BundleFile,
  DispatchMode,
} from './bundle.ts';
export {
  serializeSession,
  validateBundle,
  MAX_BUNDLE_SIZE_BYTES,
} from './bundle.ts';
