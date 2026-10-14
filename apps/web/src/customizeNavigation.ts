import { create } from "zustand";

import type { CustomizeTab } from "./components/customize/customize.logic";

interface CustomizeRequest {
  readonly tab: CustomizeTab;
  readonly query: string | null;
}

/** A pending request to open Customize, from places outside the router such as a chat chip. */
export const useCustomizeNavigationStore = create<{ readonly request: CustomizeRequest | null }>(
  () => ({ request: null }),
);

export function openCustomize(tab: CustomizeTab = "integrations", query?: string): void {
  useCustomizeNavigationStore.setState({ request: { tab, query: query?.trim() || null } });
}

export function acknowledgeCustomizeNavigation(): void {
  useCustomizeNavigationStore.setState({ request: null });
}
