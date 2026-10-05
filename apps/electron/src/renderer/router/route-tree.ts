/**
 * The route tree: the URL scheme (`/{workspaceSlug}/chats/{sessionId}`, see `location.ts` for the
 * table) as typed paths and search params. Routes carry no components. The app renders one view
 * at a time from the navigation state derived from the location (`NavigationProvider`), so the
 * router here owns the URL, its validation, the redirects and the history, and the root route
 * renders the app.
 *
 * Unmatched or unmappable URLs (an unknown section, a bad settings page) match nothing here; the
 * navigation provider replaces them with the active workspace's Chats.
 */

import { createElement, type ComponentType } from 'react'
import { createRootRouteWithContext, createRoute, notFound, redirect } from '@tanstack/react-router'
import { isReservedWorkspaceSlug } from '@otto/shared/utils/workspace-slug'
import { validateChatsSearch, validateRoutinesSearch, validateSourcesSearch } from './location'

export interface RouterContext {
  /** What the root route renders: the renderer's `App` (the web app wraps it in its adapter). */
  Root: ComponentType
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: function AppRoot() {
    return createElement(rootRoute.useRouteContext().Root)
  },
  // Nothing renders a not-found view: the navigation provider redirects to Chats.
  notFoundComponent: () => null,
})

/** `/`: the navigation provider redirects it to the active workspace's Chats once the workspace is known. */
const rootIndexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/' })

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
const settingsPageRoute = createRoute(section('settings/$page'))
const tasksRoute = createRoute(section('tasks'))
const projectsRoute = createRoute(section('projects'))
const projectRoute = createRoute(section('projects/$projectId'))
const routinesRoute = createRoute({ ...section('routines'), validateSearch: validateRoutinesSearch })
const routineRoute = createRoute({ ...section('routines/$automationId'), validateSearch: validateRoutinesSearch })
const libraryRoute = createRoute(section('library'))
const libraryPageRoute = createRoute(section('library/$pageId'))
const skillsRoute = createRoute(section('skills'))
const skillRoute = createRoute(section('skills/$skillSlug'))
const sourcesRoute = createRoute({ ...section('sources'), validateSearch: validateSourcesSearch })
const sourceRoute = createRoute({ ...section('sources/$sourceSlug'), validateSearch: validateSourcesSearch })

export const routeTree = rootRoute.addChildren([
  rootIndexRoute,
  workspaceRoute.addChildren([
    workspaceIndexRoute,
    chatsRoute,
    chatRoute,
    settingsRoute,
    settingsPageRoute,
    tasksRoute,
    projectsRoute,
    projectRoute,
    routinesRoute,
    routineRoute,
    libraryRoute,
    libraryPageRoute,
    skillsRoute,
    skillRoute,
    sourcesRoute,
    sourceRoute,
  ]),
])
