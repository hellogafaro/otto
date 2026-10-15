// Otto: The desktop app signs in with an organization account like the web. Its renderer runs
// on its own origin, so it keeps the account's bearer session instead of a cookie.
const DESKTOP_SESSION_TOKEN_KEY = "otto:desktop-session-token";

function desktopStorage(): Storage | null {
  if (typeof window === "undefined" || !window.desktopBridge) return null;

  return window.localStorage;
}

export function readDesktopSessionToken(): string | null {
  return desktopStorage()?.getItem(DESKTOP_SESSION_TOKEN_KEY) ?? null;
}

export function storeDesktopSessionToken(token: string | null): void {
  const storage = desktopStorage();

  if (!storage) return;

  if (token) {
    storage.setItem(DESKTOP_SESSION_TOKEN_KEY, token);

    return;
  }

  storage.removeItem(DESKTOP_SESSION_TOKEN_KEY);
}

export function readDesktopPrimaryBearerToken(): Promise<string | null> {
  return Promise.resolve(readDesktopSessionToken());
}
