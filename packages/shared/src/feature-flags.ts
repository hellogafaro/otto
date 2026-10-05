/**
 * Feature flags for controlling experimental or in-development features.
 */

import { getViewerUrl } from './branding.ts';

/** Safe accessor for process.env — returns undefined in browser/renderer contexts. */
function getEnv(key: string): string | undefined {
  if (typeof process !== 'undefined' && process.env) return process.env[key];
  return undefined;
}

function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (value == null) return undefined;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return undefined;
}

/**
 * Shared runtime detector for development/debug environments.
 *
 * Use this instead of app-specific debug flags (e.g., Electron main isDebugMode)
 * so behavior stays consistent across shared code and subprocess backends.
 */
export function isDevRuntime(): boolean {
  const nodeEnv = (getEnv('NODE_ENV') || '').toLowerCase();
  return nodeEnv === 'development' || nodeEnv === 'dev' || getEnv('OTTO_DEBUG') === '1';
}

/**
 * Runtime-evaluated check for developer feedback feature.
 * Explicit env override has precedence over dev-runtime defaults.
 */
export function isDeveloperFeedbackEnabled(): boolean {
  const override = parseBooleanEnv(getEnv('OTTO_FEATURE_DEVELOPER_FEEDBACK'));
  if (override !== undefined) return override;
  return isDevRuntime();
}

/**
 * Runtime-evaluated check for otto-cli integration.
 *
 * Defaults to disabled. Override with OTTO_FEATURE_CLI=1|0.
 */
export function isOttoCliEnabled(): boolean {
  const override = parseBooleanEnv(getEnv('OTTO_FEATURE_CLI'));
  if (override !== undefined) return override;
  return false;
}

/**
 * Runtime-evaluated check for embedded server settings page.
 *
 * Defaults to disabled. Override with OTTO_FEATURE_EMBEDDED_SERVER=1|0.
 */
export function isEmbeddedServerEnabled(): boolean {
  const override = parseBooleanEnv(getEnv('OTTO_FEATURE_EMBEDDED_SERVER'));
  if (override !== undefined) return override;
  return false;
}

/**
 * Runtime-evaluated check for Pages sharing (publication to the viewer host).
 *
 * Server-evaluated: the renderer learns it via `pages:getShareCapabilities`,
 * never from its own process.env. Gates publish/update only — unpublish stays
 * available regardless, so disabling the flag never strands a published page.
 *
 * Requires OTTO_VIEWER_URL (unset = sharing disabled). Publishing sends the page
 * bundle to that host, so it can also be switched off with
 * OTTO_FEATURE_PAGES_SHARING=0.
 */
export function isPagesSharingEnabled(): boolean {
  if (getViewerUrl() === undefined) return false;
  const override = parseBooleanEnv(getEnv('OTTO_FEATURE_PAGES_SHARING'));
  if (override !== undefined) return override;
  return true;
}

export const FEATURE_FLAGS = {
  /** Enable Opus 4.7 fast mode (speed:"fast" + beta header). 6x pricing. */
  fastMode: false,
  /**
   * Enable agent developer feedback tool.
   *
   * Defaults to enabled in explicit development runtimes; disabled otherwise.
   * Override with OTTO_FEATURE_DEVELOPER_FEEDBACK=1|0.
   */
  get developerFeedback(): boolean {
    return isDeveloperFeedbackEnabled();
  },
  /**
   * Enable otto CLI guidance and guardrails.
   *
   * Defaults to disabled. Override with OTTO_FEATURE_CLI=1|0.
   */
  get ottoCli(): boolean {
    return isOttoCliEnabled();
  },
  /**
   * Enable embedded server settings page.
   *
   * Defaults to disabled. Override with OTTO_FEATURE_EMBEDDED_SERVER=1|0.
   */
  get embeddedServer(): boolean {
    return isEmbeddedServerEnabled();
  },
  /**
   * Enable Pages sharing (publish to the viewer host).
   *
   * Requires OTTO_VIEWER_URL. Opt out with OTTO_FEATURE_PAGES_SHARING=0.
   */
  get pagesSharing(): boolean {
    return isPagesSharingEnabled();
  },
} as const;
