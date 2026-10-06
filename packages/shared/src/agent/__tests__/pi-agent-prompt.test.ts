import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PiAgent } from '../pi-agent.ts';
import type { BackendConfig } from '../backend/types.ts';
import type { AgentTurn } from '../agent-turn.ts';

const agents: PiAgent[] = [];
const dirs: string[] = [];
afterEach(() => {
  for (const agent of agents.splice(0)) agent.destroy();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeAgent(extra: Partial<BackendConfig> = {}): any {
  const root = mkdtempSync(join(tmpdir(), 'pi-agent-prompt-'));
  dirs.push(root);
  const agent = new PiAgent({
    isHeadless: true,
    workspace: { id: 'ws', name: 'Test', rootPath: root } as any,
    session: { id: 'chat-1', workspaceRootPath: root, createdAt: 0, lastUsedAt: 0 } as any,
    ...extra,
  });
  agents.push(agent);
  (agent as any).ensureSubprocess = async () => {};
  return agent;
}

/** Runs one turn and returns the `prompt` message the subprocess got. */
async function promptOf(agent: any, text: string): Promise<{ message: string; systemPrompt: string }> {
  let prompt: any;
  agent.send = (msg: any) => {
    if (msg.type !== 'prompt') return;
    prompt = msg;
    agent.eventQueue.complete();
  };
  for await (const _ of agent.chatImpl(text)) { /* drain */ }
  return prompt;
}

const turnOf = (extra: Partial<AgentTurn> = {}): AgentTurn => ({
  instructions: '', sourceSlugs: null, skills: [], skillsDir: '/ws/skills', computer: null, ...extra,
});

/** Runs one turn through `chat()` (the agent's turn is read there) and returns the `prompt` message. */
async function chatPrompt(agent: any, text: string): Promise<any> {
  let prompt: any;
  agent.send = (msg: any) => {
    if (msg.type !== 'prompt') return;
    prompt = msg;
    agent.eventQueue.complete();
  };
  for await (const _ of agent.chat(text)) { /* drain */ }
  return prompt;
}

describe('PiAgent prompt', () => {
  it('a chat Pi holds no history of starts its first turn from a summary of its messages, once', async () => {
    const agent = makeAgent({
      recoverHistory: true,
      getRecoveryMessages: () => [{ type: 'user', content: 'What is the plan?' }, { type: 'assistant', content: 'Ship B2 first.' }],
    });
    const first = await promptOf(agent, 'And then?');
    expect(first.message).toContain('<conversation_recovery>');
    expect(first.message).toContain('[Assistant]: Ship B2 first.');
    expect(first.message.endsWith('And then?')).toBe(true);
    const second = await promptOf(agent, 'Thanks');
    expect(second.message).not.toContain('<conversation_recovery>');
  });

  it('without recoverHistory nothing is prepended', async () => {
    const agent = makeAgent({ getRecoveryMessages: () => [{ type: 'user', content: 'old' }] });
    expect((await promptOf(agent, 'hi')).message).not.toContain('<conversation_recovery>');
  });

  it("appends the agent's instructions and lists its skills, read each turn", async () => {
    let turn: AgentTurn | null = turnOf({
      instructions: '<otto_agent name="Scout">\nBe brief.\n</otto_agent>',
      skills: [{ name: 'deploy', description: 'Ship it', filePath: '/ws/skills/deploy/SKILL.md' }],
    });
    const agent = makeAgent({ getAgentTurn: () => turn });
    const first = await chatPrompt(agent, 'hi');
    expect(first.systemPrompt.endsWith(turn!.instructions)).toBe(true);
    expect(first.systemPrompt.length).toBeGreaterThan(turn!.instructions.length);
    expect(first.skills).toEqual(turn!.skills);
    turn = null;
    const second = await chatPrompt(agent, 'again');
    expect(second.systemPrompt).not.toContain('otto_agent');
    expect(second.skills).toBeUndefined();
  });

  it('a [skill:slug] mention is read where the turn reads skills (the /skills mount in a box)', async () => {
    const agent = makeAgent({ getAgentTurn: () => turnOf({ skillsDir: '/skills' }) });
    const root = agent.config.workspace.rootPath;
    mkdirSync(join(root, 'skills', 'deploy'), { recursive: true });
    writeFileSync(join(root, 'skills', 'deploy', 'SKILL.md'), '---\nname: Deploy\ndescription: Ship it\n---\nbody');
    const prompt = await chatPrompt(agent, '[skill:deploy] ship v2');
    expect(prompt.message).toContain('- /skills/deploy/SKILL.md (skill: deploy)');
    expect(prompt.message).not.toContain(join(root, 'skills'));
  });

  it("the agent's computer runs the turn's tools", async () => {
    const computer = { id: 'box', ensureRunning: async () => {}, exec: () => { throw new Error('unused'); }, stop: async () => {} };
    const agent = makeAgent({ getAgentTurn: () => turnOf({ computer }) });
    const prompt = await chatPrompt(agent, 'hi');
    expect(prompt.computer).toBe(true);
  });

  it('an agent whose provider has no connection ends the turn with the error, before Pi starts', async () => {
    const agent = makeAgent({ missingConnection: 'Connect Claude to talk to Scout.' });
    let spawned = false;
    agent.ensureSubprocess = async () => { spawned = true; };
    const events: any[] = [];
    for await (const event of agent.chat('hi')) events.push(event);
    expect(events).toEqual([{ type: 'error', message: 'Connect Claude to talk to Scout.' }, { type: 'complete' }]);
    expect(spawned).toBe(false);
  });

  it("only the agent's sources are listed, connected and callable; a changed list applies at the next turn", async () => {
    let turn = turnOf({ sourceSlugs: ['linear'] });
    const agent = makeAgent({ getAgentTurn: () => turn });
    const source = (slug: string) => ({ config: { slug, name: slug, enabled: true, type: 'mcp', mcp: { url: `https://${slug}.test` } }, folderPath: `/s/${slug}`, workspaceRootPath: '/ws' }) as any;
    agent.setAllSources([source('linear'), source('github')]);
    await agent.setSourceServers({ linear: { type: 'http', url: 'https://linear.test' }, github: { type: 'http', url: 'https://github.test' } }, {}, ['linear', 'github']);
    const listed = () => agent.sourceManager.getAllSources().map((s: any) => s.config.slug);
    const active = () => [...agent.sourceManager.getActiveSlugs()].sort();
    expect(listed()).toEqual(['linear']);
    expect(active()).toEqual(['linear']);

    const sent: any[] = [];
    agent.send = (msg: any) => sent.push(msg);
    let activations = 0;
    agent.onSourceActivationRequest = async () => { activations++; return true; };
    await agent.handlePreToolUseRequest({ requestId: 'r1', toolName: 'mcp__github__list_repos', input: {} });
    expect(sent.at(-1)).toMatchObject({ type: 'pre_tool_use_response', requestId: 'r1', action: 'block', reason: 'Source "github" is not available to this agent.' });
    expect(activations).toBe(0);

    turn = turnOf({ sourceSlugs: null });
    await chatPrompt(agent, 'hi');
    expect(listed()).toEqual(['linear', 'github']);
    expect(active()).toEqual(['github', 'linear']);
  });

  it('a Claude subscription (cli_login) sends no secret: the provider and an empty credential', async () => {
    const agent = makeAgent({ authType: 'cli_login', connectionSlug: 'claude-max', runtime: { piAuthProvider: 'claude-code' } });
    expect(await agent.getPiAuth()).toEqual({ provider: 'claude-code', credential: { type: 'cli_login' } });
  });
});
