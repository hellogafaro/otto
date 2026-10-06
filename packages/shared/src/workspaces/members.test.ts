import { eq } from 'drizzle-orm'
import { expect, test } from 'bun:test'
import { openDb } from '../db/index.ts'
import { pushSchema } from '../db/push.ts'
import {
  createWorkspaceInvitation,
  createWorkspaceMember,
  deleteWorkspaceMember,
  getMemberRole,
  getMemberWorkspaceIds,
  getWorkspaceInvitation,
  getWorkspaceInvitations,
  getWorkspaceMembers,
  hasPendingInvitation,
  isWorkspaceMember,
  updateInvitationCanceled,
  updateWorkspaceMemberRole,
  updateWorkspaceMirror,
} from './members.ts'
import { workspacesInvitations } from './schema.ts'

const WS = 'workspace0001'
const OTHER = 'workspace0002'

async function setup() {
  const db = openDb(':memory:')
  await pushSchema(db)
  updateWorkspaceMirror([{ id: WS, title: 'Main' }, { id: OTHER, title: 'Side' }], db)
  createWorkspaceMember(WS, 'owner0000001', 'owner', db)
  createWorkspaceMember(WS, 'member000001', 'member', db)
  createWorkspaceMember(OTHER, 'member000001', 'owner', db)
  return db
}

const code = (fn: () => unknown) => {
  try {
    fn()
  } catch (error) {
    return (error as { code?: string }).code
  }
}

test('membership is per workspace', async () => {
  const db = await setup()
  expect(isWorkspaceMember(WS, 'owner0000001', db)).toBe(true)
  expect(isWorkspaceMember(OTHER, 'owner0000001', db)).toBe(false)
  expect(getMemberRole(WS, 'member000001', db)).toBe('member')
  expect(getMemberRole(OTHER, 'member000001', db)).toBe('owner')
  expect(getMemberWorkspaceIds('member000001', db).sort()).toEqual([WS, OTHER])
  expect(getWorkspaceMembers(WS, db).map((m) => [m.userId, m.role])).toEqual([['owner0000001', 'owner'], ['member000001', 'member']])
})

test('an invitation is bound to a lowercase email, lasts 7 days, and counts only while pending', async () => {
  const db = await setup()
  const invitation = createWorkspaceInvitation({ workspaceId: WS, email: ' Friend@Example.COM ', inviterId: 'owner0000001' }, db)
  expect(invitation).toMatchObject({ email: 'friend@example.com', role: 'member', status: 'pending', workspaceId: WS })
  expect(invitation.id).toMatch(/^[0-9a-z]{12}$/)
  const days = (invitation.expiresAt.getTime() - invitation.createdAt.getTime()) / 86_400_000
  expect(days).toBe(7)
  expect(hasPendingInvitation('FRIEND@example.com', db)).toBe(true)
  expect(hasPendingInvitation('other@example.com', db)).toBe(false)
  expect(getWorkspaceInvitations(WS, db).map((i) => i.id)).toEqual([invitation.id])
  expect(getWorkspaceInvitations(OTHER, db)).toEqual([])

  // Expired: not listed, does not open sign-up.
  db.update(workspacesInvitations).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(workspacesInvitations.id, invitation.id)).run()
  expect(getWorkspaceInvitations(WS, db)).toEqual([])
  expect(hasPendingInvitation('friend@example.com', db)).toBe(false)

  for (const email of ['', 'nobody', 'a@', '@b.c', 'two words@x.y', undefined as never]) {
    expect(code(() => createWorkspaceInvitation({ workspaceId: WS, email, inviterId: 'owner0000001' }, db))).toBe('invalid')
  }
})

test('inviting again cancels the earlier invitation; revoking keeps the row as canceled', async () => {
  const db = await setup()
  const first = createWorkspaceInvitation({ workspaceId: WS, email: 'a@example.com', inviterId: 'owner0000001' }, db)
  const second = createWorkspaceInvitation({ workspaceId: WS, email: 'A@example.com', inviterId: 'owner0000001' }, db)
  expect(getWorkspaceInvitation(first.id, db)?.status).toBe('canceled')
  expect(getWorkspaceInvitations(WS, db).map((i) => i.id)).toEqual([second.id])
  updateInvitationCanceled(second.id, db)
  expect(getWorkspaceInvitation(second.id, db)?.status).toBe('canceled')
  expect(hasPendingInvitation('a@example.com', db)).toBe(false)
  expect(code(() => updateInvitationCanceled(second.id, db))).toBe('not_found')
  expect(code(() => updateInvitationCanceled('missing00000', db))).toBe('not_found')
})

test('the last owner cannot leave, be removed or be demoted; with a second owner they can', async () => {
  const db = await setup()
  expect(code(() => deleteWorkspaceMember(WS, 'owner0000001', db))).toBe('conflict')
  expect(code(() => updateWorkspaceMemberRole(WS, 'owner0000001', 'member', db))).toBe('conflict')
  expect(getMemberRole(WS, 'owner0000001', db)).toBe('owner')

  expect(code(() => updateWorkspaceMemberRole(WS, 'member000001', 'admin', db))).toBe('invalid')
  updateWorkspaceMemberRole(WS, 'member000001', 'owner', db)
  updateWorkspaceMemberRole(WS, 'owner0000001', 'member', db)
  expect(getMemberRole(WS, 'owner0000001', db)).toBe('member')
  expect(code(() => deleteWorkspaceMember(WS, 'member000001', db))).toBe('conflict')
  deleteWorkspaceMember(WS, 'owner0000001', db)
  expect(isWorkspaceMember(WS, 'owner0000001', db)).toBe(false)
  expect(code(() => deleteWorkspaceMember(WS, 'owner0000001', db))).toBe('not_found')
  expect(code(() => updateWorkspaceMemberRole(WS, 'owner0000001', 'member', db))).toBe('not_found')
})

test('removing a member cancels the invitations they sent, and only those', async () => {
  const db = await setup()
  const second = 'owner0000002'
  createWorkspaceMember(WS, second, 'owner', db)
  const sent = createWorkspaceInvitation({ workspaceId: WS, email: 'a@example.com', inviterId: second }, db)
  const kept = createWorkspaceInvitation({ workspaceId: WS, email: 'b@example.com', inviterId: 'owner0000001' }, db)
  const elsewhere = createWorkspaceInvitation({ workspaceId: OTHER, email: 'c@example.com', inviterId: second }, db)
  deleteWorkspaceMember(WS, second, db)
  expect(getWorkspaceInvitation(sent.id, db)?.status).toBe('canceled')
  expect(getWorkspaceInvitation(kept.id, db)?.status).toBe('pending')
  expect(getWorkspaceInvitation(elsewhere.id, db)?.status).toBe('pending')
})

test('a failed removal changes nothing (one transaction)', async () => {
  const db = await setup()
  const invitation = createWorkspaceInvitation({ workspaceId: WS, email: 'a@example.com', inviterId: 'owner0000001' }, db)
  expect(code(() => deleteWorkspaceMember(WS, 'owner0000001', db))).toBe('conflict')
  expect(getWorkspaceInvitation(invitation.id, db)?.status).toBe('pending')
})
