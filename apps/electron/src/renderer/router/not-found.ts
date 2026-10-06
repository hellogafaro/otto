/**
 * What "not found" means, as pure functions. A URL that matches no route, a reserved first segment
 * and a bad settings page are known to the router (`isRouterNotFound`); a workspace nobody has and a
 * record that does not exist are known only once the data has loaded, and the app decides them
 * (`NavigationProvider`).
 */

import { isNotFound } from '@tanstack/react-router'

/** Whether the router has no view for the URL: a match is flagged global-not-found, or a route threw `notFound()`. */
export function isRouterNotFound(matches: ReadonlyArray<{ _notFound?: boolean; error?: unknown }>): boolean {
  return matches.some((match) => Boolean(match._notFound) || isNotFound(match.error))
}

/** Whether a record that belongs to `recordWorkspaceId` is in the active workspace (its local or remote id); any workspace while none is active. */
export function belongsToWorkspace(
  recordWorkspaceId: string | undefined,
  workspaceId: string | null,
  remoteWorkspaceId?: string | null,
): boolean {
  return !workspaceId || recordWorkspaceId === workspaceId || Boolean(remoteWorkspaceId && recordWorkspaceId === remoteWorkspaceId)
}
