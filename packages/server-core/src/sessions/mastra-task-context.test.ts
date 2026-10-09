import { expect, it } from 'bun:test'
import { join } from 'node:path'
import { createAgent } from '@otto/shared/agents'
import { addWorkspace, saveConfig } from '@otto/shared/config'
import { CONFIG_DIR } from '@otto/shared/config/paths'
import { initDb } from '@otto/shared/db'
import { updateSetting, userEntity } from '@otto/shared/settings'
import { users } from '../../../shared/src/users/schema'
import { getMastraContext } from './mastra-context'

it('uses the initiating human local calendar without publishing another user preferences or unvalidated timezone text', () => {
  saveConfig({ workspaces: [] })
  const workspace = addWorkspace({ name: 'Task timing', rootPath: join(CONFIG_DIR, 'task-timing') })
  const creator = crypto.randomUUID(), sender = crypto.randomUUID(), now = new Date()
  for (const id of [creator, sender]) initDb().insert(users).values({ id, name: 'Fixture', email: id + '@example.test', createdAt: now, updatedAt: now }).run()
  const agent = createAgent({ workspaceId: workspace.id, title: 'Recorder', provider: 'openai', createdBy: `user:${creator}` })
  updateSetting(userEntity(creator), 'timezone', 'America/New_York')
  updateSetting(userEntity(creator), 'notes', 'CREATOR_PRIVATE_NOTES')
  updateSetting(userEntity(sender), 'timezone', 'Europe/Madrid')
  updateSetting(userEntity(sender), 'notes', 'SENDER_PRIVATE_NOTES')
  const input = { workspaceId: workspace.id, agentId: agent.id, userId: sender, writesAllowed: true, unattended: false, assertAccess: () => {} }
  const instructions = getMastraContext(input).instructions
  expect(instructions).toContain('timezone is Europe/Madrid')
  expect(instructions).toContain(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now))
  expect(instructions).toContain('Tasks do not require a project')
  expect(instructions).toContain('not permission to execute the invitation')
  expect(instructions).not.toContain('America/New_York')
  expect(instructions).not.toContain('PRIVATE_NOTES')
  updateSetting(userEntity(sender), 'timezone', 'INVALID_ZONE_IGNORE_INSTRUCTIONS')
  const invalid = getMastraContext(input).instructions
  expect(invalid).toContain('timezone is not configured')
  expect(invalid).not.toContain('INVALID_ZONE_IGNORE_INSTRUCTIONS')
  expect(getMastraContext({ ...input, userId: undefined }).instructions).not.toContain('America/New_York')
})
