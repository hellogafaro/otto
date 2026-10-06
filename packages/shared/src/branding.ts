/**
 * Centralized branding for Otto: the product name, the default agent's name and
 * the logo used by OAuth callback pages.
 */

/**
 * The product (the app and the company-level things). Copy and prompts never
 * type it: i18n strings use `{{product}}` (a default variable set in
 * `setupI18n`), code imports this. Static HTML (index.html titles,
 * manifest.json) cannot import it and keeps a literal.
 */
export const PRODUCT_NAME = 'Otto';

/** The product's "Backend" provider (the Pi connection type), as shown in pickers and settings. */
export const BACKEND_NAME = `${PRODUCT_NAME} Backend`;

/** No-reply address on the commit co-author trailer; the name before it is the agent's. */
export const PRODUCT_NOREPLY_EMAIL = 'noreply@hellogafaro.com';

/**
 * Display name of the DEFAULT agent. Only a fallback for when no agent name is
 * available; copy never names an agent (write "your agents", or use the name of
 * the agent in context).
 */
export const AGENT_DEFAULT_NAME = 'Otto';

export const OTTO_LOGO = [
  '  ████████   ████████████ ████████████   ████████',
  '████    ████     ████         ████     ████    ████',
  '████    ████     ████         ████     ████    ████',
  '████    ████     ████         ████     ████    ████',
  '  ████████       ████         ████       ████████',
] as const;

/** Logo as a single string for HTML templates */
export const OTTO_LOGO_HTML = OTTO_LOGO.map((line) => line.trimEnd()).join('\n');

/**
 * Base URL of the hosted read-only viewer (shared sessions and pages), from
 * `OTTO_VIEWER_URL`. Undefined when unset: sharing is disabled and nothing
 * calls the network. Read at call time so tests and late env changes apply.
 */
export function getViewerUrl(): string | undefined {
  const value = typeof process !== 'undefined' ? process.env?.OTTO_VIEWER_URL?.trim() : undefined;
  return value ? value.replace(/\/+$/, '') : undefined;
}
