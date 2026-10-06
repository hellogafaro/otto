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
export { onChatsChange, notifyChatsChange, getChatsFields, toPreview, type ChatSnapshot } from './chats.ts';
export { searchChats, runChatsRecovery, initMessages, rebuildMessagesSearch, type ChatSearchResult, type RecoveryReport } from './messages.ts';

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
