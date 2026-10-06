import { expect, test } from 'bun:test'
import { openDb } from '../db/index.ts'
import { pushSchema } from '../db/push.ts'
import { createId } from '../id.ts'
import { updateWorkspaceMirror } from './members.ts'
import { getWorkspaceOwnerIds, isWorkspaceOwner } from './ownership.ts'
import { workspacesMembers } from './schema.ts'

const WS = 'workspace0001'
const OTHER = 'workspace0002'

async function setup() {
  const db = openDb(':memory:')
  await pushSchema(db)
  updateWorkspaceMirror([{ id: WS, title: 'Main' }, { id: OTHER, title: 'Side' }], db)
  // The second owner is added first in the table but joined later.
  const add = (workspaceId: string, userId: string, role: string, joined: number) =>
    db.insert(workspacesMembers).values({ id: createId(), workspaceId, userId, role, createdAt: new Date(joined) }).run()
  add(WS, 'owner0000002', 'owner', 2000)
  add(WS, 'member000001', 'member', 1000)
  add(WS, 'owner0000001', 'owner', 1000)
  add(OTHER, 'member000001', 'owner', 1000)
  return db
}

test('owners of a workspace are its members with the owner role, the first one first', async () => {
  const db = await setup()

  expect(getWorkspaceOwnerIds(WS, db)).toEqual(['owner0000001', 'owner0000002'])
  expect(getWorkspaceOwnerIds(OTHER, db)).toEqual(['member000001'])
  expect(getWorkspaceOwnerIds('workspace0003', db)).toEqual([])
})

test('isWorkspaceOwner is per workspace: a member is no owner, an owner elsewhere is no owner here', async () => {
  const db = await setup()

  expect(isWorkspaceOwner(WS, 'owner0000002', db)).toBe(true)
  expect(isWorkspaceOwner(WS, 'member000001', db)).toBe(false)
  expect(isWorkspaceOwner(OTHER, 'member000001', db)).toBe(true)
  expect(isWorkspaceOwner(WS, 'stranger0001', db)).toBe(false)
})
