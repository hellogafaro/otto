/**
 * The pure rules behind Settings -> Members: the order of the list, what the viewer may do on a row, the
 * last-owner rule (the server enforces it too, `conflict`) and the invitation's expiry in days.
 */

import type { WorkspaceMember } from '../../../shared/types'

const DAY = 24 * 60 * 60 * 1000

/** Owners first, then by name (case-insensitive), then email. */
export function sortMembers(rows: readonly WorkspaceMember[]): WorkspaceMember[] {
  return [...rows].sort(
    (a, b) =>
      Number(b.role === 'owner') - Number(a.role === 'owner') ||
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) ||
      a.email.localeCompare(b.email),
  )
}

/** True when this member is the workspace's only owner: they cannot leave, be removed or become a member. */
export function isLastOwner(rows: readonly WorkspaceMember[], userId: string): boolean {
  const owners = rows.filter((row) => row.role === 'owner')
  return owners.length === 1 && owners[0]!.userId === userId
}

/**
 * What the viewer sees on a row: owners change roles (a menu) and remove others; everyone sees a plain role
 * badge otherwise; everyone can leave from their own row.
 */
export function memberRowActions(rows: readonly WorkspaceMember[], row: WorkspaceMember) {
  const owner = rows.some((r) => r.me && r.role === 'owner')
  return { editRole: owner, remove: owner && !row.me, leave: !!row.me }
}

/** Whole days until an invitation expires, at least 1 while it is pending ("Expires in 6 days"). */
export function expiresInDays(expiresAt: number, now: number): number {
  return Math.max(1, Math.ceil((expiresAt - now) / DAY))
}
