import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PiAgent } from '../pi-agent.ts';
import type { BackendConfig } from '../backend/types.ts';

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

  it("appends the agent's instructions after the base prompt, read each turn", async () => {
    let instructions = '<otto_agent name="Scout">\nBe brief.\n</otto_agent>';
    const agent = makeAgent({ getAgentInstructions: () => instructions });
    const first = await promptOf(agent, 'hi');
    expect(first.systemPrompt.endsWith(instructions)).toBe(true);
    expect(first.systemPrompt.length).toBeGreaterThan(instructions.length);
    instructions = '';
    const second = await promptOf(agent, 'again');
    expect(second.systemPrompt).not.toContain('otto_agent');
  });

  it('a Claude subscription (cli_login) sends no secret: the provider and an empty credential', async () => {
    const agent = makeAgent({ authType: 'cli_login', connectionSlug: 'claude-max', runtime: { piAuthProvider: 'claude-code' } });
    expect(await agent.getPiAuth()).toEqual({ provider: 'claude-code', credential: { type: 'cli_login' } });
  });
});
