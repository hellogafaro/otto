import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { useCallback, useRef } from "react";

import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";

/**
 * Shared persisted shelf state for the compact Home list and iPad sidebar.
 * Refs advance before persistence starts so consecutive presses always toggle
 * the latest value, even if React has not rendered the optimistic patch yet.
 */
export function useThreadListV2ShelfPreferences() {
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const loaded = AsyncResult.isSuccess(preferencesResult);

  const snoozedShelfExpanded =
    loaded && preferencesResult.value.threadListV2SnoozedShelfExpanded === true;

  const snoozedShelfExpandedRef = useRef(snoozedShelfExpanded);
  snoozedShelfExpandedRef.current = snoozedShelfExpanded;

  const toggleSnoozedShelf = useCallback(() => {
    if (!loaded) return;
    const expanded = !snoozedShelfExpandedRef.current;
    snoozedShelfExpandedRef.current = expanded;
    savePreferences({ threadListV2SnoozedShelfExpanded: expanded });
  }, [loaded, savePreferences]);

  return {
    loaded,
    snoozedShelfExpanded,
    toggleSnoozedShelf,
  } as const;
}
