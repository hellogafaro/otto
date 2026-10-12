import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const testState = vi.hoisted(() => ({
  addToast: vi.fn(),
}));

vi.mock("./ui/toast", () => ({
  toastManager: { add: testState.addToast },
}));

import { showDesktopUpdateDownloadedToast } from "./desktopUpdate.toast";

describe("showDesktopUpdateDownloadedToast", () => {
  beforeEach(() => {
    testState.addToast.mockReset();
  });

  it("announces the downloaded update without external links", () => {
    showDesktopUpdateDownloadedToast();

    expect(testState.addToast).toHaveBeenCalledTimes(1);
    expect(testState.addToast).toHaveBeenCalledWith({
      type: "success",
      title: "Update downloaded",
      description: "Restart the app from the update button to install it.",
    });
  });
});
