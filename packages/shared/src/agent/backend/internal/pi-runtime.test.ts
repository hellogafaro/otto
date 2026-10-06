import { describe, expect, it } from 'bun:test';
import { buildPiRuntime } from './pi-runtime.ts';

describe('buildPiRuntime custom endpoint models', () => {
  it('preserves explicit per-model supportsImages values', () => {
    const runtime = buildPiRuntime(
      {
        slug: 'custom-endpoint',
        name: 'Custom Endpoint',
        type: 'custom',
        authType: 'api_key_with_endpoint',
        baseUrl: 'http://127.0.0.1:11111/v1',
        customEndpoint: { api: 'anthropic-messages', supportsImages: true },
        models: [
          { id: 'vision-model', contextWindow: 262_144, supportsImages: true },
          { id: 'text-only-model', supportsImages: false },
          { id: 'plain-model' },
        ],
        createdAt: Date.now(),
      } as any,
      {
        piServerPath: '/tmp/pi-agent-server.js',
        interceptorBundlePath: '/tmp/interceptor.cjs',
        nodeRuntimePath: '/usr/bin/node',
      },
    );

    expect(runtime.paths).toEqual({ piServer: '/tmp/pi-agent-server.js', interceptor: '/tmp/interceptor.cjs', node: '/usr/bin/node' });
    expect(runtime.customModels).toEqual([
      { id: 'vision-model', contextWindow: 262_144, supportsImages: true },
      { id: 'text-only-model', supportsImages: false },
      'plain-model',
    ]);
  });
});
