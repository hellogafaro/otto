import { describe, it, expect } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { agentEnv, hostEnvMatching, isServerSecretEnvKey } from './agent-env.ts';

const SERVER_SECRETS = {
  ENCRYPTION_KEY: 'k',
  BETTER_AUTH_SECRET: 's',
  BETTER_AUTH_URL: 'u',
  OTTO_SERVER_TOKEN: 't',
  OTTO_WEBUI_WS_URL: 'w',
  OTTO_OWNER_EMAIL: 'o@example.com',
  OTTO_RPC_PORT: '1',
  INFISICAL_TOKEN: 'i',
  INFISICAL_CLIENT_ID: 'i',
};

describe('agentEnv', () => {
  it('passes the allow-list and drops everything else', () => {
    const env = agentEnv(undefined, {
      PATH: '/usr/bin',
      HOME: '/home/u',
      LC_ALL: 'C',
      XDG_CONFIG_HOME: '/c',
      https_proxy: 'http://p',
      OTTO_CONFIG_DIR: '/otto',
      FOO_SECRET: 'x',
      GITHUB_TOKEN: 'x',
      AWS_ACCESS_KEY_ID: 'x',
      OTTO_WH_SLACK_URL: 'x',
      RANDOM: 'x',
    });
    expect(env).toEqual({
      PATH: '/usr/bin',
      HOME: '/home/u',
      LC_ALL: 'C',
      XDG_CONFIG_HOME: '/c',
      https_proxy: 'http://p',
      OTTO_CONFIG_DIR: '/otto',
    });
  });

  it('drops every server secret from the host', () => {
    const env = agentEnv(undefined, { PATH: '/usr/bin', ...SERVER_SECRETS });
    expect(env).toEqual({ PATH: '/usr/bin' });
  });

  it('keeps explicit extras (connection auth, session paths) even when not allow-listed', () => {
    const env = agentEnv(
      { ANTHROPIC_API_KEY: 'sk', CLAUDE_CODE_OAUTH_TOKEN: 'tok', OTTO_SESSION_DIR: '/s', EMPTY: '', GONE: undefined },
      { PATH: '/usr/bin' },
    );
    expect(env.ANTHROPIC_API_KEY).toBe('sk');
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('tok');
    expect(env.OTTO_SESSION_DIR).toBe('/s');
    expect(env.EMPTY).toBe('');
    expect('GONE' in env).toBe(false);
  });

  it('extras override the host value', () => {
    expect(agentEnv({ HOME: '/x' }, { HOME: '/home/u' }).HOME).toBe('/x');
  });

  it('refuses the server secrets even when a caller passes them', () => {
    const env = agentEnv({ ...SERVER_SECRETS, MY_MCP_KEY: 'ok' }, { PATH: '/usr/bin' });
    expect(env).toEqual({ PATH: '/usr/bin', MY_MCP_KEY: 'ok' });
  });

  it('matches names case-insensitively', () => {
    expect(isServerSecretEnvKey('encryption_key')).toBe(true);
    expect(isServerSecretEnvKey('Better_Auth_Secret')).toBe(true);
    const env = agentEnv({ Encryption_Key: 'k' }, { Path: 'C:\\bin', SystemRoot: 'C:\\Windows', ProgramFiles: 'C:\\pf', 'ProgramFiles(x86)': 'C:\\pf86', encryption_key: 'k' });
    expect(env).toEqual({ Path: 'C:\\bin', SystemRoot: 'C:\\Windows', ProgramFiles: 'C:\\pf', 'ProgramFiles(x86)': 'C:\\pf86' });
  });

  it('hostEnvMatching picks only matching host vars', () => {
    expect(hostEnvMatching(/^ANTHROPIC_/, { ANTHROPIC_BASE_URL: 'u', PATH: 'p', X: undefined })).toEqual({ ANTHROPIC_BASE_URL: 'u' });
  });

  it('a spawned child sees the allow-list and none of the server secrets', () => {
    const saved = { ...process.env };
    Object.assign(process.env, SERVER_SECRETS, { FOO_SECRET: 'x', SOME_API_KEY: 'x' });
    try {
      const out = spawnSync(process.execPath, ['-e', 'console.log(JSON.stringify(process.env))'], {
        env: agentEnv(),
        encoding: 'utf8',
      });
      const seen = JSON.parse(out.stdout) as Record<string, string>;
      expect(seen.PATH).toBe(process.env.PATH ?? '');
      for (const key of [...Object.keys(SERVER_SECRETS), 'FOO_SECRET', 'SOME_API_KEY']) {
        expect(seen[key]).toBeUndefined();
      }
    } finally {
      for (const key of Object.keys(process.env)) delete process.env[key];
      Object.assign(process.env, saved);
    }
  });
});
