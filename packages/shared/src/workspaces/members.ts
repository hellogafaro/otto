import { and, desc, eq, gt, ne, notInArray, sql } from 'drizzle-orm'
import { initDb, type Db, type Tx } from '../db/index.ts'
import { createId } from '../id.ts'
import { domainError } from '../utils/errors.ts'
import type { WorkspaceRole } from './types.ts'
import { workspaces, workspacesInvitations, workspacesMembers } from './schema.ts'

/**
 * The database side of workspaces: the mirror Better Auth's organization plugin needs, who is
 * in a workspace and who is invited (tables in ./schema.ts). The registry itself stays in the
 * config; `updateWorkspaceMirror` copies it here and the config calls it whenever it changes.
 *
 * Members and invitations are plain Drizzle here, in the plugin's own rows: the invitation page
 * accepts through the plugin endpoint, and the RPCs work for every identity (the local app and the
 * server token have no plugin session). Roles are `owner` and `member`; a workspace always keeps an owner.
 */

const ROLES: readonly string[] = ['owner', 'member']
const INVITATION_EXPIRES_MS = 7 * 24 * 60 * 60 * 1000

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

/** The caller's role in a workspace, or null when they are not a member. */
export function getMemberRole(workspaceId: string, userId: string, db: Db | Tx = initDb()): WorkspaceRole | null {
  const row = db
    .select({ role: workspacesMembers.role })
    .from(workspacesMembers)
    .where(and(eq(workspacesMembers.workspaceId, workspaceId), eq(workspacesMembers.userId, userId)))
    .get()
  return (row?.role as WorkspaceRole | undefined) ?? null
}

export const isWorkspaceMember = (workspaceId: string, userId: string, db: Db | Tx = initDb()): boolean =>
  getMemberRole(workspaceId, userId, db) !== null

/** The ids of the workspaces a user belongs to. */
export function getMemberWorkspaceIds(userId: string, db: Db | Tx = initDb()): string[] {
  return db.select({ id: workspacesMembers.workspaceId }).from(workspacesMembers).where(eq(workspacesMembers.userId, userId)).all().map((row) => row.id)
}

export function getWorkspaceMembers(workspaceId: string, db: Db | Tx = initDb()): { userId: string; role: WorkspaceRole }[] {
  return db
    .select({ userId: workspacesMembers.userId, role: workspacesMembers.role })
    .from(workspacesMembers)
    .where(eq(workspacesMembers.workspaceId, workspaceId))
    .orderBy(desc(workspacesMembers.role), workspacesMembers.createdAt, workspacesMembers.userId) // owners first
    .all() as { userId: string; role: WorkspaceRole }[]
}

/** Adds a member (the creator of a new workspace is its owner). Does nothing when they are already in. */
export function createWorkspaceMember(workspaceId: string, userId: string, role: WorkspaceRole, db: Db | Tx = initDb()): void {
  db.insert(workspacesMembers).values({ id: createId(), workspaceId, userId, role, createdAt: new Date() }).onConflictDoNothing().run()
}

/** Pending invitations that have not expired, oldest first. */
export function getWorkspaceInvitations(workspaceId: string, db: Db | Tx = initDb()) {
  return db
    .select()
    .from(workspacesInvitations)
    .where(and(eq(workspacesInvitations.workspaceId, workspaceId), eq(workspacesInvitations.status, 'pending'), gt(workspacesInvitations.expiresAt, new Date())))
    .orderBy(workspacesInvitations.createdAt)
    .all()
}

export const getWorkspaceInvitation = (id: string, db: Db | Tx = initDb()) =>
  db.select().from(workspacesInvitations).where(eq(workspacesInvitations.id, id)).get()

/** Invites an email as a member for 7 days; an earlier pending invitation of that email to this workspace is cancelled. */
export function createWorkspaceInvitation(input: { workspaceId: string; email: string; inviterId: string }, db: Db | Tx = initDb()) {
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : ''
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw domainError('invalid', 'A valid email is required')
  const now = new Date()
  const row = { id: createId(), workspaceId: input.workspaceId, email, role: 'member', status: 'pending', inviterId: input.inviterId, expiresAt: new Date(now.getTime() + INVITATION_EXPIRES_MS), createdAt: now }
  db.transaction((tx) => {
    tx.update(workspacesInvitations)
      .set({ status: 'canceled' })
      .where(and(eq(workspacesInvitations.workspaceId, input.workspaceId), eq(sql`lower(${workspacesInvitations.email})`, email), eq(workspacesInvitations.status, 'pending')))
      .run()
    tx.insert(workspacesInvitations).values(row).run()
  })
  return row
}

/** Cancels a pending invitation (the plugin keeps the row, as 'canceled'). */
export function updateInvitationCanceled(id: string, db: Db | Tx = initDb()): void {
  const changed = db
    .update(workspacesInvitations)
    .set({ status: 'canceled' })
    .where(and(eq(workspacesInvitations.id, id), eq(workspacesInvitations.status, 'pending')))
    .returning({ id: workspacesInvitations.id })
    .all()
  if (!changed.length) throw domainError('not_found', 'That invitation is not pending')
}

/** Throws unless another owner would remain; call inside the transaction that changes the owner. */
function assertAnotherOwner(tx: Tx, workspaceId: string, userId: string): void {
  const other = tx
    .select({ id: workspacesMembers.id })
    .from(workspacesMembers)
    .where(and(eq(workspacesMembers.workspaceId, workspaceId), eq(workspacesMembers.role, 'owner'), ne(workspacesMembers.userId, userId)))
    .get()
  if (!other) throw domainError('conflict', 'A workspace needs at least one owner')
}

/** Takes a member out (a removal or a leave). The last owner cannot go; the invitations they sent are cancelled. */
export function deleteWorkspaceMember(workspaceId: string, userId: string, db: Db | Tx = initDb()): void {
  db.transaction((tx) => {
    const role = getMemberRole(workspaceId, userId, tx)
    if (!role) throw domainError('not_found', 'That user is not a member of this workspace')
    if (role === 'owner') assertAnotherOwner(tx, workspaceId, userId)
    tx.delete(workspacesMembers).where(and(eq(workspacesMembers.workspaceId, workspaceId), eq(workspacesMembers.userId, userId))).run()
    tx.update(workspacesInvitations)
      .set({ status: 'canceled' })
      .where(and(eq(workspacesInvitations.workspaceId, workspaceId), eq(workspacesInvitations.inviterId, userId), eq(workspacesInvitations.status, 'pending')))
      .run()
  })
}

export function updateWorkspaceMemberRole(workspaceId: string, userId: string, role: string, db: Db | Tx = initDb()): void {
  if (!ROLES.includes(role)) throw domainError('invalid', 'Roles are owner and member')
  db.transaction((tx) => {
    const current = getMemberRole(workspaceId, userId, tx)
    if (!current) throw domainError('not_found', 'That user is not a member of this workspace')
    if (current === 'owner' && role !== 'owner') assertAnotherOwner(tx, workspaceId, userId)
    tx.update(workspacesMembers).set({ role }).where(and(eq(workspacesMembers.workspaceId, workspaceId), eq(workspacesMembers.userId, userId))).run()
  })
}
