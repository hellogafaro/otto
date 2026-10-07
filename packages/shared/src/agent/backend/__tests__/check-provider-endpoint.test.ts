/**
 * The live check of a stored API connection, against a local fake provider.
 */
import { afterAll, describe, expect, it } from 'bun:test';
import { checkProviderEndpoint } from '../internal/pi-runtime.ts';

const seen: Array<{ path: string; headers: Headers }> = [];
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    seen.push({ path: url.pathname, headers: req.headers });
    if (url.pathname.startsWith('/slow')) await Bun.sleep(1_000);
    if (url.pathname.startsWith('/denied') || (req.headers.get('authorization') ?? '') === 'Bearer bad') return new Response('secret body', { status: 401 });
    if (url.pathname.startsWith('/forbidden')) return new Response('', { status: 403 });
    if (url.pathname.startsWith('/missing')) return new Response('', { status: 404 });
    return Response.json({ data: [] });
  },
});
afterAll(() => server.stop(true));

const origin = `http://127.0.0.1:${server.port}`;
const custom = (path: string, api: 'openai-completions' | 'anthropic-messages' = 'openai-completions') =>
  ({ type: 'custom', authType: 'api_key_with_endpoint', baseUrl: `${origin}${path}`, customEndpoint: { api } }) as const;

describe('checkProviderEndpoint', () => {
  it('200: succeeds with a Bearer key on <base>/models', async () => {
    seen.length = 0;
    expect(await checkProviderEndpoint(custom('/v1'), 'k1')).toEqual({ success: true });
    expect(seen[0]!.path).toBe('/v1/models');
    expect(seen[0]!.headers.get('authorization')).toBe('Bearer k1');
  });

  it('an Anthropic endpoint sends x-api-key and anthropic-version to /v1/models', async () => {
    seen.length = 0;
    expect(await checkProviderEndpoint(custom('', 'anthropic-messages'), 'k2')).toEqual({ success: true });
    expect(seen[0]!.path).toBe('/v1/models');
    expect(seen[0]!.headers.get('x-api-key')).toBe('k2');
    expect(seen[0]!.headers.get('anthropic-version')).toBeTruthy();
    expect(seen[0]!.headers.get('authorization')).toBeNull();
  });

  it('401 and 403: Invalid credentials, without the response body', async () => {
    for (const path of ['/denied', '/forbidden']) {
      expect(await checkProviderEndpoint(custom(path), 'k')).toEqual({ success: false, error: 'Invalid credentials' });
    }
  });

  it('404 on the connection\'s own URL fails; any other status is reported by number', async () => {
    expect(await checkProviderEndpoint(custom('/missing'), 'k')).toEqual({ success: false, error: 'Provider API returned 404' });
  });

  it('a keyless local endpoint is asked without credentials', async () => {
    seen.length = 0;
    expect(await checkProviderEndpoint({ ...custom('/v1'), authType: 'none' }, null)).toEqual({ success: true });
    expect(seen[0]!.headers.get('authorization')).toBeNull();
  });

  it('timeout: a message the test mapping reads as timed out', async () => {
    const result = await checkProviderEndpoint(custom('/slow'), 'k', 100);
    expect(result).toEqual({ success: false, error: 'Request timed out' });
  });

  it('dead port: fetch failed', async () => {
    const dead = Bun.serve({ port: 0, fetch: () => new Response('') });
    const port = dead.port;
    await dead.stop(true);
    const result = await checkProviderEndpoint({ ...custom(''), baseUrl: `http://127.0.0.1:${port}` }, 'k');
    expect(result).toEqual({ success: false, error: 'fetch failed' });
  });

  it('no network check for OAuth, IAM or a missing key', async () => {
    expect(await checkProviderEndpoint({ type: 'openai-codex', authType: 'oauth' }, 'k')).toBeNull();
    expect(await checkProviderEndpoint({ type: 'amazon-bedrock', authType: 'iam_credentials' }, null)).toBeNull();
    expect(await checkProviderEndpoint(custom('/v1'), null)).toEqual({ success: false, error: 'No credentials configured' });
  });
});
