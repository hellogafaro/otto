import type { ScopedThreadRef } from "@otto/contracts";

export function resolveThreadSelectionDetailRef(
  selectedThreadRef: ScopedThreadRef | null,
  hasSelectedThreadShell: boolean,
): ScopedThreadRef | null {
  return hasSelectedThreadShell ? null : selectedThreadRef;
}
