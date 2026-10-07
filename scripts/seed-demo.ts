#!/usr/bin/env bun
// Demo data for looking at the UI at scale. Everything goes through the domain functions (the few raw drizzle
// statements are marked: a domain with no writer for it). Deterministic content (seeded PRNG), random ids.
//
//   bun run scripts/seed-demo.ts [--config-dir <dir>] [--workspace <slug>] [--scale small|medium|large] [--clear] [--yes]
//
// The default target is the real dev config dir (`~/.otto`), so it refuses to run when OTTO_CONFIG_DIR is unset unless
// `--yes` is given. It always copies otto.db (+wal/shm) to `<config>/backups-seed-<time>/` first and prints the path.
//
// What it made is listed in `<config>/demo-seed.json` (ids by kind, no secrets): the least invasive marker, since the
// domains have no spare tag column. A run clears what that file lists, then makes everything again, so it is rerunnable;
// `--clear` only clears. Demo users have an `@demo.otto.test` email and share one password in `<config>/demo-users.txt` (0600).
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { DAY, LABELS, SCALES, STATUSES, agentSpec, answer, ascii, chatMessages, chatTitle, commentText, createRng, docTitle, documentText, dueAt, folderSpec, personName, pdfDocument, pngImage, projectDescription, projectTitle, randomColor, routineSpec, skillFiles, sourceSpec, stamp, taskDescription, taskTitle, textFile, CHAT_MODELS, type Attachment } from './seed-demo-content.ts'

const SEED = 20261007
const DEMO_EMAIL = '@demo.otto.test'

// ---------------------------------------------------------------------------------------------- arguments

const argv = process.argv.slice(2)
const flag = (name: string) => argv.includes(`--${name}`)
const value = (name: string) => { const at = argv.indexOf(`--${name}`); return at >= 0 ? argv[at + 1] : undefined }
const fail = (message: string): never => { console.error(message); process.exit(1) }
const KNOWN = ['--config-dir', '--workspace', '--scale', '--clear', '--yes', '--help']
if (flag('help') || argv.some((a) => a.startsWith('--') && !KNOWN.includes(a))) fail('usage: bun run scripts/seed-demo.ts [--config-dir <dir>] [--workspace <slug>] [--scale small|medium|large] [--clear] [--yes]')
const scale = SCALES[value('scale') ?? 'medium'] ?? fail(`--scale is one of ${Object.keys(SCALES).join(', ')}`)
if (value('config-dir')) process.env.OTTO_CONFIG_DIR = resolve(value('config-dir')!)
else if (!process.env.OTTO_CONFIG_DIR?.trim() && !flag('yes')) fail(`OTTO_CONFIG_DIR is not set, so this would write to ${join(homedir(), '.otto')} (the real dev data). Pass --yes to do that, or --config-dir <dir>.`)
// Sign-up only hashes the password here; the secret signs nothing that outlives this process.
process.env.BETTER_AUTH_SECRET ||= randomBytes(32).toString('hex')
process.env.BETTER_AUTH_URL ||= 'http://localhost' // only to keep Better Auth from warning

// The shared modules read OTTO_CONFIG_DIR when they load, so they come after the environment is set.
const S = '../packages/shared/src'
const { CONFIG_DIR } = await import(`${S}/config/paths.ts`)
const { initDb, DB_PATH } = await import(`${S}/db/index.ts`)

// ---------------------------------------------------------------------------------------------- backup

const backupDir = join(CONFIG_DIR, `backups-seed-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}`)
const freshInstall = !existsSync(DB_PATH)
mkdirSync(CONFIG_DIR, { recursive: true })
if (freshInstall) console.log('No database yet: nothing to back up.')
else {
  mkdirSync(backupDir, { recursive: true })
  for (const suffix of ['', '-wal', '-shm']) if (existsSync(DB_PATH + suffix)) copyFileSync(DB_PATH + suffix, join(backupDir, `otto.db${suffix}`))
  console.log(`Backup of the database: ${backupDir}`)
}

// ---------------------------------------------------------------------------------------------- setup

const { eq, inArray, like } = await import('drizzle-orm')
const db = initDb()
if (freshInstall) await (await import(`${S}/db/push.ts`)).pushSchema(db)

