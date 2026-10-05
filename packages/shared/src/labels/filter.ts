/**
 * Label Filter Matching
 *
 * THE single predicate for "does this session match a label filter". Both the
 * session list (useSessionSearch) and the AppShell filtered-set computation
 * route through it so the two can never diverge (they previously disagreed on
 * descendant handling). Browser-safe: pure tree/string operations, no Node APIs.
 */

import { getDescendantIds } from './tree.ts';
import { extractLabelId } from './values.ts';
import type { LabelConfig } from './types.ts';

/** Minimal structural session shape — the renderer's SessionMeta satisfies this. */
export interface LabelFilterableSession {
  labels?: string[];
  projectId?: string;
}

export interface LabelFilterInput {
  /** Label id to match, or '__all__' for "any labeled session". */
  labelId: string;
  /** When set, the session must additionally belong to this project. */
  projectId?: string;
}

/**
 * True when the session matches the label filter:
 * - `projectId`, when present, must equal the session's project (applies to '__all__' too)
 * - '__all__' → any session with at least one label
 * - specific id → tagged with the label or any of its descendants; valued entries
 *   like `task::3` match by base id
 *
 * Archived-ness is deliberately NOT considered here — callers own that policy.
 */
export function matchesLabelFilter(
  session: LabelFilterableSession,
  filter: LabelFilterInput,
  labelConfigs: LabelConfig[],
): boolean {
  if (filter.projectId && session.projectId !== filter.projectId) return false;
  if (!session.labels?.length) return false;
  if (filter.labelId === '__all__') return true;
  const matchIds = new Set([filter.labelId, ...getDescendantIds(labelConfigs, filter.labelId)]);
  return session.labels.some(entry => matchIds.has(extractLabelId(entry)));
}
