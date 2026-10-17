import type { DesktopUpdateChannel } from "@otto/contracts";

const BETA_VERSION_PATTERN = /^[^-+]+-beta\.\d{8}\.\d+$/;

export function resolveDefaultDesktopUpdateChannel(appVersion: string): DesktopUpdateChannel {
  return BETA_VERSION_PATTERN.test(appVersion) ? "beta" : "latest";
}
