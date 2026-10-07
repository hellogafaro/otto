# Routing

One URL scheme for web and Electron: real paths on browser history (`createBrowserHistory`). No hash router, no per-client code.

**URLs:** `/{workspaceSlug}/chats`, `/{workspaceSlug}/chats/{id}`, `/{workspaceSlug}/settings/appearance`. Reserved first segments (never a workspace slug): `assets`, `api`, `ws`, `login`, `health`, `index.html`, `favicon.*`, `manifest.json`.

## How each client loads it

| Client | Origin | Served by |
| --- | --- | --- |
| Web | the server's origin | `packages/server-core/src/webui/http-server.ts` |
| Electron, packaged | `otto://app/` | `src/main/app-protocol.ts` via `protocol.handle` (`protocol-schemes.ts`) |
| Electron, dev | `VITE_DEV_SERVER_URL` | Vite (history fallback built in); no dev scheme, since HMR needs the real dev origin |

`otto://` is also the OS deep-link scheme. They coexist: OS links arrive through `open-url` / `second-instance`, never `protocol.handle`. The handler serves only host `app` (any other host is 404), the deep-link parser refuses host `app`, and the window guard allows `otto://app/*` only; any other navigation goes to the external-URL / deep-link path.

## Fallback rules (same in both servers)

1. A real file is served with its MIME type (`assets/*` is `immutable`, HTML is `no-cache`).
2. A miss under `/assets/` or with a static extension (`.js .css .map .png .woff2 ...`) is 404, never `index.html`.
3. Any other path is an app route and gets `index.html` 200 (trailing slash and dots in ids are fine). In Electron it must also be a navigation (`Accept: text/html`), so `fetch('/x')` 404s.
4. Web only: `/api/*` and `/ws` misses are JSON 404; unauthenticated HTML requests redirect to `/login` (carrying `?next=` with the path asked for), other requests get 401. Public without a session: `/login` (the SPA's `index.html`) and `/assets/*` (the bundle it needs), `/api/setup`, `/api/auth/*`, `/favicon.{ico,svg}`, `/apple-touch-icon.png`, `/manifest.json`, `/icon-N.png`.
5. Electron only: methods other than GET/HEAD are 405, decoded `..`, backslash, NUL or malformed escapes are 403.

## The router (TanStack Router, code-based)

`apps/electron/src/renderer/router/`: `router.ts` (`createAppRouter(Root, history?)`, the `Register` augmentation), `route-tree.ts` (typed routes), `location.ts` (the pure mappings), `not-found.ts` (what not found means), `history-position.ts` (Back / Forward availability). Both entries mount `<RouterProvider router={createAppRouter(Root)}>` at the top, above the app: `apps/electron/src/renderer/main.tsx` and `apps/webui/src/main.tsx`. The root route renders `Root` (the entry's own tree: theme, `App` or, for a URL with no page, only `NotFoundPage` (on the web `/login` only `LoginPage`), and the toaster), so the splash, onboarding and the web auth gate render inside it exactly as before, and `NavigationProvider` sits inside `App`. Always `createBrowserHistory()` (the playground's demos use memory history). `defaultPreload: false` (the routes carry no components, so there is nothing to split yet). `disableGlobalCatchBoundary`: a render error reaches the entry's own boundary (Sentry's, the crash screen).

### URLs