const config = await import(`${S}/config/storage.ts`)
if (!config.loadStoredConfig()) config.saveConfig({ workspaces: [], activeWorkspaceId: null, activeSessionId: null, setupDeferred: true })
if (!config.getWorkspaces().length) config.addWorkspace({ name: 'Demo', rootPath: join(CONFIG_DIR, 'workspaces', 'demo') })

const MANIFEST = join(CONFIG_DIR, 'demo-seed.json')
interface Manifest {
  workspaceId: string; rootPath: string
  users: string[]; agents: string[]; labels: string[]; statuses: string[]; library: string[]; projects: string[]; tasks: string[]
  comments: { id: string; by: string }[]; routines: string[]; chats: string[]; skills: string[]; sources: string[]
}
const emptyManifest = (workspaceId: string, rootPath: string): Manifest => ({ workspaceId, rootPath, users: [], agents: [], labels: [], statuses: [], library: [], projects: [], tasks: [], comments: [], routines: [], chats: [], skills: [], sources: [] })

const users = await import(`${S}/users/index.ts`)
const { getFirstUser } = await import(`${S}/users/queries.ts`)
const members = await import(`${S}/workspaces/members.ts`)
const agentsApi = await import(`${S}/agents/index.ts`)
const labelsCrud = await import(`${S}/labels/crud.ts`)
const labelEntities = await import(`${S}/labels/entities.ts`)
const statusesCrud = await import(`${S}/statuses/crud.ts`)
const statusesStore = await import(`${S}/statuses/storage.ts`)
const library = await import(`${S}/library/index.ts`)
const projectsApi = await import(`${S}/projects/index.ts`)
const tasksApi = await import(`${S}/tasks/index.ts`)
const commentsApi = await import(`${S}/comments/index.ts`)
const notificationsApi = await import(`${S}/notifications/index.ts`)
const sessions = await import(`${S}/sessions/index.ts`)
const routinesApi = await import(`${S}/automations/routines.ts`)
const routineWebhook = await import(`${S}/automations/routine-webhook.ts`)
const skillsApi = await import(`${S}/skills/index.ts`)
const sourcesApi = await import(`${S}/sources/index.ts`)
const sourcesStorage = await import(`${S}/sources/storage.ts`)
const tables = {
  projects: (await import(`${S}/projects/schema.ts`)).projects,
  tasks: (await import(`${S}/tasks/schema.ts`)).tasks,
  comments: (await import(`${S}/comments/schema.ts`)).comments,
  library: (await import(`${S}/library/schema.ts`)).library,
  notifications: (await import(`${S}/notifications/schema.ts`)).notifications,
  history: (await import(`${S}/automations/schema.ts`)).routinesHistory,
  users: (await import(`${S}/users/schema.ts`)).users,
  accounts: (await import(`${S}/users/schema.ts`)).usersAccounts,
  sessions: (await import(`${S}/users/schema.ts`)).usersSessions,
  invitations: (await import(`${S}/workspaces/schema.ts`)).workspacesInvitations,
  members: (await import(`${S}/workspaces/schema.ts`)).workspacesMembers,
}

users.initFirstOwner() // the workspaces mirror and, once a user exists, the owner's membership
const hasSecrets = !!process.env.ENCRYPTION_KEY?.trim()

const loadManifest = (): Manifest | null => (existsSync(MANIFEST) ? (JSON.parse(readFileSync(MANIFEST, 'utf8')) as Manifest) : null)
const saveManifest = (m: Manifest) => writeFileSync(MANIFEST, JSON.stringify(m, null, 1))

// ---------------------------------------------------------------------------------------------- clear

