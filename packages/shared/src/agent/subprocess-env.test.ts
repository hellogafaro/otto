import { describe, it, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { buildClaudeSubprocessEnv } from './options.ts';
import { cleanEnv } from '../automations/utils.ts';

const SECRETS = {
  ENCRYPTION_KEY: 'k',
  BETTER_AUTH_SECRET: 's',
  OTTO_SERVER_TOKEN: 't',
  OTTO_OWNER_EMAIL: 'o@example.com',
  INFISICAL_TOKEN: 'i',
  AWS_SECRET_ACCESS_KEY: 'a',
  FOO_SECRET: 'f',
};

describe('agent subprocess env', () => {
  it('a shell started with the Claude subprocess env cannot print the server secrets', () => {
    const saved = { ...process.env };
    Object.assign(process.env, SECRETS, { ANTHROPIC_API_KEY: 'conn-key' });
    try {
      const env = buildClaudeSubprocessEnv({ OTTO_WORKSPACE_PATH: '/ws', ENCRYPTION_KEY: 'passed-anyway' });
      const out = spawnSync('sh', ['-c', 'env'], { env, encoding: 'utf8' });
      const lines = out.stdout.split('\n');
      const has = (name: string) => lines.some((l) => l.startsWith(`${name}=`));
      expect(has('PATH')).toBe(true);
      expect(has('HOME')).toBe(true);
      for (const name of Object.keys(SECRETS)) expect(has(name)).toBe(false);
      // The connection's own auth and per-session variables still arrive
      expect(lines).toContain('ANTHROPIC_API_KEY=conn-key');
      expect(lines).toContain('OTTO_WORKSPACE_PATH=/ws');
    } finally {
      for (const key of Object.keys(process.env)) delete process.env[key];
      Object.assign(process.env, saved);
    }
  });

  it('automation prompts cannot expand a server secret', () => {
    const saved = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = 'k';
    try {
      expect(cleanEnv().ENCRYPTION_KEY).toBeUndefined();
      expect(cleanEnv().PATH).toBeDefined();
    } finally {
      if (saved === undefined) delete process.env.ENCRYPTION_KEY;
      else process.env.ENCRYPTION_KEY = saved;
    }
  });
});