| View | URL |
| --- | --- |
| Chats | `/{ws}/chats`, `/{ws}/chats/{sessionId}`; filters in the search (below) |
| Settings | `/{ws}/settings/{page}` (`app` (titled General), `ai`, `appearance`, `input`, `workspace`, `members`, `permissions`, `labels`, `messaging`, `server`, `shortcuts`, `preferences`). There is no index: `/{ws}/settings` is replaced (`redirect`, `replace: true`) with the registry's first page, General (`DEFAULT_SETTINGS_SUBPAGE`); the bare route string `settings` parses to it too, and `routes.view.settings()` builds it |
| Tasks | `/{ws}/tasks`, `/{ws}/tasks/{taskId}`; `?project={id}&assignee={actor}&status=todo\|doing\|done` (repeats) `&archived=1` |
| Projects | `/{ws}/projects` (`?status=archived`), `/{ws}/projects/{projectId}` (`?tab=overview\|tasks\|documents\|files`) |
| Routines (automations) | `/{ws}/routines`, `/{ws}/routines/{id}` (the matcher's id); `?type=scheduled\|event\|agentic` (one; the detail keeps it, so Back and Previous / Next follow it) |
| Library | `/{ws}/library`, `/{ws}/library/{itemId}` (a file or a document); `?tab=all\|files\|documents&folder={id}&createdBy={actor}` |
| Inbox | `/{ws}/inbox` (`?unread=1`); no detail: a notification opens its task or project |
| Skills (in Settings) | `/{ws}/settings/skills` (the grid), `/{ws}/settings/skills/{slug}`; `?scope=global\|workspace\|project` |
| Sources (in Settings) | `/{ws}/settings/sources` (the grid), `/{ws}/settings/sources/{slug}`; `?type=api\|mcp\|local` |
| Agents (in Settings) | `/{ws}/settings/agents` (the gallery), `/{ws}/settings/agents/{id}`; route string `agents[/agent/{id}]` |

`/` and `/{ws}` redirect to `/{activeWorkspaceSlug}/chats` (`/{ws}` in the route tree, `/` by the navigation provider once the workspace is known, so the splash is not held back). A known slug other than the active workspace switches to it (back step, pasted link, restored window); the switcher changing the workspace moves the URL (same settings page, otherwise the section's index). Reserved first segments (`isReservedWorkspaceSlug`, `packages/shared/src/utils/workspace-slug.ts`) are never a workspace: the `$workspaceSlug` route throws `notFound()` for them, and `generateSlug` suffixes `-workspace` so a workspace can never get one.

**Search.** Plain query strings (custom `parseSearch` / `stringifySearch`, repeated keys for lists, `true` is `1`), not TanStack's JSON form. Chats: `?status=todo&status=done&label=research&label=design&flagged=1&archived=1` (filters combine, lists hold several values; or one `?view=`). Validated by `validateChatsSearch` (arrays of distinct strings, `1`/`true` flags, unknown dropped). Tasks, Projects, Library, Skills and Inbox have theirs in `shared/section-search.ts` (`normalizeTasksSearch`, `normalizeProjectsSearch`, `normalizeLibrarySearch`, `normalizeSkillsSearch`, `normalizeInboxSearch`: known keys and values only, in a fixed order), the same query in the route string (`tasks/task/{id}?project=p1`, `projects/project/{id}?tab=tasks`, `library/item/{id}?folder=f1`, `skills/skill/{slug}?scope=workspace`); Sources keep their type in the route string's path (`sources/mcp/source/{slug}`) and `?type=` in the URL (`validateSourcesSearch`). A detail route validates its index's search, so Back (`useParentView`) returns to the same filters, tab and folder (a project's Back goes to the plain Projects index), and a skill's or a source's Previous / Next step through its grid under that filter (`listNav`, the order of `lib/skill-source-lists.ts`); a routine's through the Routines index under its `?type=` (`getVisibleRoutines`, `pages/routines/routine-items.ts`).

**Skills and Sources live in Settings.** Their route strings stay `skills[/skill/{slug}]` and `sources[/{type}][/source/{slug}]`; `router/location.ts` maps them under `/{ws}/settings/` (the section is the two segments `settings/skills`, `settings/sources`), and the route tree's static `settings/skills` and `settings/sources` routes win over `settings/$page`. The grid is their index: nothing opens the first item any more. The old top-level `/{ws}/skills` and `/{ws}/sources` match no route (not found).

### Not found

A URL with no page shows `NotFoundPage` (`pages/not-found-page.tsx`) alone: the stock `Empty` centered on the plain background and one "Go home" button that replaces the URL with `/` (which redirects to the active workspace's Chats). No sidebar, header or floating navigation, and the URL stays as typed. Nothing is replaced with Chats any more.

| URL | Result | Decided by |
| --- | --- | --- |
| `/test/nope`, `/test/chats/a/b`, `/test/tasks/a/b`, `/test/skills`, `/a/b/c/d` (matches no route) | not found | the router: `isRouterNotFound` (`router/not-found.ts`). The root route renders the entry's `Root` with `notFound`, which shows only the page (theme, i18n and the toaster stay; `App` does not mount) |
| `/test/settings/nope` (bad settings page), `/login/chats` (reserved first segment) | not found | the router: the route's `beforeLoad` throws `notFound()` |
| `/zzz`, `/zzz/chats` (a slug no workspace has) | not found, once the workspaces have loaded (the splash shows until then) | `NavigationProvider`. The tree still redirects `/zzz` to `/zzz/chats`; then the slug is unknown |
| `/test/chats/{id}` of a chat that is not in the workspace | not found, once the chat list has loaded | `NavigationProvider`: the list lacks it and the server has no such chat in this workspace. A chat deleted while open is not re-checked |
| `/test/settings/skills/{slug}`, `/test/settings/sources/{slug}`, `/test/settings/agents/{id}`, `/test/routines/{id}` that do not exist | not found, once the item's page has loaded its list | the page calls `showNotFound()` |
| `/`, `/{knownSlug}`, a known view | redirect to Chats, or the view | |

The app-level cases set `isNotFound` in the navigation context (true while the URL is the path found missing; any URL change ends it) and `App` swaps the whole main UI for the page (`NotFoundGate`). Task, Project, Library item and Routine ids are checked by their pages, which call `showNotFound()` once they have loaded their list.

### Route strings stay the internal API

`navigate('allSessions/session/abc')`, `routes.view.*`, `currentRouteAtom`, pins and recents all keep route strings (`shared/routes.ts`, `shared/route-parser.ts`). `router/location.ts` maps them to URLs and back (`routeStringToLocation(route, ws)`, `locationToRouteString(pathname, search)`, round-trip tested for every kind). The Chats filters are the same query in both: `allSessions[/session/{id}]?status=todo&status=done&label=a&flagged=1`; the older single-value strings (`state/{id}`, `label/{id}`, `flagged`, `archived`, and `allSessions/state/{id}` etc.) parse to it. `parseRouteToNavigationState` returns `filters: { status: string[]; label: string[]; flagged: boolean; archived: boolean }` for the Chats index (and keeps `filter`, the first of them, for older consumers). `routes.view.allSessions(filters?)` and `allSessions(sessionId, filters?)` build it.

`NavigationProvider` derives everything from the router's location: `navigationState` is `parseRouteToNavigationState(routeString)`, `currentRouteAtom` mirrors the route string, `navigate(route, { replace? })` is `router.navigate(routeStringToLocation(...))` (actions still run their side effects and change no URL). `goBack` / `goForward` are the router history's; `canGoBack` / `canGoForward` come from the history index (`__TSR_index`) and the highest index seen (`history-position.ts`). After a reload the entries ahead are unknown, so Forward is off until the user goes back again.

### Legacy and sign-in

- `?ws=<slug>&route=<routeString>` (old `file://` state, saved window URLs, bookmarks) and the transitional `?workspaceId=` are translated once in `createAppRouter` with `replace` before the first match (`translateLegacyUrl`). Nothing writes them any more. The main process still adds `?workspaceId=` to the URL it loads (`buildRendererUrl`); the renderer drops it, nothing reads it, and it can go from main.
- Web sign-in is the React route `/login` at the router root (`loginRoute` in `route-tree.ts`; the entry's `Root` gets `login` and renders only `LoginPage`, `apps/webui/src/login-page.tsx`; Electron throws `notFound()`). It returns to the page asked for: the server redirects an unauthenticated HTML request to `/login?next=<encoded path+query>`, and after Better Auth signs in (`/api/auth/sign-in/email`, `sign-up/email`) the page loads `next` checked by `safeNextPath` (`apps/webui/src/login-rules.ts`, the same rule as the server's: a same-origin path starting with a single `/`, no backslash or control characters, never the login page; otherwise `/`). An expired session (`401` on `/api/config`) does the same from the app.

### What the tests cover

`router/__tests__` (mappings round-trip for every route kind, search included, and settings page, the bare Settings URL replaced with General, legacy strings, search validation, history position logic, the route tree on a memory history, which URLs are not found), `shared/__tests__/route-parser-chat-filters.test.ts`, `shared/__tests__/route-parser-sections.test.ts`, `renderer/lib/__tests__/skill-source-lists.test.ts` (the grids' order and filters, which Previous / Next follow), `packages/server-core/src/webui/__tests__/login-next.test.ts`, `apps/webui/src/__tests__/login-rules.test.ts`.

## Contract notes for the renderer

- Asset URLs are absolute (`base: '/'` in both Vite configs); the entry script is `/main.tsx` in `apps/electron/src/renderer/index.html`.
- Initial URL: Electron opens `otto://app/?workspaceId={id}` (or a restored `otto://app/{path}?...`, see `buildRendererUrl`). Window state stores `webContents.getURL()`, so saved windows come back on their path.
- History API only (`pushState` / `replaceState` / `popstate`, through the router); never `location.hash` for routes.
- Path segments are percent-encoded by the mapping; ids contain no dots, but dots are tolerated.

## Storage moves origin once

`file://` (prod) becomes `otto://app` (Electron localStorage is per origin; dev stays on the Vite origin). Lost in the packaged app on first launch: every `otto-*` key of `lib/local-storage.ts` (sidebar mode, grouping, collapsed groups, theme, panel layouts, tabs, pins, recents, working dirs, turn-card expansion, `workspace-url:*`) and i18next's `i18nextLng`. All are UI preferences that rebuild themselves. A migration is not worth it now. If wanted later, copy the old file:// localStorage once, as T3 Code does (`DesktopLegacyLocalStorage.ts` + `legacyLocalStorageMerge.ts` in pingdotgg/t3code).
