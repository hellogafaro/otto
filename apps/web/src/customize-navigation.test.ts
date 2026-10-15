import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  acknowledgeCustomizeNavigation,
  openCustomize,
  useCustomizeNavigationStore,
} from "./customize-navigation";

afterEach(acknowledgeCustomizeNavigation);

describe("customize navigation", () => {
  it("asks for the Integrations tab by default and clears once handled", () => {
    openCustomize();
    expect(useCustomizeNavigationStore.getState().request).toEqual({
      tab: "integrations",
      query: null,
    });
    acknowledgeCustomizeNavigation();
    expect(useCustomizeNavigationStore.getState().request).toBeNull();
  });

  it("carries a tab and a search from an inline recommendation", () => {
    openCustomize("integrations", " Gmail ");
    expect(useCustomizeNavigationStore.getState().request).toEqual({
      tab: "integrations",
      query: "Gmail",
    });
  });
});
