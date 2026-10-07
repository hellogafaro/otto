import { afterEach, expect, test } from 'bun:test'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { openDb } from '../packages/shared/src/db/index.ts'
import { pushSchema } from '../packages/shared/src/db/push.ts'
import { createSecretsStore } from '../packages/shared/src/secrets/index.ts'
import { convertLegacyCopy, convertLegacyIds } from './db-uuid.ts'
import { toDmKey } from '../packages/shared/src/sessions/members.ts'
import {
  toPortablePath,
  expandPath,
} from '../packages/shared/src/utils/paths.ts'
import { spyOn } from 'bun:test'
import { hashPassword } from 'better-auth/crypto'
import { createUsersStore } from '../packages/shared/src/users/index.ts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true })
})
const key = Buffer.alloc(32, 7)
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
async function fixture() {
  const root = mkdtempSync(join(process.env.HOME!, '.capy/work/otto-uuid-'))
  roots.push(root)
  const source = join(root, 'source')
  mkdirSync(source)
  const workspace = join(source, 'workspaces', 'workspace001')
  mkdirSync(join(workspace, 'library'), { recursive: true })
  mkdirSync(join(workspace, 'sessions', 'chat00000001'), { recursive: true })
  writeFileSync(
    join(source, 'config.json'),
    JSON.stringify({
      workspaces: [
        {
          id: 'workspace001',
          name: 'Fixture',
          rootPath: toPortablePath(workspace),
        },
      ],
    }),
  )
  const app = openDb(join(source, 'otto.db'))
  await pushSchema(app)
  const db = app.$client
  db.exec(
    "INSERT INTO users(id,name,email,created_at,updated_at) VALUES('user00000001','Fixture','fixture@example.test',0,0)",
  )
  db.exec(
    "INSERT INTO users(id,name,email,created_at,updated_at) VALUES('user00000002','Other','other@example.test',0,0)",
  )
  db.exec(
    "INSERT INTO users_accounts(id,user_id,account_id,provider_id,password,created_at,updated_at) VALUES('account00001','user00000001','user00000001','credential','fixture-password-hash',0,0),('account00002','user00000001','external-provider-account','google',NULL,0,0)",
  )
  db.query(
    "UPDATE users_accounts SET password=? WHERE provider_id='credential'",
  ).run(await hashPassword('controlled-fixture-password'))
  db.exec(
    "INSERT INTO workspaces(id,title,slug,created_at) VALUES('workspace001','Fixture','fixture',0)",
  )
  db.exec(
    "INSERT INTO workspaces_members(id,workspace_id,user_id,role,created_at) VALUES('member000001','workspace001','user00000001','owner',0)",
  )
  db.exec(
    "INSERT INTO projects(id,workspace_id,title,description,status,members,resources,created_at,updated_at) VALUES('project00001','workspace001','Launch','task:task00000001','active','[\"user:user00000001\"]','[]',0,0)",
  )
  db.exec(
    "INSERT INTO tasks(id,workspace_id,project_id,title,description,status,assignees,resources,created_by,created_at,updated_at) VALUES('task00000001','workspace001','project00001','Review','','todo','[\"user:user00000001\"]','[{\"type\":\"library\",\"ref\":\"document0001\",\"title\":\"Brief\"}]','user:user00000001',0,0)",
  )
  db.exec(
    "INSERT INTO library(id,workspace_id,type,title,mime,size,created_by,created_at,updated_at) VALUES('document0001','workspace001','document','Brief.md','text/markdown',5,'user:user00000001',0,0)",
  )
  db.exec(
    "INSERT INTO chats(id,workspace_id,created_by,dm_key,metadata,created_at,updated_at) VALUES('chat00000001','workspace001','user:user00000001','user:user00000001|user:user00000002','{\"agents\":{\"agent0000001\":{\"seen\":1}}}',0,0)",
  )
  db.exec(
    "INSERT INTO agents(id,workspace_id,title,instructions,provider,thinking_level,skills,sources,created_by,created_at,updated_at) VALUES('agent0000001','workspace001','Scout','','openai','medium','[]','[]','user:user00000001',0,0)",
  )
  db.exec(
    "INSERT INTO messages(workspace_id,chat_id,id,position,type,content,created_at) VALUES('workspace001','chat00000001','message00001',1,'user','{\"content\":\"user:user00000001 task:task00000001\",\"sender\":\"user:user00000001\"}',0)",
  )
  db.exec(
    "INSERT INTO chats_members(workspace_id,chat_id,actor,created_at) VALUES('workspace001','chat00000001','user:user00000001',0)",
  )
  db.exec(
    "INSERT INTO settings(entity,key,value) VALUES('user:user00000001','activeChatId','\"chat00000001\"')",
  )
  const store = createSecretsStore(app, key)
  const secret = store.createSecret('Fixture key', 'fixture-plain')
  store.rebindSecretId(secret, 'secret000001')
  db.exec(
    "INSERT INTO connections(id,scope,slug,type,auth_type,title,secret_id,created_at) VALUES('connect00001','user:user00000001','fixture','openai','api_key','Fixture','secret000001',0)",
  )
  writeFileSync(join(workspace, 'library', 'document0001'), 'task:task00000001')
  writeFileSync(
    join(workspace, 'sessions', 'chat00000001', 'context.json'),
    JSON.stringify({ document: 'library:document0001' }),
  )
  return { root, source, db, store }
}

