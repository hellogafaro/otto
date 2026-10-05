/**
 * Where the open entry sits in the history: whether Back and Forward have somewhere to go.
 *
 * TanStack's history numbers its entries (`location.state.__TSR_index`) but cannot tell how many
 * lie ahead, so the highest index seen is tracked: a push discards what lay ahead, going back and
 * forward move within it. After a reload the entries ahead are unknown, so Forward stays off until
 * the user goes back again.
 */

export interface HistoryPosition {
  index: number
  max: number
}

export type HistoryActionType = 'PUSH' | 'REPLACE' | 'BACK' | 'FORWARD' | 'GO'

export function initialHistoryPosition(index: number | undefined): HistoryPosition {
  const i = index ?? 0
  return { index: i, max: i }
}

export function nextHistoryPosition(prev: HistoryPosition, action: HistoryActionType, index: number | undefined): HistoryPosition {
  const i = index ?? 0
  if (action === 'PUSH') return { index: i, max: i }
  return { index: i, max: Math.max(prev.max, i) }
}

export const canGoBack = (position: HistoryPosition): boolean => position.index > 0
export const canGoForward = (position: HistoryPosition): boolean => position.index < position.max
