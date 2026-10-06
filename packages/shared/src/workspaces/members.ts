import { and, eq, gt, notInArray, sql } from 'drizzle-orm'
import { initDb, type Db, type Tx } from '../db/index.ts'
import { createId } from '../id.ts'
import { workspaces, workspacesInvitations, workspacesMembers } from './schema.ts'

/**
 * The database side of workspaces: the mirror Better Auth's organization plugin needs, who is
 * in a workspace and who is invited (tables in ./schema.ts). The registry itself stays in the
 * config; `updateWorkspaceMirror` copies it here and the config calls it whenever it changes.
 */

/** Makes the mirror equal to the registry: upserts every workspace, removes the others with their members and invitations. */
export function updateWorkspaceMirror(list: { id: string; title: string }[], db: Db | Tx = initDb()): void {
  const run = (tx: Tx) => {
    const ids = list.map((workspace) => workspace.id)
    for (const { id, title } of list) {
      tx.insert(workspaces)
        .values({ id, title, slug: id, createdAt: new Date() })
        .onConflictDoUpdate({ target: workspaces.id, set: { title } })
        .run()
    }
    for (const table of [workspacesMembers, workspacesInvitations]) {
      tx.delete(table).where(notInArray(table.workspaceId, ids)).run()
    }
    tx.delete(workspaces).where(notInArray(workspaces.id, ids)).run()
  }
  // Inside a caller's transaction this nests.
  db.transaction(run)
}

/** Makes the user an owner of every mirrored workspace they are not already in. Idempotent. */
export function initWorkspaceOwner(userId: string, db: Db | Tx = initDb()): void {
  const now = new Date()
  for (const { id } of db.select({ id: workspaces.id }).from(workspaces).all()) {
    db.insert(workspacesMembers)
      .values({ id: createId(), workspaceId: id, userId, role: 'owner', createdAt: now })
      .onConflictDoNothing()
      .run()
  }
}

/** Whether a pending, unexpired invitation exists for exactly this email (case does not matter). */
export function hasPendingInvitation(email: string, db: Db | Tx = initDb()): boolean {
  return !!db
    .select({ id: workspacesInvitations.id })
    .from(workspacesInvitations)
    .where(
      and(
        eq(sql`lower(${workspacesInvitations.email})`, email.toLowerCase()),
        eq(workspacesInvitations.status, 'pending'),
        gt(workspacesInvitations.expiresAt, new Date()),
      ),
    )
    .get()
}
