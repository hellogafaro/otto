import { and, eq, inArray, sql } from 'drizzle-orm'
import { initDb, type Db, type Tx } from '../db/index.ts'
import { chats, chatsMembers } from './schema.ts'

/**
 * The members of chats (`chats_members`, docs/schema.md "Chats"): the people who see a chat and may write in it
 * ('user:<id>') and the agents in it ('agent:<id>': the primary agent and every agent mentioned). The creator is
 * always a member. A person's `read_at` is when they last read the chat (null = never); unread = the chat's
 * `updated_at` is newer. Only this module and ./chats.ts read the table.
 */

export interface ChatMember {
  actor: string
  /** When the person last read the chat (ms); null = never, and always null for an agent. */
  readAt: number | null
}

const isPerson = (actor: string) => actor.startsWith('user:')

/** The key of the direct message between two people ('user:<a>|user:<b>', sorted), unique per workspace. */
export function toDmKey(a: string, b: string): string {
  return [a, b].sort().join('|')
}

/** The chat of a DM key in a workspace, or null. */
export function getDmChatId(workspaceId: string, dmKey: string, db: Db | Tx = initDb()): string | null {
  return db.select({ id: chats.id }).from(chats).where(and(eq(chats.workspaceId, workspaceId), eq(chats.dmKey, dmKey))).get()?.id ?? null
}

const toMember = (row: { actor: string; readAt: Date | null }): ChatMember => ({ actor: row.actor, readAt: row.readAt ? row.readAt.getTime() : null })

/** The members of one chat, oldest first. */
export function getChatMembers(workspaceId: string, chatId: string, db: Db | Tx = initDb()): ChatMember[] {
  return db
    .select({ actor: chatsMembers.actor, readAt: chatsMembers.readAt })
    .from(chatsMembers)
    .where(and(eq(chatsMembers.workspaceId, workspaceId), eq(chatsMembers.chatId, chatId)))
    .orderBy(chatsMembers.createdAt, sql`rowid`)
    .all()
    .map(toMember)
}

/** The members of every chat of a workspace (the boot load), oldest first per chat. */
export function getChatsMembers(workspaceId: string, db: Db | Tx = initDb()): Map<string, ChatMember[]> {
  const byChat = new Map<string, ChatMember[]>()
  const rows = db
    .select({ chatId: chatsMembers.chatId, actor: chatsMembers.actor, readAt: chatsMembers.readAt })
    .from(chatsMembers)
    .where(eq(chatsMembers.workspaceId, workspaceId))
    .orderBy(chatsMembers.createdAt, sql`rowid`)
    .all()
  for (const row of rows) {
    let list = byChat.get(row.chatId)
    if (!list) byChat.set(row.chatId, (list = []))
    list.push(toMember(row))
  }
  return byChat
}

/**
 * Adds members to a chat (an actor already in it is left as it is). A person starts with `readAt` (default null:
 * unread); an agent always has none. Returns the actors that were added.
 */
export function addChatMembers(
  workspaceId: string,
  chatId: string,
  actors: readonly string[],
  { readAt = null, now = Date.now() }: { readAt?: number | null; now?: number } = {},
  db: Db | Tx = initDb(),
): string[] {
  const added: string[] = []
  for (const actor of new Set(actors)) {
    const row = db
      .insert(chatsMembers)
      .values({ workspaceId, chatId, actor, readAt: isPerson(actor) && readAt !== null ? new Date(readAt) : null, createdAt: new Date(now) })
      .onConflictDoNothing()
      .returning({ actor: chatsMembers.actor })
      .get()
    if (row) added.push(actor)
  }
  return added
}

/** Removes a member from a chat; returns whether it was one. */
export function removeChatMember(workspaceId: string, chatId: string, actor: string, db: Db | Tx = initDb()): boolean {
  return !!db
    .delete(chatsMembers)
    .where(and(eq(chatsMembers.workspaceId, workspaceId), eq(chatsMembers.chatId, chatId), eq(chatsMembers.actor, actor)))
    .returning({ actor: chatsMembers.actor })
    .get()
}

/** Sets when a person last read a chat (null = unread). */
export function updateChatMemberRead(workspaceId: string, chatId: string, actor: string, readAt: number | null, db: Db | Tx = initDb()): void {
  db.update(chatsMembers)
    .set({ readAt: readAt === null ? null : new Date(readAt) })
    .where(and(eq(chatsMembers.workspaceId, workspaceId), eq(chatsMembers.chatId, chatId), eq(chatsMembers.actor, actor)))
    .run()
}

