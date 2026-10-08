import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgent } from '../../agents/index.ts';
import { UNATTENDED_RUN_INSTRUCTIONS } from '../../agents/instructions.ts';
import { createConnection } from '../../connections/index.ts';
import { DockerComputer, collect } from '../../computer/index.ts';
import { ChatComputer } from '../../computer/chat-computer.ts';
import { initDb } from '../../db/index.ts';
import { skills } from '../../skills/schema.ts';
import { COMPUTER_TOOL_GUIDANCE, buildAgentTurn, getAgentComputer, getAgentTurn } from '../agent-turn.ts';
import { resolveBackendContext } from '../connection-context.ts';

const run = (extra: { skills?: string[]; sources?: string[] } = {}) => ({
  agent: { id: 'agent1', title: 'Scout' },
  workspaceInstructions: 'Use British spelling.',
  agentInstructions: 'Be brief.',
  skills: extra.skills ?? [],
  sources: extra.sources ?? [],
});
const skillRows = [
  { id: 'sk1', slug: 'deploy', title: 'Deploy', description: 'Ship it' },
  { id: 'sk2', slug: 'review', title: 'Review', description: '' },
];
const sourceRows = [{ id: 'so1', slug: 'linear' }, { id: 'so2', slug: 'github' }];
const connected = [{ slug: 'linear', title: 'Linear', description: 'Issues' }, { slug: 'github', title: 'GitHub' }];
const fakeComputer = { id: 'box', ensureRunning: async () => {}, exec: () => { throw new Error('unused'); }, stop: async () => {} };

describe('buildAgentTurn', () => {
  it('[] = every skill and source; the skills are listed at the workspace folder on the host', () => {
    const turn = buildAgentTurn({ run: run(), skills: skillRows, sources: sourceRows, connected, workspaceRootPath: '/ws', runMode: 'attended', computer: null });
    expect(turn.sourceSlugs).toBeNull();
    expect(turn.skills).toEqual([
      { name: 'deploy', description: 'Ship it', filePath: '/ws/skills/deploy/SKILL.md' },
      { name: 'review', description: 'Review', filePath: '/ws/skills/review/SKILL.md' },
    ]);
    expect(turn.skillsDir).toBe('/ws/skills');
    expect(turn.instructions).toContain('<otto_workspace>\nUse British spelling.\n</otto_workspace>');
    expect(turn.instructions).toContain('<otto_agent name="Scout">\nBe brief.\n</otto_agent>');
    expect(turn.instructions).toContain('- linear: Linear - Issues\n- github: GitHub');
    expect(turn.instructions).not.toContain('<otto_tools>');
    expect(turn.instructions).not.toContain('<otto_run');
  });

  it("the agent's lists (ids or slugs) filter skills, sources and connected_mcps; a box reads skills at /skills", () => {
    const turn = buildAgentTurn({
      run: run({ skills: ['sk2'], sources: ['linear'] }), skills: skillRows, sources: sourceRows, connected,
      workspaceRootPath: '/ws', runMode: 'unattended', computer: fakeComputer,
    });
    expect(turn.skills).toEqual([{ name: 'review', description: 'Review', filePath: '/skills/review/SKILL.md' }]);
    expect(turn.sourceSlugs).toEqual(['linear']);
    expect(turn.instructions).toContain('<connected_mcps>');
    expect(turn.instructions).toContain('- linear: Linear');
    expect(turn.instructions).not.toContain('github');
    expect(turn.instructions).toContain(`<otto_tools>\n${COMPUTER_TOOL_GUIDANCE}\n</otto_tools>`);
    expect(turn.instructions.endsWith(`<otto_run mode="unattended">\n${UNATTENDED_RUN_INSTRUCTIONS}\n</otto_run>`)).toBe(true);
    expect(turn.computer).toBe(fakeComputer);
  });
});