/** Removes exactly what the manifest lists, children before parents. Anything already gone is skipped. */
async function clear(m: Manifest) {
  const ws = { id: m.workspaceId, rootPath: m.rootPath }
  const skipped = (run: () => unknown) => { try { return run() } catch { /* already gone */ } }
  const skippedAsync = async (run: () => Promise<unknown>) => { try { await run() } catch { /* already gone */ } }
  for (const id of m.chats) skipped(() => sessions.deleteSession(ws, id))
  for (const id of m.routines) skipped(() => {
    const secretId = routinesApi.getRoutine(ws.id, id)?.config.webhook?.secretId
    routinesApi.deleteRoutine(ws.id, id)
    routineWebhook.dropWebhookSecret(secretId)
  })
  for (const slug of m.sources) await skippedAsync(() => sourcesApi.deleteSource(ws.id, slug))
  for (const slug of m.skills) await skippedAsync(() => skillsApi.deleteSkill(ws.id, slug))
  for (const { id, by } of m.comments) skipped(() => commentsApi.deleteComment(ws.id, id, by))
  for (const id of m.tasks) skipped(() => { notificationsApi.deleteEntityNotifications(`task:${id}`); labelEntities.removeEntityLabels(ws.id, `task:${id}`) })
  for (const id of m.projects) skipped(() => { notificationsApi.deleteEntityNotifications(`project:${id}`); labelEntities.removeEntityLabels(ws.id, `project:${id}`) })
  // No writer deletes a task or a project (they only change status): the one place a row is removed with drizzle.
  if (m.tasks.length) db.delete(tables.tasks).where(inArray(tables.tasks.id, m.tasks)).run()
  if (m.projects.length) db.delete(tables.projects).where(inArray(tables.projects.id, m.projects)).run()
  for (const id of [...m.library].reverse()) await skippedAsync(async () => { labelEntities.removeEntityLabels(ws.id, `library:${id}`); await library.deleteLibraryItem(ws.id, id) })
  for (const id of m.agents) skipped(() => agentsApi.deleteAgent(ws.id, id))
  for (const slug of m.labels) skipped(() => labelsCrud.deleteLabel(ws.id, slug))
  for (const slug of m.statuses) skipped(() => statusesCrud.deleteStatus(ws.id, slug))
  if (m.users.length) {
    // No writer deletes a user, their sign-in rows, their membership (the last owner may not leave) or the invitations that let them sign up.
    db.delete(tables.members).where(inArray(tables.members.userId, m.users)).run()
    db.delete(tables.sessions).where(inArray(tables.sessions.userId, m.users)).run()
    db.delete(tables.accounts).where(inArray(tables.accounts.userId, m.users)).run()
    db.delete(tables.users).where(inArray(tables.users.id, m.users)).run()
  }
  db.delete(tables.invitations).where(like(tables.invitations.email, `%${DEMO_EMAIL}`)).run()
  rmSync(MANIFEST, { force: true })
  rmSync(join(CONFIG_DIR, 'demo-users.txt'), { force: true })
}

const previous = loadManifest()
if (previous) {
  await clear(previous)
  console.log('Cleared the data of the previous run.')
}
if (flag('clear')) {
  console.log(previous ? 'Done: the demo data is removed. Reload the page.' : 'Nothing to clear (no demo-seed.json).')
  process.exit(0)
}

// ---------------------------------------------------------------------------------------------- target workspace

const wanted = value('workspace')
const workspace = wanted
  ? (config.getWorkspaces().find((w: { slug?: string; id: string; name: string }) => w.slug === wanted || w.id === wanted || w.name.toLowerCase() === wanted.toLowerCase()) ?? fail(`No workspace "${wanted}".`))
  : (config.getActiveWorkspace() ?? config.getWorkspaces()[0]!)
const ws: string = workspace.id
const wsRef = { id: ws, rootPath: workspace.rootPath as string }
const m = emptyManifest(ws, wsRef.rootPath)
const now = Date.now()
const r = createRng(SEED)
const t0 = performance.now()
const phase = (name: string, detail: string) => { saveManifest(m); console.log(`${name.padEnd(12)} ${detail}`) }

