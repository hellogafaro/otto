import { create } from "zustand";

import type { CustomizeTab } from "./components/customize/customize.logic";

interface CustomizeRequest {
  readonly tab: CustomizeTab;
  readonly query: string | null;
  /** A Composio app slug, which opens that app's page. */
  readonly app?: string;
}

/** A pending request to open Customize, from places outside the router such as a chat chip. */
export const useCustomizeNavigationStore = create<{ readonly request: CustomizeRequest | null }>(
  () => ({ request: null }),
);

export function openCustomize(tab: CustomizeTab = "integrations", query?: string): void {
  useCustomizeNavigationStore.setState({ request: { tab, query: query?.trim() || null } });
}

/** Opens one app's page, where its accounts are connected. */
export function openCustomizeApp(slug: string): void {
  useCustomizeNavigationStore.setState({
    request: { tab: "integrations", query: null, app: slug },
  });
}

export function acknowledgeCustomizeNavigation(): void {
  useCustomizeNavigationStore.setState({ request: null });
}
