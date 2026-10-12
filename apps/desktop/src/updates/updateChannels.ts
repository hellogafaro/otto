import type { DesktopUpdateChannel } from "@otto/contracts";

export function resolveDefaultDesktopUpdateChannel(_appVersion: string): DesktopUpdateChannel {
  return "latest";
}
