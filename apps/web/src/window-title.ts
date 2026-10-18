import type { MessageKey } from "@otto/client-runtime/i18n";

const PAGE_LABELS: ReadonlyArray<readonly [string, MessageKey]> = [
  ["/settings", "Settings"],
  ["/notifications", "Notifications"],
  ["/tasks", "Tasks"],
  ["/projects", "Projects"],
  ["/routines", "Routines"],
  ["/library", "Library"],
  ["/customize", "Customize"],
  ["/plugins", "Apps"],
  ["/login", "Sign in"],
  ["/setup", "Set up"],
  ["/reset-password", "Reset"],
  ["/invite", "Sign in"],
];

/** Match route boundaries so an unknown path cannot inherit a similarly named page. */
export function resolvePageLabel(pathname: string): MessageKey {
  if (pathname === "/") return "Home";

  return (
    PAGE_LABELS.find(([base]) => pathname === base || pathname.startsWith(`${base}/`))?.[1] ??
    "Chats"
  );
}

export function resolveWindowTitle(input: {
  readonly pageTitle?: string | null | undefined;
  readonly pageLabel: string;
  readonly appName: string;
}): string {
  return `${input.pageTitle?.trim() || input.pageLabel} | ${input.appName}`;
}