/** A DM that gains a third person becomes a group: it loses its key, so the pair's next DM is a new chat. */
export function clearChatDmKey(workspaceId: string, chatId: string, db: Db | Tx = initDb()): void {
  db.update(chats).set({ dmKey: null }).where(and(eq(chats.workspaceId, workspaceId), eq(chats.id, chatId))).run()
}

/** Deletes every member row of a chat (the chat is being deleted). */
export function deleteChatMembers(tx: Db | Tx, workspaceId: string, chatId: string): void {
  tx.delete(chatsMembers).where(and(eq(chatsMembers.workspaceId, workspaceId), eq(chatsMembers.chatId, chatId))).run()
}

/** Moves an agent's chats to another agent (the agent is deleted): its member rows go, `to` joins where it was primary. */
export function updateMembersAgent(tx: Db | Tx, workspaceId: string, fromAgentId: string, toAgentId: string | null, primaryOf: readonly string[]): void {
  tx.delete(chatsMembers).where(and(eq(chatsMembers.workspaceId, workspaceId), eq(chatsMembers.actor, `agent:${fromAgentId}`))).run()
  if (toAgentId) for (const chatId of primaryOf) addChatMembers(workspaceId, chatId, [`agent:${toAgentId}`], {}, tx)
}

/** The chats among `chatIds` that have `actor` as a member. */
export function getChatsWithMember(workspaceId: string, actor: string, chatIds: readonly string[], db: Db | Tx = initDb()): string[] {
  if (!chatIds.length) return []
  return db
    .select({ chatId: chatsMembers.chatId })
    .from(chatsMembers)
    .where(and(eq(chatsMembers.workspaceId, workspaceId), eq(chatsMembers.actor, actor), inArray(chatsMembers.chatId, [...chatIds])))
    .all()
    .map((row) => row.chatId)
}

/**
 * Boot reconcile (idempotent, reads and adds only): every chat without member rows gets them: its creator, its agent
 * (`agent_id`, else the workspace's default agent, which then becomes its `agent_id`: before members a null agent meant
 * the default one) and the distinct `sender`s of its user messages. People get the chat's old `read_at` while that
 * column still exists (`scripts/db-chat-members.ts` runs this before it drops it), else the chat's `updated_at`.
 * Returns how many chats got members.
 */
export function initChatMembers(defaultAgentOf: (workspaceId: string) => string | undefined, db: Db | Tx = initDb()): number {
  const hasReadAt = db.all<{ name: string }>(sql`SELECT name FROM pragma_table_info('chats')`).some((column) => column.name === 'read_at')
  const rows = db.all<{ id: string; workspace_id: string; created_by: string; agent_id: string | null; read_at: number | null; created_at: number }>(sql`
    SELECT c.id, c.workspace_id, c.created_by, c.agent_id, ${hasReadAt ? sql`c.read_at` : sql`c.updated_at`} AS read_at, c.created_at FROM chats c
    WHERE NOT EXISTS (SELECT 1 FROM chats_members m WHERE m.chat_id = c.id)`)
  for (const chat of rows) {
    db.transaction(
      (tx) => {
        const agentId = chat.agent_id ?? defaultAgentOf(chat.workspace_id) ?? null
        if (agentId && !chat.agent_id) tx.run(sql`UPDATE chats SET agent_id = ${agentId} WHERE id = ${chat.id}`)
        const senders = tx
          .all<{ sender: string | null }>(sql`SELECT DISTINCT json_extract(content, '$.sender') AS sender FROM messages WHERE chat_id = ${chat.id} AND type = 'user'`)
          .map((row) => row.sender)
          .filter((sender): sender is string => !!sender && isPerson(sender))
        const people = [...new Set([chat.created_by, ...senders].filter(isPerson))]
        addChatMembers(chat.workspace_id, chat.id, people, { readAt: chat.read_at, now: chat.created_at }, tx)
        if (agentId) addChatMembers(chat.workspace_id, chat.id, [`agent:${agentId}`], { now: chat.created_at }, tx)
      },
      { behavior: 'immediate' },
    )
  }
  return rows.length
}
