import { and, asc, eq } from 'drizzle-orm'
import { initDb, type Db, type Tx } from '../db/index.ts'
import { workspacesMembers } from './schema.ts'

/**
 * Who owns a workspace (`workspaces_members.role = 'owner'`). Private chats lean on it: a chat
 * made before chats were private has no creator and belongs to the owners.
 */

/** User ids of the workspace's owners, the one who joined first at the front. */
export function getWorkspaceOwnerIds(workspaceId: string, db: Db | Tx = initDb()): string[] {
  return db
    .select({ userId: workspacesMembers.userId })
    .from(workspacesMembers)
    .where(and(eq(workspacesMembers.workspaceId, workspaceId), eq(workspacesMembers.role, 'owner')))
    .orderBy(asc(workspacesMembers.createdAt), asc(workspacesMembers.id))
    .all()
    .map((row) => row.userId)
}

export const isWorkspaceOwner = (workspaceId: string, userId: string, db: Db | Tx = initDb()): boolean =>
  getWorkspaceOwnerIds(workspaceId, db).includes(userId)
