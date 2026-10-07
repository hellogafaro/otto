import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError } from 'better-auth/api'
import { bearer } from 'better-auth/plugins/bearer'
import { organization } from 'better-auth/plugins/organization'
import { count, eq, inArray, sql } from 'drizzle-orm'
import { createHash, timingSafeEqual } from 'node:crypto'
import { getWorkspaces } from '../config/storage.ts'
import { initDb, type Db } from '../db/index.ts'
import { updateLegacyUserActor as updateLibraryActors } from '../library/index.ts'
import { updateLegacyUserActor as updateProjectActors } from '../projects/index.ts'
import { updateLegacyUserActor as updateTaskActors } from '../tasks/index.ts'
import { userActor } from '../actors.ts'
import { workspaces, workspacesInvitations, workspacesMembers } from '../workspaces/schema.ts'
import { hasPendingInvitation, initWorkspaceOwner, updateWorkspaceMirror } from '../workspaces/members.ts'
import { getFirstUser as getFirstUserRow } from './queries.ts'
import { users, usersAccounts, usersSessions, usersVerifications } from './schema.ts'

/**
 * Users: who signs in. Better Auth (email and password, sessions, bearer tokens) over the
 * tables in ./schema.ts, plus its organization plugin for workspaces, members and invitations
 * (tables in ../workspaces/schema.ts; a workspace is an organization whose id is the workspace id).
 *
 *   users(id, name, email, emailVerified, image, createdAt, updatedAt)   users_sessions, users_accounts, users_verifications
 *
 * Roles are `owner` and `member`. The first sign-up wins, or only `OTTO_OWNER_EMAIL` may make it
 * when that is set; every later one needs a pending invitation for exactly that email, checked in
 * `databaseHooks.user.create.before`. The first user becomes owner of every
 * workspace and inherits everything the bare actor 'user' made before users existed (`initOwner`).
 * There is no mail yet: an invitation is a link and `sendInvitationEmail` does nothing.
 */

export const OWNER_ONLY = 'OWNER_ONLY'
export const INVITATION_REQUIRED = 'INVITATION_REQUIRED'

/** A first sign-up that passed the gate has this long to finish before another may try. */
const FIRST_SIGN_UP_MS = 30_000

const ROLES = ['owner', 'member']
const INVITATION_EXPIRES_IN = 7 * 24 * 60 * 60

/** Equal secrets compare equal in constant time, whatever their length. */
export function sameSecret(given: unknown, expected: string | undefined): boolean {
  if (typeof given !== 'string' || !expected) return false
  return timingSafeEqual(createHash('sha256').update(given).digest(), createHash('sha256').update(expected).digest())
}

const refuse = (code: string, message: string) => APIError.from('FORBIDDEN', { code, message })

/** Roles come as one name or a comma-separated list; only ours are allowed. */
function assertRoles(role: string | string[] | undefined | null) {
  const names = [role ?? 'member'].flat().flatMap((name) => name.split(','))
  if (!names.every((name) => ROLES.includes(name))) throw refuse('ROLE_NOT_ALLOWED', 'Roles are owner and member')
}

export interface UsersOptions {
  /** `BETTER_AUTH_SECRET`: signs cookies and tokens. At least 32 characters. */
  secret: string
  /** `BETTER_AUTH_URL`: the public origin; an https one makes cookies Secure. */
  baseURL?: string
  trustedOrigins?: string[]
  /** `OTTO_OWNER_EMAIL`: when set, the only email that may make the first account. */
  ownerEmail?: string
  /** Overrides the Secure flag on cookies (otherwise from `baseURL`). */
  useSecureCookies?: boolean
  /** The registry of workspaces; the config by default. */
  getWorkspaces?: () => { id: string; title: string }[]
}

const socialProvider = (idVar: string, secretVar: string) => ({
  clientId: process.env[idVar] ?? '',
  clientSecret: process.env[secretVar] ?? '',
  enabled: !!process.env[idVar] && !!process.env[secretVar],
})

