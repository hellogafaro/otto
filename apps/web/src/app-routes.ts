/**
 * Otto: Routes the desktop app can open in a tab. File paths such as /Users/…
 * are not routes, even though they share the otto:// origin once resolved.
 */

const APP_SCHEMES = new Set(["otto:", "otto-dev:"]);

const APP_ROUTE_PREFIXES = [
  "/bots",
  "/chats",
  "/customize",
  "/draft",
  "/groups",
  "/invite",
  "/library",
  "/login",
  "/notifications",
  "/plugins",
  "/projects",
  "/reset-password",
  "/routines",
  "/settings",
  "/setup",
  "/tasks",
] as const;

function routePathname(path: string): string {
  return path.split(/[?#]/)[0] ?? path;
}

/** True when the path is a page the app itself renders, not a filesystem path. */
export function isAppRoutePath(path: string): boolean {
  const pathname = routePathname(path);

  if (pathname === "/" || pathname === "") return true;

  if (pathname === "/s" || pathname.startsWith("/s/")) return true;

  return APP_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function appRouteFromUrl(url: URL): string | null {
  if (url.hash.startsWith("#/")) {
    const route = url.hash.slice(1);

    return isAppRoutePath(route) ? route : null;
  }

  // A #fragment stays on the page. It is not a route.
  if (url.hash.length > 0) return null;

  const route = `${url.pathname}${url.search}`;

  return isAppRoutePath(route) ? route : null;
}

function isAppOrigin(url: URL, base: URL): boolean {
  if (APP_SCHEMES.has(url.protocol)) return url.hostname === "app";

  // Non-special schemes such as otto: report origin "null", so compare the host.
  if (url.origin === "null" || base.origin === "null") {
    return url.protocol === base.protocol && url.host === base.host;
  }

  return url.origin === base.origin;
}

/**
 * The in-app route an href opens, or null when it is external, a file, or a fragment.
 * `baseHref` is the page the link was clicked on, so a relative /tasks/id resolves.
 */
export function resolveInAppRoute(href: string, baseHref: string): string | null {
  const trimmed = href.trim();

  if (!trimmed || /^(javascript|data|mailto|blob):/i.test(trimmed)) return null;

  let url: URL;
  let base: URL;

  try {
    base = new URL(baseHref);
    url = new URL(trimmed, baseHref);
  } catch {
    return null;
  }

  if (!isAppOrigin(url, base)) return null;

  return appRouteFromUrl(url);
}

/** True for a markdown href that names an app page, without resolving it. */
export function isAppRouteHref(href: string): boolean {
  const value = href.trim();

  if (value.startsWith("#/")) return isAppRoutePath(value.slice(1));

  if (value.startsWith("/") && !value.startsWith("//")) return isAppRoutePath(value);

  try {
    const url = new URL(value);

    if (!APP_SCHEMES.has(url.protocol) || url.hostname !== "app") return false;

    return appRouteFromUrl(url) !== null;
  } catch {
    return false;
  }
}

/** A hash-router href the SPA already handles on a plain click, such as #/tasks/id. */
export function isHashRouterHref(href: string): boolean {
  const trimmed = href.trim();

  if (trimmed.startsWith("#/")) return isAppRoutePath(trimmed.slice(1));

  try {
    const url = new URL(trimmed);

    return (
      url.hash.startsWith("#/") &&
      (url.pathname === "/" || url.pathname === "") &&
      isAppRoutePath(url.hash.slice(1))
    );
  } catch {
    return false;
  }
}

/** An http(s) URL safe to hand to the system browser, or null. */
export function safeWebUrl(href: string, baseHref: string): string | null {
  try {
    const url = new URL(href, baseHref);

    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}
