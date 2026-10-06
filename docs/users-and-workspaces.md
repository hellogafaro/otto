# Users and workspaces (plan)

Status: phase 1 backend built (see "Phase 1 as built" below); the rest is proposal. Evidence is cited as `file:line` (line numbers in the older sections predate the build); `v1:` means `git show otto-v1-archive:<path>`. Better Auth facts are from its docs as of 2026-10-06 (`better-auth` 1.7.7, pinned).

## Phase 1 as built (backend)

- **Code.** `packages/shared/src/users/{schema,index}.ts` (Better Auth tables, `createUsersStore(db, options)` / `initUsersStore()`, `initAuth()`, the sign-up gate, `initOwner`, `initLocalUser`, `initFirstOwner`), `workspaces/{schema,members}.ts` (organization tables `workspaces`, `workspaces_members`, `workspaces_invitations`; `updateWorkspaceMirror`, `initWorkspaceOwner`, `hasPendingInvitation`), `updateLegacyUserActor(db, actor)` in `library`, `projects` and `tasks`, `actors.ts` (`userActor`, `isActor` accepts `user:<12 chars>` and `agent:<id>`), `config/storage.ts` (`refreshWorkspaceMirror` after add, discovery, remove; the rename handler in `handlers/rpc/settings.ts`), `packages/server-core/src/bootstrap/identity.ts` (WebSocket identity), `webui/http-server.ts` (Better Auth at `/api/auth/*`, `GET /api/setup`).
- **Env.** `BETTER_AUTH_SECRET` (required, at least 32 characters, separate from `ENCRYPTION_KEY`; the server and `initUsersStore()` refuse to start without it), `BETTER_AUTH_URL` (the public origin; https makes cookies Secure), `BETTER_AUTH_TRUSTED_ORIGINS` (comma-separated extra origins for `/api/auth`, e.g. `http://localhost:5175,http://localhost:9100` in dev), `OTTO_SERVER_TOKEN` (setup token of the first sign-up, machine and CLI credential, acts as the first user), `OTTO_WEBUI_SECURE_COOKIE` (optional true/false override), `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` and `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` (each pair switches that provider on). `OTTO_WEBUI_PASSWORD`, the jose JWT, the per-IP limiter, `POST /api/auth` and `login.html` are gone. Dev values are in Infisical (project `otto`, env `dev`).
- **First owner.** Open `/login` on a fresh install, it asks `GET /api/setup`; the first sign-up (`POST /api/auth/sign-up/email` with `setupToken` = `OTTO_SERVER_TOKEN`) becomes owner of every workspace and inherits every legacy `'user'` row. Wrong token: `403 SETUP_TOKEN_INVALID`. Later sign-ups need a pending, unexpired invitation for exactly that email: `403 INVITATION_REQUIRED`. The first-sign-up check and its claim run without an await in between, and a concurrent test with a slowed insert proves exactly one wins.
- **Identity.** The WebSocket handshake resolves a user: session cookie or bearer token (Better Auth's bearer plugin; the sign-in response carries it in `set-auth-token`) is that session's user; the server token (and the desktop app's per-launch token) is the first user (earliest `createdAt`), refused while no user exists. `RequestContext.userId` carries it; a reconnect must come from the same user. Handlers for library, projects, tasks and chat attachments take the actor from `ctx.userId` (`actorOf(ctx)`); the domains no longer default `createdBy`. The desktop app makes its local user at launch (`initLocalUser`, name and email from `preferences.json`, else `You` / `local@localhost`).
- **Where the plan was corrected.** Invitation rows are not deleted on accept or revoke: the plugin keeps them with `status` `accepted`, `rejected` or `canceled`, and the gate only counts `pending` ones. The plugin's `organization` table also has `logo` and `metadata` (and no `updatedAt`); the mirror leaves them empty. The organization plugin's own create, update and delete endpoints are disabled (`disabledPaths`), because workspaces come from the registry and a rename or removal there would drift from it. `beforeCreateOrganization` is not needed: the mirror is written with Drizzle, with our ids, never through the plugin. `better-auth` bundles its Drizzle adapter (`better-auth/adapters/drizzle`), there is no separate package to install. The setup token is read from the sign-up request body (Better Auth drops unknown fields from `context.body`, but the request is readable). Roles are checked against an allow-list (`owner`, `member`), not only against `admin`.
- **Known limits.** Rate limiting keys on the client address from `x-forwarded-for`; with no such header (a direct connection) every client shares one bucket per path, so sign-in is limited to 3 per 10 s for everyone together, and behind the proxy `advanced.ipAddress.trustedProxies` is still to be set. A sign-out does not close an open WebSocket (the session is checked at connect, as before). Sessions are not re-checked per RPC. The server needs `bun run db:push` before it starts (boot touches the new tables).


## Owner direction (2026-10-06, supersedes the sections below where they differ)

- **MVP sign-in: email and password, no mail.** Better Auth `emailAndPassword` (`minPasswordLength: 12`, `requireEmailVerification` off, `rateLimit` on). No mail sender, no SMTP, no email verification and no password reset yet (a forgotten password is reset by the operator with the CLI and `OTTO_SERVER_TOKEN`). Google and GitHub are configured but enabled only when their client id and secret env vars are set (off for now). **Later, additively:** a `sendEmail` function (nodemailer over `SMTP_URL`, or Resend) switches on email codes (`emailOTP`), verification, reset and invitation emails without touching the model.
- **Better Auth's organization plugin** (not our own member tables) for workspaces, members and invitations (links for now, mail later). The plugin's `organization` table is a thin mirror of the config workspace registry: `id` = workspace id (`beforeCreateOrganization` returns `{ data: { id } }`, inserted with `forceAllowId`), `slug` = the id too (our route slug is the folder name and is not unique). Mirror writes on `addWorkspace`, `syncWorkspaces`, a bootstrap backfill, removal (cascade) and rename. Tables are renamed with `modelName`: `workspaces`, `workspaces_members`, `workspaces_invitations` (`organizationId` mapped to `workspaceId`, `name` to `title`), declared in `workspaces/schema.ts`.
- **Roles: `owner` and `member`.** The plugin always accepts `admin`; `beforeCreateInvitation` and `beforeUpdateMemberRole` refuse it. Settings: `requireEmailVerificationOnInvitation: false` (no mail yet), `invitationExpiresIn` 7 days, `cancelPendingInvitationsOnReInvite: true`, `sendInvitationEmail` a no-op. **Invitations are links:** the owner enters the invitee email in Settings → Members and copies `/login?invite=<id>&email=<email>`; the invitation row (id = token) is deleted on accept or revoke.
- **Chats are private** to their creator (`createdBy` = `user:<id>` in the session header; even owners do not see others' chats). Everything else in a workspace (projects, tasks, library) is shared by its members.
- **Tasks** use members: the assignee picker lists workspace members, the server refuses a non-member assignee; `createdBy` and `assignees` hold `user:<id>`. Agents later (`agent:<id>` is already a valid actor).
- **Settings → Members** (owners): members, role, remove, leave (last owner cannot leave), invite by email, pending invitations with revoke. Our UI over RPCs that call `auth.api.*` with the caller's bearer token and an explicit `organizationId`. Server mode only (a local Electron install has no Better Auth session).
- **Login** is a React route at the router root (like the 404 page), not static HTML: `design/ui` Input/Button, i18n, theme, the same patterns as today's password page. Modes on one route: sign in (email, password), "Create the owner account" (first run only: name, email, password, `OTTO_SERVER_TOKEN`), and `?invite=<id>&email=<email>` (name and password for the invited email, then the invitation is accepted). `login.html`, `OTTO_WEBUI_PASSWORD` and the JWT are deleted in phase 1.
- **Sign-up gate.** Without mail nothing proves who owns an email, so the first sign-up needs `OTTO_SERVER_TOKEN` (the operator has it; a stranger finding a fresh install does not), and every later sign-up needs a pending invitation for exactly that email (checked in `databaseHooks.user.create.before`: throw an `APIError`; returning false crashes the route). An invitation link is a secret: whoever holds it can register that email, so it expires in 7 days and dies on first use. `OTTO_SERVER_TOKEN` stays as the CLI and machine credential.
- **No instance `admin` flag** for now.
- Sign-in sets a session cookie; the Electron remote client uses the bearer plugin (`Authorization: Bearer`).
- **Guard.** Membership is one Drizzle select on `workspaces_members`; the transport wrapper uses it. Plugin operations are not transactional: two owners leaving at once can race (accepted).

### Lean plan

1. **Sign-in and identity.** `users` domain (users, `users_sessions`, `users_accounts`, `users_verifications` kept for later mail), Better Auth mounted at `/api/auth/*`, `emailAndPassword`, the sign-up gate, the React login route, identity on the WebSocket (`ctx.userId`), bootstrap (workspace mirror rows, `owner` membership, `'user'` rewritten to `user:<id>`). First test proves Better Auth and the organization plugin on `bun:sqlite` (including our workspace ids as organization ids).
2. **Guard and private chats.** The wrapper around `server.handle` (member of the connection's and any explicit `workspaceId`; `OWNER_CHANNELS`), filtered `workspaces:get`, guarded switch/create; session header `createdBy`, chat list filtered, one `assertOwnsSession` for session-id channels (count them first), old chats to the first owner. One table-driven test over every registered channel.
3. **Members and tasks.** RPC wrappers for the plugin (invite, cancel, accept, remove, role, leave, list), Settings → Members page (Opus), assignee pickers from members, server validation.

Later: mail (codes, verification, reset, invitation emails), remote desktop sign-in UI, agents as actors, API keys, Google and GitHub switched on, a `workspaces` registry moved from the config into the table.

## (a) Recommendation

Better Auth for identity only (email and password, sessions, bearer tokens), stored through the Drizzle SQLite adapter in a new `users` domain. Workspaces stay what they are today (a directory registered in the config, `packages/shared/src/config/storage.ts:613`) and gain one membership table, `workspaces_members`, plus `workspaces_invitations`, owned by the existing `workspaces` domain; we do not adopt the organization plugin. Every connection resolves to one user at the WebSocket handshake, and one guard in the transport checks membership before any handler runs. Two roles: `owner` and `member`. The first user becomes owner of every existing workspace and inherits every legacy `'user'` row. The desktop app in local mode never shows a login: its per-launch token maps to a local user.

## (b) From v1: reuse vs. drop

Reuse:
- Better Auth for humans only, membership as a separate check (`v1:apps/server/src/auth.ts:12`). Config to keep: `emailAndPassword` with `minPasswordLength: 12`, `revokeSessionsOnPasswordReset`, `rateLimit: { enabled: true }`, `trustedOrigins: [origin]` (`v1:apps/server/src/auth.ts:20-94`).
- One authentication entry for every request, and identity never comes from a client field (`v1:apps/server/src/api.ts:34-59`, `v1:apps/server/src/http.ts:50`). The WebSocket rechecks the session on connect (`v1:apps/server/src/realtime.ts:35-46`).
- Membership as `(workspaceId, userId, role)` with a composite primary key (`v1:packages/workspaces/src/schema.ts:63-81`). Invitations bound to an email, 7-day expiry, accepted only by the matching account, revoked when the member is removed (`v1:packages/workspaces/src/index.ts:165-229,254-285`).
- Agents never authenticate: their identity comes from the server-side run (`v1:docs/backend.md:9`).

Drop:
- `installation_setups` and an operator-only CLI claim (`v1:packages/workspaces/src/schema.ts:82-89`, `v1:scripts/bootstrap.ts`): replaced by a first sign-up gated by the server token (f).
- Four roles (`owner/admin/contributor/viewer`, `v1:packages/workspaces/src/schema.ts:72`), owner-vs-admin rules in every mutation (`v1:packages/workspaces/src/index.ts:169-171,371-375`), `requireHuman/requireWriter/requireAdmin` sprinkled per function (`:64-74`).
- The per-transaction row lock and membership check inside every domain call (`inWorkspace`, `:29-63`); a workspace `cursor` (`:286-306`); audience caps; sorted, paginated member directories (`:321-362`).
- Agent sponsors, grants, per-user `visibility` on agents, documents and files (`v1:packages/agents/src/schema.ts:30-32`, `v1:docs/backend.md:23-29`), and project membership enforced on every read (`v1:packages/projects/src/index.ts:111-132`, `v1:apps/web/src/lib/project-membership.ts`). This is what made v1 heavy: the authorization tests (`v1:tests/authorization.test.ts`, `v1:tests/execution-authority.test.ts`) cover sponsor inheritance and grant regrants, not the basics.
- The v1 Members page asked users to paste invitation ids (`v1:docs/evidence/ui-settings-members-desktop-light.png`). We use a link.
- Email verification and mail delivery (v1 required mail in production, `v1:apps/server/src/auth.ts:38-39`). Otto has no mail sender; invitations are copyable links.

## (c) Data model

Better Auth's tables, in `packages/shared/src/users/schema.ts` (the `users` domain owns them; table names are mapped with `modelName`, so plugins and queries keep working):

- `users(id, name, email, emailVerified, image, createdAt, updatedAt)`. Better Auth needs `name`; it is a person's name, not an item label, so it stays `name` (record as an exception beside `library`).
- `users_sessions(id, userId, token, expiresAt, ipAddress, userAgent, createdAt, updatedAt)`. Not `sessions`: that word is a chat in this codebase.
- `users_accounts(id, userId, accountId, providerId, password, accessToken, refreshToken, idToken, accessTokenExpiresAt, refreshTokenExpiresAt, scope, createdAt, updatedAt)`
- `users_verifications(id, identifier, value, expiresAt, createdAt, updatedAt)`
- One extra column, `users.admin` (boolean, default false, via `user.additionalFields`, `input: false`): may change instance settings (server, providers, creating workspaces). The first user is admin.

Ours, in `packages/shared/src/workspaces/schema.ts`:

- `workspaces_members(workspaceId, userId, role, createdAt)`, primary key (`workspaceId`, `userId`); `role` is `owner` or `member`.
- `workspaces_invitations(id, workspaceId, email, role, createdBy, expiresAt, acceptedAt, revokedAt, createdAt)`. `id` is `createId()` and is the link token: it is only accepted by a signed-in user whose email matches (as v1), so a leaked link alone grants nothing.

No `workspaces` table yet. The registry stays the config (`id`, `rootPath`, name in the workspace folder config, `storage.ts:613-643`); `workspaceId` columns in `library`, `projects`, `tasks`, `timesheets` keep pointing at those ids. New workspaces get `createId()` (`generateWorkspaceId`, `storage.ts:596`, is a uuid-like string today); existing ids stay valid. A table comes when the registry must leave the file (hosted, Postgres).

Ids: `advanced.database.generateId: () => createId()`; Better Auth applies it to core and plugin tables. Session tokens are separate random values, not ids.

How the tables are made: run `bunx auth generate --adapter drizzle --dialect sqlite` once, paste the result into `users/schema.ts` with our names (`modelName` per model; Drizzle property names stay Better Auth's field names), and from then on `db:push` owns it like every other `schema.ts`. Never `auth migrate` (Kysely only). Better Auth 1.7's startup `validateSchema` (on outside production) catches drift after an upgrade. Adapter: `drizzleAdapter` from `@better-auth/drizzle-adapter`, `provider: 'sqlite'`, `transaction: false` (Drizzle's async transactions on bun:sqlite do not roll back). Only `db/` and `schema.ts` know it is SQLite, as now.

Actors: `'user'` becomes `'user:<userId>'`; `'agent:<id>'` is unchanged. Justification: `createdBy`, `assignees` and `projects_members.actor` must say which person once there are several, and a prefixed string keeps one column for humans and agents (no second `userId` column, `json_each` filters unchanged). `isActor` (`packages/shared/src/actors.ts:5`) accepts `user:[a-z0-9]{12}` and the server, never the client, fills the actor from the connection. The bare `'user'` is rewritten once at bootstrap (f) and is then refused.

## (d) Auth flow per surface

- **Browser (server mode).** Better Auth's handler mounted at `/api/auth/*` inside the existing fetch handler (`packages/server-core/src/webui/http-server.ts:306-353` is replaced). `login.html` asks for email and password and keeps `?next=` / `safeNextPath`. The page gate (`http-server.ts:440-450`) and `/api/config` call `auth.api.getSession({ headers })` instead of `validateSession` (`webui/auth.ts:180`). The WebSocket upgrade carries the same cookie (`transport/server.ts:439-442`). `OTTO_WEBUI_PASSWORD` and the jose JWT (`webui/auth.ts:10-89`) are deleted.
- **Electron, local.** No sign-in. Main already mints a per-launch token for the localhost server (`apps/electron/src/main/index.ts:584-586`); the server maps that token to the local user, created on first launch from `preferences.json` name and email (read today by the workspace menu, `workspace-menu.tsx:132-145`). Name and email then live in `users`; the preferences keys and the menu's file read go.
- **Electron to a remote server.** "Connect to a remote workspace" signs in with email and password against `{server}/api/auth/sign-in/email`; the bearer plugin returns the session token, which replaces the shared `OTTO_SERVER_TOKEN` in `RemoteServerConfig.token` (`packages/core/src/types/workspace.ts:15-19`) and travels in the existing handshake `token` (`transport/server.ts:435`). The token is stored with the credential manager, not in `config.json`. The thin client (`OTTO_SERVER_URL`, `preload/bootstrap.ts:60-90`) does the same. `@better-auth/electron` (official since 1.5: system-browser sign-in with PKCE, back through a custom-scheme deep link) is the later step when OAuth sign-in arrives; email and password in-app does not need it. Requests from main send no `Origin`, so Better Auth's origin check does not block them; `trustedOrigins` stays the server origin.
- **CLI and scripts.** `OTTO_SERVER_TOKEN` stays as the machine credential (`packages/server/src/index.ts:9`, `docs/cli.md:43`) and acts as the first admin. Per-user API keys (Better Auth `apiKey` plugin) wait until a second person needs the CLI.
- **Agents.** No credentials. A run's actor is `agent:<id>` in the chat's workspace, set by the server; agent subprocesses talk over stdio, not the WebSocket.

## (e) Authorization

- Roles: workspace `owner` (members, invitations, workspace settings, sources and secrets, delete) and `member` (everything else); instance `admin` (server and provider settings, creating workspaces). Project roles (`projects_members.role`) stay data only. No viewer role until someone asks.
- One place: the handshake resolves `{ userId }` (`validateToken` / `validateSessionCookie` return the user instead of a boolean, `transport/server.ts:85-94,430-449`) and `RequestContext` gains `userId` (`transport/types.ts:7-11`). One wrapper around `server.handle` checks, before the handler: the caller is a member of `ctx.workspaceId`, and of the first argument when that argument names a workspace (55 of the 241 handlers take an explicit `workspaceId`, e.g. `handlers/rpc/pages.ts`, `sources.ts`, `automations.ts`); channels listed in one `OWNER_CHANNELS` / `ADMIN_CHANNELS` set need that role. Handlers stay unaware; domain functions keep taking `workspaceId` first and never see users.
- Isolation: the handshake `workspaceId` (`transport/server.ts`, client-supplied) and `window:switchWorkspace` (`handlers/rpc/workspace.ts:85-89`) are refused without membership; `workspaces:get` returns only the caller's workspaces; pushes already target a workspace. `workspaces:create` takes a server path from the client (`workspace.ts:42-53`): admin only, and in server mode only under `CONFIG_DIR/workspaces`.
- Everything in a workspace is shared by its members except chats, which belong to the user who created them (see Owner direction, phase 3).

## (f) Migration

- Nothing is renamed or moved on disk; `workspaceId` values are unchanged.
- **Server.** With no user in the table, `/login` shows "Create the owner account", which also asks for `OTTO_SERVER_TOKEN` (the operator already has it; this stops a stranger claiming a fresh exposed install). A `databaseHooks.user.create.before` allows a sign-up only then, or for an email with a pending invitation; `emailAndPassword.disableSignUp` stays off because invitations need it.
- **Bootstrap** (`initOwner`, one SQLite transaction, idempotent): sets `admin`, adds an `owner` row for every registered workspace, rewrites `'user'` to `'user:<id>'` in `library.createdBy`, `projects_members.actor`, `tasks.createdBy`, `tasks.assignees`, `timesheets.createdBy`.
- **Electron local:** the same bootstrap with the local user on first launch.
- Remote workspace entries holding the old shared token prompt for sign-in once.

## (g) Phases

1. **Users and sign-in (server and browser).** Add `better-auth` at the root; `packages/shared/src/users/{schema.ts,index.ts}` (`initAuth()` with `drizzleAdapter(initDb(), { provider: 'sqlite', schema })`, `getUser`, `initOwner`); `packages/server-core/src/webui/{http-server.ts,auth.ts}`, `apps/webui/src/login.html`, `packages/server/src/index.ts`. Config: `minPasswordLength: 12`, `rateLimit: { enabled: true }` (Better Auth only enables it in production by default; memory storage is fine for one process, sign-in is limited to 3 per 10 s), the old per-IP limiter (`webui/auth.ts:118`) deleted. Env: `BETTER_AUTH_SECRET` (Infisical; separate from `ENCRYPTION_KEY`), `BETTER_AUTH_URL` (the public https URL, which also makes cookies `Secure`). Pin `better-auth` to an exact version of at least 1.7.3 (1.7.0 to 1.7.2 added and then removed a required `account.issuer`). Tests: `openDb(':memory:')` + `pushSchema`, sign-up, first-user gate, sign-in cookie, `login-next.test.ts` kept green.
2. **Identity on the transport.** `transport/{server.ts,types.ts}` (validators return a user, `ctx.userId`), `bootstrap/headless-start.ts`, Electron local token to local user (`apps/electron/src/main/index.ts`), `actors.ts`, the actor rewrite, domains get `createdBy` from `ctx`. Tests: handshake with cookie, bearer, server token; actor backfill.
3. **Membership and the guard.** `workspaces_members`, the `server.handle` wrapper, filtered `workspaces:get`, guarded switch and create. Tests: one table-driven test over every registered channel (a non-member gets `FORBIDDEN`, including explicit `workspaceId` arguments), owner-only channels.
4. **Invitations and the Members page.** `workspaces_invitations`, RPCs `workspaces:invite`, `acceptInvitation`, `revokeInvitation`, `removeMember`, `updateMemberRole`; Settings → Members (DESIGN.md), the workspace menu reads the user. Tests: email binding, expiry, revocation, last owner cannot leave.
5. **Remote desktop sign-in.** Bearer plugin, the remote-workspace flow in `components/workspace/add-workspace-step-connect-remote.tsx` and `preload/bootstrap.ts`, token in the credential manager.

Later, when asked: API keys, Google or GitHub sign-in, magic links (need mail), password reset by email, a `workspaces` table, viewer role.

## (h) Open decisions (recommended answer)

1. Organization plugin or our own two tables? **Own tables.** The plugin would give invitations (48 h default), `owner/admin/member`, `session.activeOrganizationId`, teams and `createAccessControl`, but it needs its own `organization` row (unique `slug` required) that duplicates the config registry, its operations are HTTP endpoints keyed on the cookie session while ours run over the WebSocket with a per-connection workspace, and two roles do not need an access-control layer. Revisit if the registry moves to SQLite and we want its invitation endpoints as they are.
2. Roles? **`owner` and `member` per workspace, plus one instance `admin` flag.** No viewer, no admin role.
3. Actors? **`'user:<id>'`**, legacy `'user'` rewritten to the first owner at bootstrap.
4. Keep `OTTO_SERVER_TOKEN`? **Yes, as the machine and CLI credential and the bootstrap proof**; drop `OTTO_WEBUI_PASSWORD`.
5. Desktop local login? **None**; local token maps to the local user.
6. How do people join? **Invitation link, copied by the owner; no email until a mail sender exists.**
7. Private chats per user? **Yes (owner decision)**: a chat belongs to its creator, even owners do not see others' chats.
8. Password reset without mail? **The admin makes a one-time reset link** (later; until then the CLI with the server token).
9. `users.name` vs. our `title` rule? **Keep `name`** and list it as an exception.

## (i) Risks

- 55 handlers read a client-supplied `workspaceId` argument; the guard must cover them all or a member of one workspace reads another. The channel-table test is the control.
- Global state outside workspaces (preferences, LLM connections, server settings in `~/.otto`) is per install, so members share it; anything personal stored there leaks across users.
- Better Auth moves fast (1.5 split adapters and api-key into packages and replaced its CLI; 1.7 tightened Electron schemes and adapter methods). We use the core and the bearer plugin only, pinned, and upgrade on purpose.
- bun:sqlite with the Drizzle adapter is not named in Better Auth's docs; the adapter code should work with it, but phase 1's first test must prove it.
- First admin: Better Auth has no "first user is admin"; the `databaseHooks.user.create.before` gate is our own code and must be tested against races (two first sign-ups).
- An exposed server between upgrade and first sign-up: closed by requiring the server token, only if the operator keeps it secret.
- Cookies behind the getbb.app proxy: set `BETTER_AUTH_URL` to the https public URL (cookies become `Secure`), leave `advanced.trustedProxyHeaders` off (the 1.7 default) and set `advanced.ipAddress.trustedProxies` to the proxy, otherwise rate limiting keys on the proxy address or trusts a spoofed `X-Forwarded-For`. The page and the WebSocket must share one origin or the cookie does not reach the upgrade (`OTTO_WEBUI_WS_URL`, `packages/server/src/index.ts:23`).
- The actor rewrite touches JSON (`tasks.assignees`); one transaction, test with real rows.