export function createUsersStore(db: Db, options: UsersOptions) {
  const listWorkspaces = options.getWorkspaces ?? (() => getWorkspaces().map((workspace) => ({ id: workspace.id, title: workspace.name })))
  let firstSignUpAt = 0
  const ownerEmail = options.ownerEmail?.trim().toLowerCase()

  const countUsers = () => db.select({ n: count() }).from(users).get()!.n

  const getFirstUser = () => getFirstUserRow(db)

  /** Mirror rows for every workspace, an owner row in each, and the bare 'user' actor rewritten to this user. One transaction; running it again changes nothing. */
  function initOwner(userId: string): void {
    db.transaction((tx) => {
      updateWorkspaceMirror(listWorkspaces(), tx)
      initWorkspaceOwner(userId, tx)
      const actor = userActor(userId)
      updateLibraryActors(tx, actor)
      updateProjectActors(tx, actor)
      updateTaskActors(tx, actor)
    })
  }

  const auth = betterAuth({
    database: drizzleAdapter(db, {
      provider: 'sqlite',
      // Better Auth finds a table by its model name; async transactions on bun:sqlite do not roll back.
      schema: {
        users,
        users_sessions: usersSessions,
        users_accounts: usersAccounts,
        users_verifications: usersVerifications,
        workspaces,
        workspaces_members: workspacesMembers,
        workspaces_invitations: workspacesInvitations,
      },
      transaction: false,
    }),
    secret: options.secret,
    baseURL: options.baseURL,
    trustedOrigins: options.trustedOrigins,
    user: { modelName: 'users' },
    session: { modelName: 'users_sessions' },
    account: { modelName: 'users_accounts' },
    verification: { modelName: 'users_verifications' },
    // `otto.session_token`, not the default `better-auth.*`: a proxy or gate in front of the app may run Better Auth too and own that name.
    advanced: { database: { generateId: () => crypto.randomUUID() }, cookiePrefix: 'otto', useSecureCookies: options.useSecureCookies },
    emailAndPassword: { enabled: true, minPasswordLength: 12 },
    rateLimit: { enabled: true },
    socialProviders: { google: socialProvider('GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'), github: socialProvider('GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET') },
    // Workspaces come from the registry (the config), never from the plugin's endpoints.
    disabledPaths: ['/organization/create', '/organization/update', '/organization/delete'],
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            // Check and claim without an await in between, so two first sign-ups cannot both pass.
            if (countUsers() === 0 && Date.now() - firstSignUpAt > FIRST_SIGN_UP_MS) {
              if (ownerEmail && user.email.trim().toLowerCase() !== ownerEmail) throw refuse(OWNER_ONLY, 'Only the owner email can create the first account')
              firstSignUpAt = Date.now()
              return
            }
            if (!hasPendingInvitation(user.email, db)) throw refuse(INVITATION_REQUIRED, 'Sign-up needs an invitation for this email')
          },
          after: async (user) => {
            if (countUsers() === 1) initOwner(user.id)
          },
        },
      },
    },
    plugins: [
      organization({
        schema: {
          organization: { modelName: 'workspaces', fields: { name: 'title' } },
          member: { modelName: 'workspaces_members', fields: { organizationId: 'workspaceId' } },
          invitation: { modelName: 'workspaces_invitations', fields: { organizationId: 'workspaceId' } },
        },
        requireEmailVerificationOnInvitation: false,
        invitationExpiresIn: INVITATION_EXPIRES_IN,
        cancelPendingInvitationsOnReInvite: true,
        // Invitations are links the owner copies; mail comes later.
        sendInvitationEmail: async () => {},
        organizationHooks: {
          beforeCreateInvitation: async ({ invitation }) => assertRoles(invitation.role),
          beforeUpdateMemberRole: async ({ newRole }) => assertRoles(newRole),
        },
      }),
      bearer(),
    ],
  })

  return {
    auth,
    /** True until the first user exists: the sign-in page then offers to create the owner. */
    needsOwner: () => countUsers() === 0,
    /** The earliest user: who `OTTO_SERVER_TOKEN` and the local app act as. */
    getFirstUser,
    initOwner,

    /** Name and email of these users (ids that do not exist are left out). */
    getUsers: (ids: string[]) =>
      ids.length ? db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, ids)).all() : [],
    getUserByEmail: (email: string) => db.select({ id: users.id }).from(users).where(eq(sql`lower(${users.email})`, email.trim().toLowerCase())).get(),

    /** The one user of a local (Electron) install, made on first launch. Returns its id. */
    initLocalUser(input: { name: string; email: string }): string {
      const existing = getFirstUser()
      const id = existing?.id ?? crypto.randomUUID()
      if (!existing) {
        const now = new Date()
        db.insert(users).values({ id, name: input.name, email: input.email.toLowerCase(), createdAt: now, updatedAt: now }).run()
      }
      initOwner(id)
      return id
    },

    /** At boot: makes the mirror match the registry and, once a user exists, keeps the first user owner of every workspace. */
    initFirstOwner(): void {
      const first = getFirstUser()
      if (first) initOwner(first.id)
      else updateWorkspaceMirror(listWorkspaces(), db)
    },
  }
}

export type UsersStore = ReturnType<typeof createUsersStore>
export type Auth = UsersStore['auth']

let store: UsersStore | undefined

/** The process-wide store, on the shared database and the environment. Throws without `BETTER_AUTH_SECRET`. */
export function initUsersStore(): UsersStore {
  if (store) return store
  const secret = process.env.BETTER_AUTH_SECRET
  if (!secret) throw new Error('BETTER_AUTH_SECRET is not set')
  const secure = (process.env.OTTO_WEBUI_SECURE_COOKIE ?? '').trim().toLowerCase()
  return (store = createUsersStore(initDb(), {
    secret,
    baseURL: process.env.BETTER_AUTH_URL || undefined,
    trustedOrigins: (process.env.BETTER_AUTH_TRUSTED_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean),
    ownerEmail: process.env.OTTO_OWNER_EMAIL,
    useSecureCookies: ['1', 'true', 'yes', 'on'].includes(secure) ? true : ['0', 'false', 'no', 'off'].includes(secure) ? false : undefined,
  }))
}

export const initAuth = (): Auth => initUsersStore().auth
export const needsOwner = (): boolean => initUsersStore().needsOwner()
export const getFirstUser: UsersStore['getFirstUser'] = () => initUsersStore().getFirstUser()
export const initLocalUser: UsersStore['initLocalUser'] = (input) => initUsersStore().initLocalUser(input)
export const getUsers: UsersStore['getUsers'] = (ids) => initUsersStore().getUsers(ids)
export const getUserByEmail: UsersStore['getUserByEmail'] = (email) => initUsersStore().getUserByEmail(email)
export const initFirstOwner = (): void => initUsersStore().initFirstOwner()
