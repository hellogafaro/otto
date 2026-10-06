import { describe, expect, it } from 'bun:test'
import type { WorkspaceMember } from '../../../shared/types'
import { expiresInDays, isLastOwner, memberRowActions, sortMembers } from '../settings/members-rules'

const row = (userId: string, name: string, role: 'owner' | 'member', me?: true): WorkspaceMember => ({
  actor: `user:${userId}`,
  userId,
  name,
  email: `${userId}@example.com`,
  role,
  ...(me && { me }),
})

describe('sortMembers', () => {
  it('puts owners first, then sorts by name ignoring case, then email', () => {
    const rows = [row('c', 'carol', 'member'), row('b', 'Bob', 'owner'), row('a', 'Alice', 'member'), row('d', 'Bob', 'member'), row('e', 'alice', 'member')]
    expect(sortMembers(rows).map((r) => r.userId)).toEqual(['b', 'a', 'e', 'd', 'c'])
    expect(rows[0]!.userId).toBe('c')
  })
})

describe('isLastOwner', () => {
  it('is true only for the one owner', () => {
    const rows = [row('o', 'Owner', 'owner'), row('m', 'Member', 'member')]
    expect(isLastOwner(rows, 'o')).toBe(true)
    expect(isLastOwner(rows, 'm')).toBe(false)
  })

  it('is false while another owner exists', () => {
    expect(isLastOwner([row('o', 'Owner', 'owner'), row('p', 'Other', 'owner')], 'o')).toBe(false)
  })
})

describe('memberRowActions', () => {
  it('lets an owner change roles, remove others and leave from their own row', () => {
    const rows = [row('o', 'Owner', 'owner', true), row('m', 'Member', 'member')]
    expect(memberRowActions(rows, rows[0]!)).toEqual({ editRole: true, remove: false, leave: true })
    expect(memberRowActions(rows, rows[1]!)).toEqual({ editRole: true, remove: true, leave: false })
  })

  it('gives a member plain roles, nothing on others and Leave on their own row', () => {
    const rows = [row('o', 'Owner', 'owner'), row('m', 'Member', 'member', true)]
    expect(memberRowActions(rows, rows[0]!)).toEqual({ editRole: false, remove: false, leave: false })
    expect(memberRowActions(rows, rows[1]!)).toEqual({ editRole: false, remove: false, leave: true })
  })
})

describe('expiresInDays', () => {
  const day = 24 * 60 * 60 * 1000
  it('rounds up to whole days and never says 0 while pending', () => {
    expect(expiresInDays(7 * day, 0)).toBe(7)
    expect(expiresInDays(6 * day + 1, 0)).toBe(7)
    expect(expiresInDays(6 * day, 0)).toBe(6)
    expect(expiresInDays(60_000, 0)).toBe(1)
    expect(expiresInDays(0, 60_000)).toBe(1)
  })
})
