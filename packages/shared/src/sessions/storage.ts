/**
 * Session Storage
 *
 * Chats are rows of `chats` and `messages` (./chats.ts, ./messages.ts; docs/schema.md); this file is how the rest
 * of the server creates, reads and deletes them, and where each chat's working folder is:
 * {workspaceRootPath}/sessions/{id}/ with
 * - attachments/ (file attachments)
 * - plans/ (plan files for Safe Mode)
 * - data/ (transform_data tool output: JSON files for datatable/spreadsheet blocks)
 * - long_responses/ (full tool results that were summarized due to size limits)
 * - downloads/ (binary files downloaded from API sources: PDFs, images, archives, etc.)
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
} from 'fs';
import { join, basename } from 'path';
import { getWorkspaceSessionsPath } from '../workspaces/storage.ts';
import { sanitizeSessionId } from './validation.ts';
import { perf } from '../utils/perf.ts';
import { initDb, type Db, type Tx } from '../db/index.ts';
import { createId } from '../id.ts';
import type { SessionConfig, StoredMessage, StoredSession, SessionMetadata } from './types.ts';
import type { Plan } from '../agent/plan-types.ts';
import { debug } from '../utils/debug.ts';
import { deleteChat, getChat, getChats, writeChat } from './chats.ts';
import { addChatMembers } from './members.ts';
import { getDefaultAgent } from '../agents/index.ts';
import { copyMessages, fromMessageRow, getMessageRows, getMessagesPage, initMessages, toMessageRow, writeMessages } from './messages.ts';
import { sessionPersistenceQueue } from './persistence-queue.ts';

// Re-export types for convenience
export type { SessionConfig } from './types.ts';

// ============================================================
// Directory Utilities
// ============================================================

/**
 * Ensure sessions directory exists for a workspace
 */
