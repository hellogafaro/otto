/** The first-run setup steps, in order: name a workspace, then connect an AI provider. */
export type FirstRunStep = 'workspace' | 'connection'

/**
 * Which first-run step to show, if any. Someone with no workspace names one (they become its owner); an owner
 * of a workspace connects a provider while none is usable (or until they skip it). An invited member always has
 * the workspace they joined and is never an owner of it, so they go straight to the app.
 */
export function getFirstRunStep({ hasWorkspace, isOwner, connectionReady }: {
  hasWorkspace: boolean
  isOwner: boolean
  /** A usable AI connection exists, or an owner chose "Skip for now" (`setupDeferred`). */
  connectionReady: boolean
}): FirstRunStep | null {
  if (!hasWorkspace) return 'workspace'
  if (isOwner && !connectionReady) return 'connection'
  return null
}
