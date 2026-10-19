import { isMacPlatform } from "../../lib/utils";
import { isHashRouterHref, resolveInAppRoute, safeWebUrl } from "../../app-routes";

export interface DesktopLinkClick {
  readonly button: number;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly platform: string;
}

export type DesktopLinkAction =
  | { readonly type: "ignore" }
  | { readonly type: "same-tab"; readonly route: string }
  | { readonly type: "new-tab"; readonly route: string }
  | { readonly type: "external"; readonly url: string };

/** ⌘-click on Mac, Ctrl-click elsewhere, or a middle-click. Shift opens a window, which we don't. */
export function isDesktopNewTabClick(click: DesktopLinkClick): boolean {
  if (click.altKey || click.shiftKey) return false;

  if (click.button === 1) return true;

  const mac = isMacPlatform(click.platform);

  return mac ? click.metaKey && !click.ctrlKey : click.ctrlKey && !click.metaKey;
}

/**
 * Otto: What a click on an anchor should do in the desktop app. In-app links
 * open in the current tab, or a new one with ⌘ or a middle-click. External
 * web links open in the system browser. Hash-router links keep their own click.
 */
export function desktopLinkAction(input: {
  readonly href: string | null;
  readonly baseHref: string;
  readonly target: string;
  readonly download: boolean;
  readonly editable: boolean;
  readonly electron: boolean;
  readonly click: DesktopLinkClick;
}): DesktopLinkAction {
  if (input.download || input.editable || !input.href) return { type: "ignore" };

  if (input.click.button !== 0 && input.click.button !== 1) return { type: "ignore" };

  if (input.click.altKey) return { type: "ignore" };

  const route = resolveInAppRoute(input.href, input.baseHref);
  const newTab = isDesktopNewTabClick(input.click);

  if (route) {
    if (newTab) return { type: "new-tab", route };

    if (input.click.button !== 0 || input.click.shiftKey) return { type: "ignore" };

    if (input.target === "_blank" || (input.electron && !isHashRouterHref(input.href))) {
      return { type: "same-tab", route };
    }

    return { type: "ignore" };
  }

  if (!input.electron || input.click.shiftKey) return { type: "ignore" };

  const external = safeWebUrl(input.href, input.baseHref);

  return external ? { type: "external", url: external } : { type: "ignore" };
}

/**
 * Back and forward. ⌘ < and ⌘ > are the asked-for keys (< needs Shift on a US
 * keyboard, so Shift belongs to the symbol). ⌘ [ and ⌘ ] are the Mac browser keys.
 */
export function desktopHistoryShortcut(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
  platform: string,
): "back" | "forward" | null {
  if (event.altKey) return null;

  const mac = isMacPlatform(platform);
  const mod = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;

  if (!mod) return null;

  if (event.key === "<" || (event.key === "[" && !event.shiftKey)) return "back";

  if (event.key === ">" || (event.key === "]" && !event.shiftKey)) return "forward";

  return null;
}