describe('getAgentTurn (database)', () => {
  it("reads the chat's agent with the workspace's skill rows; a deleted agent falls back to the default", () => {
    const workspaceId = 'wsturn1';
    const agent = createAgent({ workspaceId, title: 'Scout', provider: 'anthropic', createdBy: 'user:aaaaaaaaaaaa', skills: ['deploy'] });
    const now = new Date();
    initDb().insert(skills).values(skillRows.map((row) => ({ ...row, workspaceId, hash: 'h', createdBy: 'user:aaaaaaaaaaaa', createdAt: now, updatedAt: now }))).run();
    const root = mkdtempSync(join(tmpdir(), 'otto-turn-'));
    try {
      for (const agentId of [agent.id, 'gone00000000']) {
        const turn = getAgentTurn({ agentId, workspaceId, workspaceRootPath: root, runMode: 'attended' })!;
        expect(turn.skills).toEqual([{ name: 'deploy', description: 'Ship it', filePath: join(root, 'skills', 'deploy', 'SKILL.md') }]);
        expect(turn.sourceSlugs).toBeNull();
        expect(turn.computer).toBeNull();
      }
      expect(getAgentTurn({ workspaceId: 'nowhere', workspaceRootPath: root, runMode: 'attended' })).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("the agent's provider picks the creator's connection", () => {
  it('user, then workspace, then install; none is a clear error; the agent model is the default', () => {
    const where = { workspaceId: 'wsconn1', userId: 'bbbbbbbbbbbb' };
    createConnection({ slug: 'm1-openai', type: 'openai', authType: 'api_key', title: 'OpenAI' });
    createConnection({ slug: 'm1-ws-openrouter', scope: 'workspace:wsconn1', type: 'openrouter', authType: 'api_key', title: 'OpenRouter' });
    const scout = { title: 'Scout', provider: 'openai', model: 'gpt-4.1' };

    const install = resolveBackendContext({ where, agent: scout });
    expect(install.connection?.slug).toBe('m1-openai');
    expect(install.connection?.scope).toBe('install');
    expect(install.resolvedModel).toBe('gpt-4.1');
    expect(install.missingConnection).toBeUndefined();

    createConnection({ slug: 'm1-openai', scope: 'workspace:wsconn1', type: 'openai', authType: 'api_key', title: 'Shared OpenAI' });
    expect(resolveBackendContext({ where, agent: scout }).connection?.scope).toBe('workspace:wsconn1');
    createConnection({ slug: 'm1-openai', scope: 'user:bbbbbbbbbbbb', type: 'openai', authType: 'api_key', title: 'My OpenAI', models: ['gpt-4.1', 'gpt-4.1-mini'], defaultModel: 'gpt-4.1' });
    createConnection({ slug: 'm1-foreign-openai', scope: 'user:foreign-user', type: 'openai', authType: 'api_key', title: 'Foreign OpenAI' });
    expect(resolveBackendContext({ where, agent: scout }).connection?.scope).toBe('user:bbbbbbbbbbbb');
    expect(resolveBackendContext({ where, agent: scout, sessionConnectionSlug: 'm1-foreign-openai' }).connection?.scope).toBe('user:bbbbbbbbbbbb');
    // A chat locked to a connection of another provider runs on the agent's provider.
    expect(resolveBackendContext({ where, sessionConnectionSlug: 'm1-ws-openrouter', agent: scout }).connection?.scope).toBe('user:bbbbbbbbbbbb');
    // The chat's own model wins over the agent's.
    expect(resolveBackendContext({ where, agent: scout, managedModel: 'gpt-4.1-mini' }).resolvedModel).toBe('gpt-4.1-mini');
    expect(resolveBackendContext({ where, agent: { title: 'Scout', provider: 'openai' } }).resolvedModel).toBe('gpt-4.1');
    expect(resolveBackendContext({ where, agent: scout, managedModel: 'not-in-account-catalog' }).resolvedModel).toBe('gpt-4.1');

    const none = resolveBackendContext({ where, agent: { title: 'Scout', provider: 'anthropic' } });
    expect(none.connection).toBeNull();
    expect(none.missingConnection).toBe('Connect Anthropic to talk to Scout.');

    // Without an agent (mini sessions) the old order applies.
    expect(resolveBackendContext({ where, sessionConnectionSlug: 'm1-ws-openrouter' }).connection?.slug).toBe('m1-ws-openrouter');
  });
});

describe("the agent's computer", () => {
  const FAKE = join(import.meta.dir, '..', '..', 'computer', '__tests__', 'fake-docker.sh');
  let dir: string;
  let savedPath: string | undefined;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fake-docker-'));
    mkdirSync(join(dir, 'bin'));
    copyFileSync(FAKE, join(dir, 'bin', 'docker'));
    chmodSync(join(dir, 'bin', 'docker'), 0o755);
    savedPath = process.env.PATH;
    process.env.PATH = `${join(dir, 'bin')}:${savedPath}`;
    process.env.FAKE_DOCKER_DIR = dir;
  });
  afterEach(() => {
    process.env.PATH = savedPath;
    delete process.env.FAKE_DOCKER_DIR;
    rmSync(dir, { recursive: true, force: true });
  });
  const verbs = () => (existsSync(join(dir, 'calls')) ? readFileSync(join(dir, 'calls'), 'utf8').split('\n--\n').filter(Boolean).map((c) => c.split('\n')[0]) : []);

  it('none unless OTTO_COMPUTER=docker; one box per agent with the skills mount', () => {
    expect(getAgentComputer('agent1', '/ws', 'ws1', undefined)).toBeNull();
    expect(getAgentComputer('agent1', '/ws', 'ws1', 'local')).toBeNull();
    const box = getAgentComputer('agent1', '/ws', 'ws1', 'docker');
    expect(box).toBeInstanceOf(DockerComputer);
    expect(getAgentComputer('agent1', '/ws', 'ws1', 'docker')).toBe(box);
  });

  it('a box starts at the first tool call, then runs the command (fake docker)', async () => {
    const box = new ChatComputer({ workspaceId: 'ws1', agentId: 'agentbox0001', chatId: 'chat1' });
    expect(verbs()).toEqual([]);
    await box.ensureRunning();
    const result = await collect(box.exec(['fake-echo', 'hello']));
    expect(verbs()).toContain('run');
    expect(verbs().indexOf('run')).toBeLessThan(verbs().indexOf('exec'));
    expect(result.stdout).toBe('hello\n');
    expect(result.code).toBe(0);
    const calls = readFileSync(join(dir, 'calls'), 'utf8').split('\n--\n').map((call) => call.split('\n'));
    const allocation = calls.find((args) => args[0] === 'run')!;
    expect(allocation).toContain('--network');
    expect(allocation[allocation.indexOf('--network') + 1]).toBe('none');
    expect(allocation).not.toContain('--add-host');
    expect(allocation).not.toContain('-p');
    expect(allocation.filter((arg) => arg.endsWith(':ro'))).toEqual([]);
    expect(calls.find((args) => args[0] === 'exec')).toContain('/home/agent/chats/chat1');
    expect(() => box.exec(['fake-echo'], { user: 'root' })).toThrow('user or environment');
    expect(() => box.exec(['fake-echo'], { env: { PRIVATE: 'fixture' } })).toThrow('user or environment');
    const aborted = new AbortController();
    aborted.abort();
    expect(() => box.exec(['fake-echo'], { signal: aborted.signal })).toThrow();
    await expect(box.hostPort(9223)).rejects.toThrow('no host or peer network access');
  });
});
