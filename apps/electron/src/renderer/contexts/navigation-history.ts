interface SemanticHistoryKeyInput {
  workspaceSlug: string | null
  route: string
}

interface InitialRestoreGateInput {
  isReady: boolean
  isSessionsReady: boolean
  workspaceId: string | null
  initialRouteRestored: boolean
}

/**
 * Builds a semantic history key used to dedupe pushState entries: the same
 * workspace and route is the same history entry.
 */
export function buildSemanticHistoryKey({ workspaceSlug, route }: SemanticHistoryKeyInput): string {
  return [workspaceSlug ?? '', route].join('::')
}

/**
 * Returns whether initial route restoration is allowed to run.
 */
export function canRunInitialRestore({
  isReady,
  isSessionsReady,
  workspaceId,
  initialRouteRestored,
}: InitialRestoreGateInput): boolean {
  return isReady && isSessionsReady && !!workspaceId && !initialRouteRestored
}