export function ensureSessionsDir(workspaceRootPath: string): string {
  const dir = getWorkspaceSessionsPath(workspaceRootPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Get path to a session's directory
 *
 * SECURITY: Uses sanitizeSessionId() as defense-in-depth to prevent path traversal.
 * Callers should still validate sessionId before calling this function.
 */
export function getSessionPath(workspaceRootPath: string, sessionId: string): string {
  // Defense-in-depth: strip any path components from sessionId
  const safeSessionId = sanitizeSessionId(sessionId);
  return join(getWorkspaceSessionsPath(workspaceRootPath), safeSessionId);
}

/**
 * Ensure session directory exists with all subdirectories
 */
export function ensureSessionDir(workspaceRootPath: string, sessionId: string): string {
  const sessionDir = getSessionPath(workspaceRootPath, sessionId);
  if (!existsSync(sessionDir)) {
    mkdirSync(sessionDir, { recursive: true });
  }
  // Also create plans, long_responses, data, and downloads directories
  const plansDir = join(sessionDir, 'plans');
  if (!existsSync(plansDir)) {
    mkdirSync(plansDir, { recursive: true });
  }
  const longResponsesDir = join(sessionDir, 'long_responses');
  if (!existsSync(longResponsesDir)) {
    mkdirSync(longResponsesDir, { recursive: true });
  }
  // Data directory for transform_data tool output (JSON files for datatable/spreadsheet)
  const dataDir = join(sessionDir, 'data');
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
  // Downloads directory for binary files from API responses (PDFs, images, etc.)
  const downloadsDir = join(sessionDir, 'downloads');
  if (!existsSync(downloadsDir)) {
    mkdirSync(downloadsDir, { recursive: true });
  }
  return sessionDir;
}

/**
 * Get the plans directory for a session
 */
export function getSessionPlansPath(workspaceRootPath: string, sessionId: string): string {
  return join(getSessionPath(workspaceRootPath, sessionId), 'plans');
}

/**
 * Get the data directory for a session (transform_data tool output)
 */
export function getSessionDataPath(workspaceRootPath: string, sessionId: string): string {
  return join(getSessionPath(workspaceRootPath, sessionId), 'data');
}

/**
 * Get the downloads directory for a session (binary files from API responses)
 */
export function getSessionDownloadsPath(workspaceRootPath: string, sessionId: string): string {
  return join(getSessionPath(workspaceRootPath, sessionId), 'downloads');
}

// ============================================================
// Chats in the database
// ============================================================

/** A workspace as chat storage needs it: the id its rows carry and the root its folders live under. */
export interface ChatWorkspace {
  id: string;
  rootPath: string;
}

/** The members every chat starts with: its creator (read at `readAt`) and its primary agent. */
export function addFirstMembers(tx: Db | Tx, workspaceId: string, chat: Pick<SessionConfig, 'id' | 'createdBy' | 'agentId'>, readAt: number | null, now: number): void {
  if (chat.createdBy) addChatMembers(workspaceId, chat.id, [chat.createdBy], { readAt, now }, tx);
  if (chat.agentId) addChatMembers(workspaceId, chat.id, [`agent:${chat.agentId}`], { now }, tx);
}

/**
 * Create a chat: its folder and its row (and, for a branch, its copied messages, in the same transaction). New ids
 * are `createId()`; chats made before keep their `YYMMDD-adjective-noun` ids.
 */
export function createSession(
  workspace: ChatWorkspace,
  options?: {
    name?: string;
    /** Actor the chat belongs to ('user:<id>'); the server sets it, never a client. */
    createdBy?: string;
    /** The chat's primary agent; absent = a people chat (the caller resolves the default agent). */
    agentId?: string;
    /** Other people in the chat from the start ('user:<id>'; unread for them). The creator and the agent always are. */
    people?: string[];
    /** A direct message's pair key (`toDmKey`). */
    dmKey?: string;
    workingDirectory?: string;
    permissionMode?: SessionConfig['permissionMode'];
    enabledSourceSlugs?: string[];
    model?: string;
    llmConnection?: string;
    sessionStatus?: SessionConfig['sessionStatus'];
    labels?: string[];
    isFlagged?: boolean;
    projectId?: string;
    parentSessionId?: string;
    /** Branch: copy the messages of `fromSessionId` up to and including `throughMessageId`. */
    branch?: { fromSessionId: string; throughMessageId: string } & Pick<SessionConfig, 'branchFromMessageId' | 'branchFromSdkSessionId' | 'branchFromSessionPath' | 'branchFromSdkTurnId'>;
  },
  db: Db = initDb(),
): SessionConfig {
  const now = Date.now();
  const sessionId = createId();
  ensureSessionDir(workspace.rootPath, sessionId);
  const { branch, people = [], ...fields } = options ?? {};
  const { fromSessionId, throughMessageId, ...branchFields } = branch ?? ({} as NonNullable<typeof branch>);
  const session: SessionConfig = {
    id: sessionId,
    workspaceRootPath: workspace.rootPath,
    ...fields,
    ...branchFields,
    createdAt: now,
    lastUsedAt: now,
  };
  initMessages(db);
  db.transaction(
    (tx) => {
      writeChat(tx, { ...session, workspaceId: workspace.id }, { labels: options?.labels ?? [] });
      addFirstMembers(tx, workspace.id, session, now, now);
      addChatMembers(workspace.id, sessionId, people, { now }, tx);
      if (branch) copyMessages(tx, workspace.id, fromSessionId, sessionId, throughMessageId);
    },
    { behavior: 'immediate' },
  );
  return session;
}

/**
 * Create a chat from a whole stored session (a bundle import): its row and every message in one transaction. Paths
 * already written as `{{SESSION_PATH}}` stay tokens, so they resolve to this chat's folder. The folder is the
 * caller's (it restores the bundle's files).
 */
export function createImportedSession(workspace: ChatWorkspace, session: StoredSession, db: Db = initDb()): void {
  const { messages, ...fields } = session;
  // a chat from before members had no agent for "the default one"
  const chat = { ...fields, agentId: fields.agentId ?? (fields.dmKey ? undefined : getDefaultAgent(workspace.id, db)?.id) };
  const sessionDir = getSessionPath(workspace.rootPath, session.id);
  const rows = [...messages]
    .map((message, index) => ({ message, index }))
    .sort((a, b) => (a.message.timestamp ?? 0) - (b.message.timestamp ?? 0) || a.index - b.index)
    .map(({ message }) => ({ ...toMessageRow(message, sessionDir), reposition: true }));
  initMessages(db);
  db.transaction(
    (tx) => {
      writeChat(tx, { ...chat, workspaceId: workspace.id }, { labels: chat.labels ?? [] });
      writeMessages(tx, workspace.id, session.id, rows, []);
      addFirstMembers(tx, workspace.id, chat, chat.hasUnread ? null : Date.now(), chat.createdAt);
    },
    { behavior: 'immediate' },
  );
}

/**
 * A chat with all its messages, or null. Records what was read as the write path's baseline, so the next write of
 * this chat stores only what changed.
 */
export function loadSession(workspace: ChatWorkspace, sessionId: string, db: Db = initDb()): StoredSession | null {
  const end = perf.start('session.loadSession', { sessionId });
  try {
    const chat = getChat(workspace.id, workspace.rootPath, sessionId, db);
    if (!chat) return null;
    const rows = getMessageRows(workspace.id, sessionId, db);
    sessionPersistenceQueue.seed(sessionId, rows);
    const sessionDir = getSessionPath(workspace.rootPath, sessionId);
    const messages: StoredMessage[] = [];
    for (const row of rows) {
      try {
        messages.push(fromMessageRow(row, sessionDir));
      } catch (error) {
        debug(`[sessions] unreadable message ${row.id} of ${sessionId}, skipped:`, error);
      }
    }
    return { ...chat, messages, tokenUsage: chat.tokenUsage ?? { ...EMPTY_TOKEN_USAGE } } as StoredSession;
  } finally {
    end();
  }
}

/** A page of a chat's messages, oldest first (see `getMessagesPage`). */
export function getSessionMessages(workspace: ChatWorkspace, sessionId: string, options: { beforeId?: string; limit?: number } = {}, db: Db = initDb()) {
  return getMessagesPage(workspace.id, sessionId, getSessionPath(workspace.rootPath, sessionId), options, db);
}

/** Every chat of a workspace (newest first), with its list fields. The server's own read: no private rule here. */
export function listSessions(workspace: ChatWorkspace, db: Db = initDb()): SessionMetadata[] {
  const span = perf.span('session.listSessions');
  const chats = getChats(workspace.id, workspace.rootPath, {}, db);
  span.setMetadata('count', chats.length);
  span.end();
  return chats;
}

/** Delete a chat: its rows (messages, search entries, labels) and its folder. */
export function deleteSession(workspace: ChatWorkspace, sessionId: string, db: Db = initDb()): boolean {
  try {
    sessionPersistenceQueue.cancel(sessionId);
    deleteChat(workspace.id, sessionId, db);
    const sessionDir = getSessionPath(workspace.rootPath, sessionId);
    if (existsSync(sessionDir)) rmSync(sessionDir, { recursive: true });
    return true;
  } catch (error) {
    debug(`[sessions] deleting ${sessionId} failed:`, error);
    return false;
  }
}

export const EMPTY_TOKEN_USAGE = { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0, costUsd: 0 };

export { sessionPersistenceQueue } from './persistence-queue.ts';

// ============================================================
// Plan Storage (Session-Scoped)
// ============================================================

/**
 * Slugify a string for file names
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[/\\:*?"<>|]/g, '')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .trim();
}

/**
 * Generate a unique, readable file name for a plan
 */
function generatePlanFileName(plan: Plan, plansDir: string): string {
  let name = plan.title || plan.context?.substring(0, 50) || 'untitled';
  let slug = slugify(name);

  if (slug.length > 40) {
    slug = slug.substring(0, 40).replace(/-$/, '');
  }

  const date = new Date().toISOString().split('T')[0];
  const baseName = `${date}-${slug}`;

  let fileName = baseName;
  let counter = 2;

  while (existsSync(join(plansDir, `${fileName}.md`))) {
    fileName = `${baseName}-${counter}`;
    counter++;
  }

  return fileName;
}

/**
 * Ensure the plans directory exists
 */
function ensurePlansDir(workspaceRootPath: string, sessionId: string): string {
  const plansDir = getSessionPlansPath(workspaceRootPath, sessionId);
  if (!existsSync(plansDir)) {
    mkdirSync(plansDir, { recursive: true });
  }
  return plansDir;
}

/**
 * Format a plan as markdown
 */
export function formatPlanAsMarkdown(plan: Plan): string {
  const lines: string[] = [];

  lines.push(`# ${plan.title}`);
  lines.push('');
  lines.push(`**Status:** ${plan.state}`);
  lines.push(`**Created:** ${new Date(plan.createdAt).toISOString()}`);
  if (plan.updatedAt !== plan.createdAt) {
    lines.push(`**Updated:** ${new Date(plan.updatedAt).toISOString()}`);
  }
  lines.push('');

  if (plan.context) {
    lines.push('## Summary');
    lines.push('');
    lines.push(plan.context);
    lines.push('');
  }

  lines.push('## Steps');
  lines.push('');
  for (const step of plan.steps) {
    const checkbox = step.status === 'completed' ? '[x]' : '[ ]';
    const status = step.status === 'in_progress' ? ' *(in progress)*' : '';
    lines.push(`- ${checkbox} ${step.description}${status}`);
    if (step.details) {
      lines.push(`  - Tools: ${step.details}`);
    }
  }
  lines.push('');

  if (plan.refinementHistory && plan.refinementHistory.length > 0) {
    lines.push('## Refinement History');
    lines.push('');
    for (const entry of plan.refinementHistory) {
      lines.push(`### Round ${entry.round}`);
      lines.push(`**Feedback:** ${entry.feedback}`);
      if (entry.questions && entry.questions.length > 0) {
        lines.push(`**Questions:** ${entry.questions.join(', ')}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Parse a markdown plan file back to a Plan object
 */
export function parsePlanFromMarkdown(content: string, planId: string): Plan | null {
  try {
    const lines = content.split('\n');

    const titleLine = lines.find(l => l.startsWith('# '));
    const title = titleLine ? titleLine.substring(2).trim() : 'Untitled Plan';

    const statusLine = lines.find(l => l.startsWith('**Status:**'));
    const stateStr = statusLine ? statusLine.replace('**Status:**', '').trim() : 'ready';
    const state = (['creating', 'refining', 'ready', 'executing', 'completed', 'cancelled'].includes(stateStr)
      ? stateStr
      : 'ready') as Plan['state'];

    const summaryIdx = lines.findIndex(l => l === '## Summary');
    const stepsIdx = lines.findIndex(l => l === '## Steps');
    let context = '';
    if (summaryIdx !== -1 && stepsIdx !== -1) {
      context = lines.slice(summaryIdx + 2, stepsIdx).join('\n').trim();
    }

    const steps: Plan['steps'] = [];
    if (stepsIdx !== -1) {
      for (let i = stepsIdx + 2; i < lines.length; i++) {
        const line = lines[i];
        if (!line || line.startsWith('##')) break;
        if (line.startsWith('- [')) {
          const isCompleted = line.startsWith('- [x]');
          const isInProgress = line.includes('*(in progress)*');
          const description = line
            .replace(/^- \[[ x]\] /, '')
            .replace(' *(in progress)*', '')
            .trim();
          steps.push({
            id: `step-${steps.length + 1}`,
            description,
            status: isCompleted ? 'completed' : isInProgress ? 'in_progress' : 'pending',
          });
        }
      }
    }

    return {
      id: planId,
      title,
      state,
      context,
      steps,
      refinementRound: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  } catch {
    return null;
  }
}

/**
 * Save a plan to a markdown file
 */
export function savePlanToFile(
  workspaceRootPath: string,
  sessionId: string,
  plan: Plan,
  fileName?: string
): string {
  const plansDir = ensurePlansDir(workspaceRootPath, sessionId);
  const name = fileName || generatePlanFileName(plan, plansDir);
  const filePath = join(plansDir, `${name}.md`);
  const content = formatPlanAsMarkdown(plan);

  writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

/**
 * Load a plan from a markdown file by name
 */
export function loadPlanFromFile(
  workspaceRootPath: string,
  sessionId: string,
  fileName: string
): Plan | null {
  const plansDir = getSessionPlansPath(workspaceRootPath, sessionId);
  const filePath = join(plansDir, `${fileName}.md`);
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    return parsePlanFromMarkdown(content, fileName);
  } catch {
    return null;
  }
}

/**
 * Load a plan from a full file path
 */
export function loadPlanFromPath(filePath: string): Plan | null {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    const fileName = basename(filePath).replace('.md', '') || 'unknown';
    return parsePlanFromMarkdown(content, fileName);
  } catch {
    return null;
  }
}

/**
 * List all plan files in a session
 */
export function listPlanFiles(
  workspaceRootPath: string,
  sessionId: string
): Array<{ name: string; path: string; modifiedAt: number }> {
  const plansDir = getSessionPlansPath(workspaceRootPath, sessionId);
  if (!existsSync(plansDir)) {
    return [];
  }

  try {
    const files = readdirSync(plansDir)
      .filter(f => f.endsWith('.md'))
      .map(f => {
        const filePath = join(plansDir, f);
        const stats = existsSync(filePath) ? statSync(filePath) : null;
        return {
          name: f.replace('.md', ''),
          path: filePath,
          modifiedAt: stats?.mtimeMs || 0,
        };
      })
      .sort((a, b) => b.modifiedAt - a.modifiedAt);

    return files;
  } catch {
    return [];
  }
}

/**
 * Delete a plan file
 */
export function deletePlanFile(
  workspaceRootPath: string,
  sessionId: string,
  fileName: string
): boolean {
  const plansDir = getSessionPlansPath(workspaceRootPath, sessionId);
  const filePath = join(plansDir, `${fileName}.md`);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
    return true;
  }
  return false;
}

/**
 * Get the most recent plan file for a session
 */
export function getMostRecentPlanFile(
  workspaceRootPath: string,
  sessionId: string
): { name: string; path: string } | null {
  const files = listPlanFiles(workspaceRootPath, sessionId);
  return files.length > 0 ? files[0]! : null;
}
