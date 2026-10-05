import { debug } from "../utils/debug";

/**
 * Base URL of the release host (`OTTO_UPDATE_URL`): serves `/latest` (version
 * JSON and the electron-updater feed) and `/{version}/manifest.json`.
 * Undefined when unset: update checks are disabled and make no network calls.
 */
export function getUpdateUrl(): string | undefined {
  const value = typeof process !== 'undefined' ? process.env?.OTTO_UPDATE_URL?.trim() : undefined;
  return value ? value.replace(/\/+$/, '') : undefined;
}

export async function getLatestVersion(): Promise<string | null> {
    const versionsUrl = getUpdateUrl();
    if (!versionsUrl) return null;
    try {
      const response = await fetch(`${versionsUrl}/latest`);
      const data = await response.json();
      const version = (data as { version?: string }).version;
      if (typeof version !== 'string') {
        debug('[manifest] Latest version is not a valid string');
        return null;
      }
      return version ?? null;
    } catch (error) {
      debug(`[manifest] Failed to get latest version: ${error}`);
    }
    return null;
}

export async function getManifest(version: string): Promise<VersionManifest | null> {
    const versionsUrl = getUpdateUrl();
    if (!versionsUrl) return null;
    try {
        const url = `${versionsUrl}/${version}/manifest.json`;
        debug(`[manifest] Getting manifest for version: ${url}`);
        const response = await fetch(url);
        const data = await response.json();
        return data as VersionManifest;
    } catch (error) {
        debug(`[manifest] Failed to get manifest: ${error}`);
    }
    return null;
}


export interface BinaryInfo {
  url: string;
  sha256: string;
  size: number;
  filename?: string;
}

export interface VersionManifest {
  version: string;
  build_time: string;
  build_timestamp: number;
  binaries: Record<string, BinaryInfo>;
}