try {
  // ------------------------------------------------------------------------------------------ users
  const hadOwner = !!getFirstUser()
  const password = randomBytes(15).toString('base64url')
  const auth = users.initAuth()
  const demoUsers: { id: string; name: string; email: string }[] = []
  for (let i = 0; i < (hadOwner ? scale.users - 1 : scale.users); i++) {
    const name = personName(i)
    const email = `${ascii(name)}${DEMO_EMAIL}`
    const owner = getFirstUser()
    const invitation = owner ? members.createWorkspaceInvitation({ workspaceId: ws, email, inviterId: owner.id }) : undefined
    const image = i % 2 === 0 ? `data:image/png;base64,${Buffer.from(pngImage(64, 64, randomColor(r), randomColor(r))).toString('base64')}` : undefined
    const signed = await auth.api.signUpEmail({ body: { email, password, name, ...(image && { image }) } })
    m.users.push(signed.user.id)
    if (invitation) { members.createWorkspaceMember(ws, signed.user.id, 'member'); members.updateInvitationCanceled(invitation.id) }
    demoUsers.push({ id: signed.user.id, name, email })
  }
  // Sign-up opened a session for each; nobody needs those (no writer: drizzle).
  db.delete(tables.sessions).where(inArray(tables.sessions.userId, m.users)).run()
  const ownerId: string = getFirstUser()!.id
  const owner = `user:${ownerId}`
  const people = [owner, ...demoUsers.map((u) => `user:${u.id}`)]
  const lines = [`Password shared by every demo user (random for this run):`, password, '', ...demoUsers.map((u) => u.email)]
  writeFileSync(join(CONFIG_DIR, 'demo-users.txt'), lines.join('\n') + '\n', { mode: 0o600 })
  chmodSync(join(CONFIG_DIR, 'demo-users.txt'), 0o600)
  phase('users', `${demoUsers.length} demo users${hadOwner ? ' + the existing owner' : ' (the first is the owner)'}`)

  // ------------------------------------------------------------------------------------------ labels and statuses
  const labelSlug = new Map<string, { slug: string; valueType?: string }>()
  for (const spec of LABELS) {
    const created = labelsCrud.createLabel(ws, { name: spec.name, color: spec.color, valueType: spec.valueType, parentId: spec.parent ? labelSlug.get(spec.parent)!.slug : undefined })
    labelSlug.set(spec.name, { slug: created.id, valueType: spec.valueType })
    m.labels.push(created.id)
  }
  for (const spec of STATUSES) m.statuses.push(statusesCrud.createStatus(ws, spec).id)
  const labelList = [...labelSlug.values()]
  const pickLabels = (max: number): string[] => {
    const n = r.int(0, max)
    return r.shuffle(labelList).slice(0, n).map(({ slug, valueType }) => {
      if (valueType === 'number') return `${slug}::${r.pick([1, 2, 3, 5, 8, 13])}`
      if (valueType === 'string') return `${slug}::${r.pick(['S12', 'S13', '2027-Q1', 'Otoño'])}`
      if (valueType === 'date') return `${slug}::${stamp(now + r.int(-10, 30) * DAY)}`
      if (valueType === 'link') return `${slug}::https://example.com/spec/${r.int(100, 999)}`
      return slug
    })
  }
  phase('labels', `${m.labels.length} labels, ${m.statuses.length} statuses`)

  // ------------------------------------------------------------------------------------------ agents (avatars are library images)
  agentsApi.initAgentsSeed(ws, owner)
  const put = async (title: string, mime: string, bytes: Uint8Array, parentId: string | null, by: string, ago: number) => {
    const item = await library.createLibraryItem({ workspaceId: ws, title, mime, bytes, parentId, createdBy: by })
    m.library.push(item.id)
    const created = new Date(now - ago)
    db.update(tables.library).set({ createdAt: created, updatedAt: new Date(created.getTime() + r.int(0, Math.min(ago, 20 * DAY))) }).where(eq(tables.library.id, item.id)).run() // no writer: backdating
    return item
  }
  const agentIds: string[] = []
  const avatarCount = Array.from({ length: scale.agents }, (_, i) => i).filter((i) => i % 3 !== 2).length
  for (let i = 0; i < scale.agents; i++) {
    const spec = agentSpec(i)
    const avatar = i % 3 === 2 ? '' : `library:${(await put(`avatar-${ascii(spec.title) || i}.png`, 'image/png', pngImage(128, 128, randomColor(r), randomColor(r)), null, owner, r.int(5, 60) * DAY)).id}`
    const agent = agentsApi.createAgent({ workspaceId: ws, ...spec, avatar, createdBy: owner })
    agentIds.push(agent.id)
    m.agents.push(agent.id)
  }
  const agentActors = agentIds.map((id) => `agent:${id}`)
  phase('agents', `${agentIds.length} agents`)

  // ------------------------------------------------------------------------------------------ library
  const folders: string[] = []
  for (let i = 0; i < scale.folders; i++) {
    const spec = folderSpec(i)
    const folder = library.createLibraryFolder({ workspaceId: ws, title: spec.title, parentId: spec.parent === null ? null : folders[spec.parent]!, createdBy: owner })
    folders.push(folder.id)
    m.library.push(folder.id)
  }
  const attachments: Attachment[] = []
  const docIds: string[] = []
  const libraryItems: string[] = []
  for (let i = 0; i < scale.items - avatarCount; i++) {
    const folder = r.chance(0.35) ? null : r.pick(folders)
    const by = r.chance(0.7) ? r.pick(people) : r.pick(agentActors)
    const ago = r.int(1, 120) * DAY + r.int(0, DAY)
    const roll = i % 20
    let item
    if (roll < 8) {
      const title = docTitle(docIds.length)
      item = await put(title, 'text/markdown', new TextEncoder().encode(documentText(r, title.replace(/\.md$/, ''))), folder, by, ago)
      docIds.push(item.id)
    } else if (roll < 13) {
      const title = `${r.pick(['screenshot', 'mockup', 'foto', 'diagram', 'banner'])}-${i}.png`
      const bytes = pngImage(r.int(160, 800), r.int(120, 500), randomColor(r), randomColor(r))
      item = await put(title, 'image/png', bytes, folder, by, ago)
      attachments.push({ id: item.id, name: title, mimeType: 'image/png', size: bytes.length })
    } else if (roll < 15) {
      const title = `${r.pick(['invoice', 'contract', 'propuesta', 'report'])}-${1000 + i}.pdf`
      const bytes = pdfDocument(title)
      item = await put(title, 'application/pdf', bytes, folder, by, ago)
      attachments.push({ id: item.id, name: title, mimeType: 'application/pdf', size: bytes.length })
    } else {
      const file = textFile(r, i)
      item = await put(file.title, file.mime, new TextEncoder().encode(file.text), folder, by, ago)
    }
    libraryItems.push(item.id)
    if (r.chance(0.3)) labelEntities.setEntityLabels(ws, `library:${item.id}`, pickLabels(2))
  }
  phase('library', `${folders.length} folders, ${m.library.length - folders.length} items (${avatarCount} avatars)`)

  // ------------------------------------------------------------------------------------------ projects
  const projectIds: string[] = []
  for (let i = 0; i < scale.projects; i++) {
    const title = projectTitle(i)
    const resources = [
      ...(r.chance(0.7) ? [{ type: 'url' as const, title: r.pick(['Figma', 'Roadmap', 'Notion', 'Repo']), ref: `https://example.com/${ascii(title)}` }] : []),
      ...(docIds.length && r.chance(0.6) ? [{ type: 'library' as const, title: 'Brief', ref: r.pick(docIds) }] : []),
      ...(attachments.length && r.chance(0.4) ? [{ type: 'library' as const, title: 'Mockup', ref: r.pick(attachments).id }] : []),
    ]
    const project = projectsApi.createProject({ workspaceId: ws, title, description: projectDescription(r, title), resources, createdBy: r.chance(0.5) ? owner : r.pick(people) })
    for (const actor of r.shuffle([...people, ...agentActors]).slice(0, r.int(1, 6))) projectsApi.addProjectMember(ws, project.id, actor)
    if (r.chance(0.15)) projectsApi.setProjectStatus(ws, project.id, 'archived')
    if (r.chance(0.4)) labelEntities.setEntityLabels(ws, `project:${project.id}`, pickLabels(2))
    const created = now - r.int(20, 150) * DAY
    db.update(tables.projects).set({ createdAt: new Date(created), updatedAt: new Date(now - r.int(0, 40) * DAY - r.int(0, DAY)) }).where(eq(tables.projects.id, project.id)).run() // no writer: backdating
    projectIds.push(project.id)
    m.projects.push(project.id)
  }
  phase('projects', `${projectIds.length} projects`)

  // ------------------------------------------------------------------------------------------ tasks
  const taskCreated = new Map<string, number>()
  const counts: Record<string, number> = {}
  for (let i = 0; i < scale.tasks; i++) {
    const roll = r.next()
    const assignees = roll < 0.12 ? [] : roll < 0.45 ? [r.pick(people)] : roll < 0.7 ? [owner] : roll < 0.85 ? [r.pick(agentActors)] : r.shuffle([...people, ...agentActors]).slice(0, r.int(2, 4))
    const by = assignees.includes(owner) && r.chance(0.8) ? r.pick(people.filter((p) => p !== owner)) : r.chance(0.3) ? owner : r.pick(people)
    const task = tasksApi.createTask({
      workspaceId: ws, projectId: projectIds[Math.floor(r.next() ** 1.6 * projectIds.length)]!, title: taskTitle(r), description: taskDescription(r),
      dueAt: dueAt(r, now), assignees, createdBy: by,
      resources: r.chance(0.15) ? [{ type: 'url', title: 'Reference', ref: 'https://example.com/ref' }] : [],
    })
    const status = r.pick(['todo', 'todo', 'todo', 'doing', 'doing', 'done', 'done', 'done', 'archived'] as const)
    if (status !== 'todo') tasksApi.setTaskStatus(ws, task.id, status, by)
    counts[status] = (counts[status] ?? 0) + 1
    const labels = pickLabels(3)
    if (labels.length) labelEntities.setEntityLabels(ws, `task:${task.id}`, labels)
    const created = now - r.int(1, 70 * 24) * 3_600_000
    taskCreated.set(task.id, created)
    db.update(tables.tasks).set({ createdAt: new Date(created), updatedAt: new Date(created + Math.floor(r.next() * (now - created))) }).where(eq(tables.tasks.id, task.id)).run() // no writer: backdating
    m.tasks.push(task.id)
  }
  phase('tasks', `${m.tasks.length} tasks (${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')})`)

  // ------------------------------------------------------------------------------------------ comments
  const entityTimes = new Map<string, number>(m.tasks.map((id) => [`task:${id}`, taskCreated.get(id)!]))
  const commentAt = new Map<string, number>()
  for (let i = 0; i < scale.comments; i++) {
    const onTask = r.chance(0.75)
    const entity = onTask ? `task:${r.pick(m.tasks)}` : `project:${r.pick(projectIds)}`
    const by = r.chance(0.15) ? r.pick(agentActors) : r.pick(people)
    const content = commentText(r, { users: demoUsers.map((u) => u.id).concat(ownerId), tasks: m.tasks, projects: projectIds }, r.chance(0.35) ? ownerId : undefined)
    const comment = commentsApi.createComment({ workspaceId: ws, entity, createdBy: by, content })
    m.comments.push({ id: comment.id, by })
    const at = Math.max(entityTimes.get(entity) ?? now - 30 * DAY, now - r.int(0, 30) * DAY) + r.int(0, 3_600_000)
    commentAt.set(comment.id, Math.min(at, now - 60_000))
    db.update(tables.comments).set({ createdAt: new Date(commentAt.get(comment.id)!), updatedAt: new Date(commentAt.get(comment.id)!) }).where(eq(tables.comments.id, comment.id)).run() // no writer: backdating
  }
  // Notifications were made by the task and comment writers: date them like their source, and read about half of the owner's.
  for (const [id, at] of taskCreated) db.update(tables.notifications).set({ createdAt: new Date(at) }).where(eq(tables.notifications.entity, `task:${id}`)).run() // no writer: backdating
  for (const [id, at] of commentAt) db.update(tables.notifications).set({ createdAt: new Date(at) }).where(eq(tables.notifications.entity, `comment:${id}`)).run() // no writer: backdating
  const inbox = notificationsApi.getNotifications(ownerId, ws)
  notificationsApi.updateNotificationStatus(ownerId, ws, inbox.filter(() => r.chance(0.45)).map((n: { id: string }) => n.id), 'read')
  phase('comments', `${m.comments.length} comments; owner inbox ${inbox.length} (${notificationsApi.getUnreadCount(ownerId, ws)} unread)`)

  // ------------------------------------------------------------------------------------------ routines
  const routineList: { id: string; paused: boolean }[] = []
  let skippedWebhooks = 0
  for (let i = 0; i < scale.routines; i++) {
    const spec = routineSpec(i)
    if (spec.type === 'webhook' && !hasSecrets) { skippedWebhooks++; continue }
    const paused = i % 3 === 2
    // Active demo routines must never fire for real (they would start chats on a real connection): this time window is empty.
    const inert = [{ condition: 'time' as const, after: '00:00', before: '00:00' }]
    const prompt = { type: 'prompt' as const, prompt: spec.prompt, ...(r.chance(0.3) && { projectId: r.pick(projectIds) }), ...(r.chance(0.3) && { labels: [r.pick(labelList).slug].filter((s) => !labelList.find((l) => l.slug === s)?.valueType) }) }
    const draft = {
      type: spec.type, ...(spec.cron && { schedule: { cron: spec.cron, timezone: 'Europe/Madrid' } }), ...(spec.event && { event: spec.event }),
      ...(paused ? {} : { conditions: inert }), actions: [prompt],
    }
    const prepared = routineWebhook.prepareWebhookConfig(draft, spec.title)
    const routine = routinesApi.createRoutine({ workspaceId: ws, title: spec.title, agentId: r.chance(0.6) ? r.pick(agentIds) : null, config: prepared.config, createdBy: owner, paused, createdAt: now - r.int(5, 120) * DAY })
    routineList.push({ id: routine.id, paused })
    m.routines.push(routine.id)
  }
  phase('routines', `${routineList.length} routines${skippedWebhooks ? ` (${skippedWebhooks} webhook ones skipped: ENCRYPTION_KEY is not set)` : ''}`)

  // ------------------------------------------------------------------------------------------ chats
  const openStatuses = statusesStore.getStatuses(ws).filter((s: { category: string }) => s.category === 'open').map((s: { id: string }) => s.id)
  const tokens = { tasks: m.tasks, users: [ownerId, ...demoUsers.map((u) => u.id)] }
  const runsByRoutine = new Map<string, { chatId: string; at: number }[]>()
  for (let i = 0; i < scale.chats; i++) {
    const long = i < scale.longChats
    const count = long ? scale.longChatLength : (() => { const p = r.next(); return p < 0.25 ? r.int(1, 4) : p < 0.6 ? r.int(5, 20) : p < 0.88 ? r.int(21, 60) : r.int(61, 120) })()
    const es = r.chance(0.35)
    const messages = chatMessages(r, { count, start: 0, es, attachments, tokens, newId: () => crypto.randomUUID() })
    const archived = !long && r.chance(0.12)
    const unread = !archived && !long && r.chance(0.2)
    const endAgo = long ? r.int(1, 6) * 3_600_000 : r.chance(0.3) ? r.int(0, 20) * 3_600_000 : r.chance(0.5) ? r.int(1, 7) * DAY : r.int(7, 60) * DAY
    const shift = now - endAgo - messages.at(-1)!.timestamp
    for (const message of messages) message.timestamp += shift
    const titleRoll = r.next()
    const title = titleRoll < 0.05 ? undefined
      : titleRoll < 0.13 ? r.pick([`Follow up on task:${r.pick(m.tasks)}`, `Plan for project:${r.pick(projectIds)}`, `1:1 con user:${r.pick(tokens.users)}`])
      : titleRoll < 0.21 ? `${chatTitle(r, i)}: ${answer(r, es, 'short')}`.slice(0, 180)
      : long ? `${chatTitle(r, i)} (long thread)` : chatTitle(r, i)
    const routine = routineList.length && r.chance(0.1) ? r.pick(routineList) : undefined
    const parent = m.chats.length && !routine && r.chance(0.06) ? r.pick(m.chats) : undefined
    const id = crypto.randomUUID()
    const first = messages[0]!.timestamp
    sessions.createImportedSession(wsRef, {
      id, workspaceRootPath: wsRef.rootPath, name: title, createdBy: owner, ...(r.chance(0.7) ? { agentId: r.pick(agentIds) } : {}),
      createdAt: first - r.int(0, 60_000), lastUsedAt: messages.at(-1)!.timestamp, lastMessageAt: messages.at(-1)!.timestamp,
      isFlagged: !archived && r.chance(0.15), sessionStatus: archived ? 'archived' : r.pick(openStatuses), labels: r.chance(0.35) ? pickLabels(2) : [], hasUnread: unread,
      ...(r.chance(0.25) ? { projectId: r.pick(projectIds) } : {}), ...(parent ? { parentSessionId: parent } : {}),
      ...(routine ? { triggeredBy: { automationId: routine.id, automationName: 'Routine', event: 'SchedulerTick', timestamp: first, depth: 1 } } : {}),
      model: r.pick(CHAT_MODELS), thinkingLevel: r.pick(['low', 'medium', 'high'] as const), permissionMode: r.pick(['safe', 'ask', 'allow-all'] as const),
      messages: messages as never, tokenUsage: { inputTokens: count * 900, outputTokens: count * 240, totalTokens: count * 1140, contextTokens: Math.min(count * 400, 180_000), costUsd: Math.round(count * 0.8) / 100 },
    } as never)
    m.chats.push(id)
    if (routine) runsByRoutine.set(routine.id, [...(runsByRoutine.get(routine.id) ?? []), { chatId: id, at: first }])
    if (i % 10 === 9) saveManifest(m)
  }
  phase('chats', `${m.chats.length} chats (${scale.longChats} of ${scale.longChatLength} messages)`)

  // ------------------------------------------------------------------------------------------ routine history
  let runs = 0
  for (const { id, paused } of routineList) {
    const routine = routinesApi.getRoutine(ws, id)!
    const rows: { at: number; status: 'ok' | 'error' | 'skipped' | 'running'; chatId?: string; error?: string }[] = (runsByRoutine.get(id) ?? []).map((run) => ({ at: run.at, status: 'ok', chatId: run.chatId }))
    for (let k = 0, n = r.int(0, 10); k < n; k++) {
      const roll = r.next()
      rows.push(roll < 0.55 ? { at: now - r.int(1, 40) * DAY - r.int(0, DAY), status: 'ok' } : roll < 0.9 ? { at: now - r.int(1, 40) * DAY - r.int(0, DAY), status: 'error', error: r.pick(['The provider rejected the request (HTTP 429).', 'No connection for this agent.', 'Timed out after 120 s.']) } : { at: now - r.int(1, 40) * DAY, status: 'skipped', error: 'Conditions did not hold.' })
    }
    if (!paused && r.chance(0.3)) rows.push({ at: now - r.int(1, 30) * 60_000, status: 'running' })
    for (const row of rows.slice(0, 18)) {
      const run = routinesApi.startRoutineRun(routine, Math.floor(row.at / 60_000) * 60_000, { bump: true })
      if (!run) continue
      if (row.status !== 'running') routinesApi.updateRoutineRun(run.id, { status: row.status, chatId: row.chatId, error: row.error })
      db.update(tables.history).set({ startedAt: new Date(row.at + 1500) }).where(eq(tables.history.id, run.id)).run() // no writer: backdating
      runs++
    }
  }
  phase('history', `${runs} routine runs (ok, error, skipped, running)`)

  // ------------------------------------------------------------------------------------------ skills and sources
  for (let i = 0; i < scale.skills; i++) {
    const { slug, files } = skillFiles(i)
    try { await skillsApi.createSkill({ workspaceId: ws, slug, files, createdBy: owner }); m.skills.push(slug) } catch (error) { console.warn(`skill ${slug} not made: ${(error as Error).message}`) }
  }
  for (let i = 0; i < scale.sources; i++) {
    const spec = sourceSpec(i)
    sourcesStorage.saveSourceConfig(wsRef.rootPath, { id: crypto.randomUUID(), name: spec.name, slug: spec.slug, enabled: spec.status === 'ok', type: spec.type, tagline: spec.tagline, createdAt: now, updatedAt: now, ...spec.config } as never)
    sourcesStorage.saveSourceGuide(wsRef.rootPath, spec.slug, { raw: `# ${spec.name}\n\n## Guidelines\n\n${spec.tagline}. Prefer read-only calls; ask before writing.\n\n## Context\n\nDemo source (${spec.type}, ${spec.status}).\n` })
    await sourcesApi.syncLocalSource(ws, spec.slug, owner)
    if (sourcesApi.getSource(ws, spec.slug)) m.sources.push(spec.slug)
    else console.warn(`source ${spec.slug} was not indexed`)
  }
  phase('bundles', `${m.skills.length} skills, ${m.sources.length} sources`)
} catch (error) {
  saveManifest(m) // what was made so far stays listed, so --clear can remove it
  console.error(`Failed: ${error instanceof Error ? error.stack : String(error)}\nWhat was made so far is listed in ${MANIFEST}; run with --clear to remove it.`)
  process.exit(1)
}

// ---------------------------------------------------------------------------------------------- verify with the domain reads

const found = {
  projects: projectsApi.getProjects(ws, { status: ['active', 'archived'] }).filter((p: { id: string }) => m.projects.includes(p.id)).length,
  tasks: tasksApi.getTasks(ws, { status: ['todo', 'doing', 'done', 'archived'] }).filter((t: { id: string }) => m.tasks.includes(t.id)).length,
  chats: sessions.listSessions(wsRef).filter((c: { id: string }) => m.chats.includes(c.id)).length,
  library: library.getLibraryItems(ws).filter((i: { id: string }) => m.library.includes(i.id)).length,
}
console.log(`Verified through the domain reads: ${Object.entries(found).map(([k, v]) => `${k} ${v}/${m[k as keyof typeof found].length}`).join(', ')}`)
console.log(`demo users share password stored in ${join(CONFIG_DIR, 'demo-users.txt')}`)
console.log(`Done in ${((performance.now() - t0) / 1000).toFixed(1)} s. Clear with: bun run scripts/seed-demo.ts --clear${process.env.OTTO_CONFIG_DIR ? '' : ' --yes'}. Reload the page.`)
