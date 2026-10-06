import { afterEach, describe, expect, it, mock } from 'bun:test';
import { getViewerUrl } from '../branding.ts';
import { getLatestVersion, getManifest, getUpdateUrl } from '../version/manifest.ts';

const ENV_KEYS = ['OTTO_VIEWER_URL', 'OTTO_UPDATE_URL'] as const;
const ORIGINAL = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (ORIGINAL[key] === undefined) delete process.env[key];
    else process.env[key] = ORIGINAL[key];
  }
});

function unsetAll() {
  for (const key of ENV_KEYS) delete process.env[key];
}

describe('OTTO_VIEWER_URL', () => {
  it('is undefined when unset or blank, and trims trailing slashes when set', () => {
    unsetAll();
    expect(getViewerUrl()).toBeUndefined();
    process.env.OTTO_VIEWER_URL = '   ';
    expect(getViewerUrl()).toBeUndefined();
    process.env.OTTO_VIEWER_URL = 'https://viewer.test//';
    expect(getViewerUrl()).toBe('https://viewer.test');
  });
});

describe('OTTO_UPDATE_URL', () => {
  it('unset: no update host and no network calls for version lookups', async () => {
    unsetAll();
    const originalFetch = globalThis.fetch;
    const fetchMock = mock(() => Promise.resolve(new Response('{}')));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      expect(getUpdateUrl()).toBeUndefined();
      expect(await getLatestVersion()).toBeNull();
      expect(await getManifest('1.0.0')).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
