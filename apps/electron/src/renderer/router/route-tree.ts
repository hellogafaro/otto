/**
 * The route tree: the URL scheme (`/{workspaceSlug}/chats/{sessionId}`, see `location.ts` for the
 * table) as typed paths and search params. Routes carry no components. The app renders one view
 * at a time from the navigation state derived from the location (`NavigationProvider`), so the
 * router here owns the URL, its validation, the redirects and the history, and the root route
 * renders the app.
 *
 * A URL that matches no route (an unknown section, extra segments), a reserved first segment and a
 * bad settings page are not found: the root route renders the entry's `Root` as the not-found
 * page, outside the app. A workspace slug nobody has and a record that does not exist are known
 * only once the data has loaded, so the app shows the same page for them (`NavigationProvider`).
 */

import { createElement, type ComponentType } from 'react'
import { createRootRouteWithContext, createRoute, notFound, redirect, useRouterState } from '@tanstack/react-router'
import { isReservedWorkspaceSlug } from '@otto/shared/utils/workspace-slug'
import { isValidSettingsSubpage } from '../../shared/settings-registry'
import { normalizeLibrarySearch, normalizeProjectsSearch, normalizeTasksSearch } from '../../shared/section-search'
import { isWebUI } from '../lib/platform'
import { isRouterNotFound } from './not-found'
import { validateChatsSearch, validateRoutinesSearch, validateSourcesSearch } from './location'

/** The props of the entry's `Root`: `notFound` shows the not-found page alone, `login` the web sign-in page alone; neither mounts the app. */
export interface RootProps {
  notFound?: boolean
  login?: boolean
}

export interface RouterContext {
  /** What the root route renders: the entry's theme, the renderer's `App` (the web app wraps it in its adapter) and the toaster. */
  Root: ComponentType<RootProps>
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: function AppRoot() {
    // The root renders the app itself, never an outlet, so the router's own not-found rendering never runs
    const notFound = useRouterState({ select: (state) => isRouterNotFound(state.matches) })
    const login = useRouterState({ select: (state) => state.matches.some((match) => match.routeId === loginRoute.id) })
    return createElement(rootRoute.useRouteContext().Root, { notFound, login: login && !notFound })
  },
})

/** `/`: the navigation provider redirects it to the active workspace's Chats once the workspace is known. */
const rootIndexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/' })

/** `/login`: the web sign-in page, outside the app (no shell, no WebSocket). Electron runs its own local server and has no sign-in. */
const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'login',
  beforeLoad: () => {
    if (!isWebUI) throw notFound()
  },
})

const workspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '$workspaceSlug',
  beforeLoad: ({ params }) => {
    if (isReservedWorkspaceSlug(params.workspaceSlug)) throw notFound()
  },
})

const workspaceIndexRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: '/',
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/$workspaceSlug/chats', params: { workspaceSlug: params.workspaceSlug }, replace: true })
  },
})

const section = <TPath extends string>(path: TPath) => ({ getParentRoute: () => workspaceRoute, path }) as const

const chatsRoute = createRoute({ ...section('chats'), validateSearch: validateChatsSearch })
const chatRoute = createRoute({ ...section('chats/$sessionId'), validateSearch: validateChatsSearch })
const settingsRoute = createRoute(section('settings'))
const settingsPageRoute = createRoute({
  ...section('settings/$page'),
  beforeLoad: ({ params }) => {
    if (!isValidSettingsSubpage(params.page)) throw notFound()
  },
})
const tasksRoute = createRoute({ ...section('tasks'), validateSearch: normalizeTasksSearch })
const taskRoute = createRoute({ ...section('tasks/$taskId'), validateSearch: normalizeTasksSearch })
const projectsRoute = createRoute({ ...section('projects'), validateSearch: normalizeProjectsSearch })
const projectRoute = createRoute({ ...section('projects/$projectId'), validateSearch: normalizeProjectsSearch })
const routinesRoute = createRoute({ ...section('routines'), validateSearch: validateRoutinesSearch })
const routineRoute = createRoute({ ...section('routines/$automationId'), validateSearch: validateRoutinesSearch })
const libraryRoute = createRoute({ ...section('library'), validateSearch: normalizeLibrarySearch })
const libraryItemRoute = createRoute({ ...section('library/$itemId'), validateSearch: normalizeLibrarySearch })
const skillsRoute = createRoute(section('skills'))
const skillRoute = createRoute(section('skills/$skillSlug'))
const sourcesRoute = createRoute({ ...section('sources'), validateSearch: validateSourcesSearch })
const sourceRoute = createRoute({ ...section('sources/$sourceSlug'), validateSearch: validateSourcesSearch })

export const routeTree = rootRoute.addChildren([
  rootIndexRoute,
  loginRoute,
  workspaceRoute.addChildren([
    workspaceIndexRoute,
    chatsRoute,
    chatRoute,
    settingsRoute,
    settingsPageRoute,
    tasksRoute,
    taskRoute,
    projectsRoute,
    projectRoute,
    routinesRoute,
    routineRoute,
    libraryRoute,
    libraryItemRoute,
    skillsRoute,
    skillRoute,
    sourcesRoute,
    sourceRoute,
  ]),
])
