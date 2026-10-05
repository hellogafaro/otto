import { afterEach, describe, expect, it, mock } from 'bun:test';
import { getViewerUrl } from '../branding.ts';
import { isPagesSharingEnabled } from '../feature-flags.ts';
import { PagePublisher, resolvePagesShareApiBaseUrl } from '../pages/publisher.ts';
import { getLatestVersion, getManifest, getUpdateUrl } from '../version/manifest.ts';

const ENV_KEYS = ['OTTO_VIEWER_URL', 'OTTO_FEATURE_PAGES_SHARING', 'OTTO_UPDATE_URL'] as const;
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

  it('disables Pages sharing when unset, even with the flag forced on', () => {
    unsetAll();
    process.env.OTTO_FEATURE_PAGES_SHARING = '1';
    expect(isPagesSharingEnabled()).toBe(false);
    expect(resolvePagesShareApiBaseUrl()).toBeUndefined();
  });

  it('enables Pages sharing against the configured host, unless the flag opts out', () => {
    unsetAll();
    process.env.OTTO_VIEWER_URL = 'https://viewer.test';
    expect(isPagesSharingEnabled()).toBe(true);
    expect(resolvePagesShareApiBaseUrl()).toBe('https://viewer.test/p/api');
    process.env.OTTO_FEATURE_PAGES_SHARING = '0';
    expect(isPagesSharingEnabled()).toBe(false);
  });

  it('PagePublisher refuses to publish and never touches the network when unset', async () => {
    unsetAll();
    const fetchFn = mock(() => Promise.resolve(new Response('{}')));
    const publisher = new PagePublisher({
      tokenStore: { get: async () => null, set: async () => {}, delete: async () => false },
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await expect(publisher.publish('/tmp/none', 'ws', 'page', { includeData: false })).rejects.toThrow(
      'PAGE_SHARING_DISABLED',
    );
    expect(fetchFn).not.toHaveBeenCalled();
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
