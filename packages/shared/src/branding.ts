/**
 * Centralized branding assets for Otto
 * Used by OAuth callback pages
 */

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