test('offline UUID copy preserves source secret and converts linked rows files metadata and cipher AAD', async () => {
  const f = await fixture()
  const destination = join(f.root, 'converted')
  const before = f.store.getSecret('secret000001')
  const count = convertLegacyCopy(f.source, destination, key)
  expect(count).toBeGreaterThan(0)
  expect(f.store.getSecret('secret000001')).toBe(before)
  expect(
    f.db.query("SELECT id FROM users WHERE email='fixture@example.test'").get(),
  ).toEqual({ id: 'user00000001' })
  const db = new Database(join(destination, 'otto.db'))
  const user = (
    db
      .query("SELECT id FROM users WHERE email='fixture@example.test'")
      .get() as { id: string }
  ).id
  const workspace = (
    db.query('SELECT id FROM workspaces').get() as { id: string }
  ).id
  const project = (db.query('SELECT id FROM projects').get() as { id: string })
    .id
  const task = db.query('SELECT * FROM tasks').get() as any
  const document = (db.query('SELECT id FROM library').get() as { id: string })
    .id
  const chat = (db.query('SELECT id FROM chats').get() as { id: string }).id
  expect(
    [user, workspace, project, task.id, document, chat].every((id) =>
      uuid.test(id),
    ),
  ).toBe(true)
  expect(task.project_id).toBe(project)
  expect(task.workspace_id).toBe(workspace)
  expect(task.created_by).toBe('user:' + user)
  expect(JSON.parse(task.resources)[0].ref).toBe(document)
  const connection = db.query('SELECT * FROM connections').get() as any
  expect(connection.scope).toBe('user:' + user)
  expect(
    db
      .query(
        "SELECT user_id,account_id FROM users_accounts WHERE provider_id='credential'",
      )
      .get(),
  ).toEqual({ user_id: user, account_id: user })
  expect(
    db
      .query("SELECT account_id FROM users_accounts WHERE provider_id='google'")
      .get(),
  ).toEqual({ account_id: 'external-provider-account' })
  const auth = createUsersStore(drizzle(db), {
    secret: 'x'.repeat(40),
    baseURL: 'http://fixture.local',
    getWorkspaces: () => [],
  }).auth
  const signed = await auth.api.signInEmail({
    body: {
      email: 'fixture@example.test',
      password: 'controlled-fixture-password',
    },
  })
  expect(signed.user.id).toBe(user)
  expect(
    createSecretsStore(drizzle(db), key).getSecret(connection.secret_id),
  ).toBe(before)
  const convertedRoot = join(destination, 'workspaces', workspace)
  expect(readFileSync(join(convertedRoot, 'library', document), 'utf8')).toBe(
    'task:' + task.id,
  )
  expect(
    readFileSync(join(convertedRoot, 'sessions', chat, 'context.json'), 'utf8'),
  ).toContain(document)
  expect(
    JSON.stringify(db.query('SELECT content FROM messages').all()),
  ).toContain(user)
  expect(
    JSON.stringify(db.query('SELECT metadata FROM chats').all()),
  ).not.toContain('agent0000001')
  expect(db.query('SELECT entity FROM settings').get()).toEqual({
    entity: 'user:' + user,
  })
  const config = JSON.parse(
    readFileSync(join(destination, 'config.json'), 'utf8'),
  )
  expect(expandPath(config.workspaces[0].rootPath)).toBe(convertedRoot)
  expect(convertLegacyIds(db, key).size).toBe(0)
  expect(() => convertLegacyCopy(f.source, destination, key)).toThrow(
    'Destination must be new',
  )
  db.close()
  f.db.close()
})

test('wrong key rolls back every fixture row and leaves no published copy', async () => {
  const f = await fixture()
  const destination = join(f.root, 'wrong-key')
  expect(() => convertLegacyIds(f.db, Buffer.alloc(32, 9))).toThrow()
  expect(
    f.db.query("SELECT id FROM users WHERE email='fixture@example.test'").get(),
  ).toEqual({ id: 'user00000001' })
  expect(f.store.getSecret('secret000001')).toBe('fixture-plain')
  expect(() =>
    convertLegacyCopy(f.source, destination, Buffer.alloc(32, 9)),
  ).toThrow()
  expect(existsSync(destination)).toBe(false)
  expect(f.store.getSecret('secret000001')).toBe('fixture-plain')
  f.db.close()
})

test('conversion re-sorts a DM whose generated IDs reverse old lexical ordering', async () => {
  const f = await fixture()
  const original = crypto.randomUUID.bind(crypto)
  const forced = [
    'ffffffff-ffff-4fff-bfff-ffffffffffff',
    '00000000-0000-4000-8000-000000000000',
  ]
  const mocked = spyOn(crypto, 'randomUUID').mockImplementation(
    () =>
      (forced.shift() as ReturnType<typeof crypto.randomUUID>) ?? original(),
  )
  const map = convertLegacyIds(f.db, key)
  mocked.mockRestore()
  expect(map.get('user00000001')! > map.get('user00000002')!).toBe(true)
  expect(f.db.query('SELECT dm_key FROM chats').get()).toEqual({
    dm_key: toDmKey(
      'user:' + map.get('user00000001'),
      'user:' + map.get('user00000002'),
    ),
  })
  f.db.close()
})

test('workflow-only vendor state refuses conversion and publishes no copy', async () => {
  const f = await fixture()
  f.db.exec(
    "CREATE TABLE mastra_workflow_snapshot(run_id TEXT,snapshot TEXT); INSERT INTO mastra_workflow_snapshot VALUES('run','{}')",
  )
  const destination = join(f.root, 'native-state')
  expect(() => convertLegacyCopy(f.source, destination, key)).toThrow(
    'Populated native',
  )
  expect(existsSync(destination)).toBe(false)
  expect(f.store.getSecret('secret000001')).toBe('fixture-plain')
  f.db.close()
})
