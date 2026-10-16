import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const testState = vi.hoisted(() => ({
  addToast: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: testState.addToast },
}));

import { showDesktopUpdateDownloadedToast } from "./desktop-update.toast";

describe("showDesktopUpdateDownloadedToast", () => {
  beforeEach(() => {
    testState.addToast.mockReset();
  });

  it("announces the downloaded update without external links", () => {
    showDesktopUpdateDownloadedToast();

    expect(testState.addToast).toHaveBeenCalledTimes(1);
    expect(testState.addToast).toHaveBeenCalledWith("Update has been downloaded");
  });
});
