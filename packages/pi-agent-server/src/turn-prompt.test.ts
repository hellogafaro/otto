import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SessionManager,
  SettingsManager,
  createAgentSession,
  createReadToolDefinition,
  type ExtensionAPI,
  type InlineExtension,
  type ModelRuntime,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import {
  createAssistantMessageEventStream,
  getCurrentSystemPrompt,
  type AssistantMessage,
  type Model,
  type ToolCall,
} from '@earendil-works/pi-ai';
import { createOttoSettingsManager } from './session-settings.ts';
import { OTTO_TURN_PROMPT_EXTENSION_NAME, createOttoResourceLoader, createTurnPrompt } from './turn-prompt.ts';

/**
 * Otto's prompt and the agent's skills reach Pi as Pi's own prompt options (docs/final-plan.md 2.6, M1): Pi
 * renders the prompt with its native skill list instead of having a whole prompt forced over it.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'otto-pi-turn-'));
  dirs.push(dir);
  return dir;
};

type Handler = (event: unknown, ctx: unknown) => unknown;

function handlerOf(extension: InlineExtension): Handler {
  const handlers: Handler[] = [];
  const pi = { on: (event: string, handler: Handler) => (event === 'before_agent_start' ? handlers.push(handler) : 0) } as unknown as ExtensionAPI;
  void (typeof extension === 'function' ? extension : extension.factory)(pi);
  expect(handlers).toHaveLength(1);
  return handlers[0]!;
}

describe('createTurnPrompt', () => {
  it('leaves Pi alone until a turn is set, then sets the prompt and skills on every run', () => {
    const turn = createTurnPrompt();
    expect(turn.extension).toMatchObject({ name: OTTO_TURN_PROMPT_EXTENSION_NAME, hidden: true });
    const handler = handlerOf(turn.extension);
    const options = () => ({ customPrompt: undefined, appendSystemPrompt: 'disk', contextFiles: [{ path: 'AGENTS.md', content: 'x' }], skills: [] as unknown[] });
    const untouched = options();
    expect(handler({ type: 'before_agent_start', systemPromptOptions: untouched }, {})).toBeUndefined();
    expect(untouched.appendSystemPrompt).toBe('disk');

    turn.set({ systemPrompt: 'OTTO', skills: [{ name: 'deploy', description: 'Ship it', filePath: '/skills/deploy/SKILL.md' }] });
    const run = options();
    // Nothing is returned: a returned systemPrompt would force a whole prompt and drop Pi's skill list.
    expect(handler({ type: 'before_agent_start', systemPromptOptions: run }, {})).toBeUndefined();
    expect(run.customPrompt).toBe('OTTO');
    expect(run.appendSystemPrompt).toBe('');
    expect(run.contextFiles).toEqual([]);
    expect(run.skills).toMatchObject([{ name: 'deploy', description: 'Ship it', filePath: '/skills/deploy/SKILL.md', baseDir: '/skills/deploy', disableModelInvocation: false }]);

    turn.set({ systemPrompt: 'NEXT' });
    const next = options();
    handler({ type: 'before_agent_start', systemPromptOptions: next }, {});
    expect(next.customPrompt).toBe('NEXT');
    expect(next.skills).toEqual([]);
  });
});

describe('createOttoResourceLoader', () => {
  it('reads nothing from the server disk: no context files, skills, SYSTEM.md or APPEND_SYSTEM.md', async () => {
    const root = tempDir();
    const agentDir = join(root, '.pi-agent');
    for (const dir of [join(root, '.pi', 'skills', 'local'), join(agentDir, 'skills', 'global'), join(root, '.agents', 'skills', 'project')]) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'SKILL.md'), '---\nname: disk\ndescription: from disk\n---\nbody');
    }
    writeFileSync(join(root, 'AGENTS.md'), 'project rules');
    writeFileSync(join(root, 'CLAUDE.md'), 'claude rules');
    writeFileSync(join(agentDir, 'AGENTS.md'), 'global rules');
    writeFileSync(join(root, '.pi', 'SYSTEM.md'), 'disk system');
    writeFileSync(join(agentDir, 'APPEND_SYSTEM.md'), 'disk append');
    const turnPrompt = createTurnPrompt();
    const loader = await createOttoResourceLoader({ cwd: root, agentDir, settingsManager: SettingsManager.inMemory(), turnPrompt });
    expect(loader.getAgentsFiles().agentsFiles).toEqual([]);
    expect(loader.getSkills().skills).toEqual([]);
    expect(loader.getSystemPrompt()).toBeUndefined();
    expect(loader.getAppendSystemPrompt()).toEqual([]);
    const { extensions, errors } = loader.getExtensions();
    expect(errors).toEqual([]);
    expect(extensions.some(ext => ext.path === `<inline:${OTTO_TURN_PROMPT_EXTENSION_NAME}>`)).toBe(true);
  });

  it('a fixed system prompt (ephemeral queries) is the loader prompt', async () => {
    const root = tempDir();
    const loader = await createOttoResourceLoader({ cwd: root, agentDir: join(root, '.pi-agent'), settingsManager: SettingsManager.inMemory(), systemPrompt: 'Reply with ONLY the title.' });
    expect(loader.getSystemPrompt()).toBe('Reply with ONLY the title.');
    expect(loader.getExtensions().extensions).toEqual([]);
  });
});

describe('a turn through a Pi session (offline model)', () => {
  it('lists the turn skills natively, the model reads one on demand and calls a source proxy tool', async () => {
    const root = tempDir();
    const skillsDir = join(root, 'skills');
    mkdirSync(join(skillsDir, 'deploy'), { recursive: true });
    writeFileSync(join(skillsDir, 'deploy', 'SKILL.md'), '---\nname: Deploy\ndescription: Ship it\n---\nRun the deploy script.');

    const model: Model<'openai-responses'> = {
      id: 'offline-turn-test', name: 'Offline', api: 'openai-responses', provider: 'openai',
      baseUrl: 'https://invalid.test', reasoning: false, input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 4096,
    };
    const proxyCalls: unknown[] = [];
    // Stands in for a pool proxy tool (pi-agent-server's buildProxyTools sends these to the main process).
    const proxyTool: ToolDefinition<any, any> = {
      name: 'mcp__linear__list_issues',
      label: 'list issues',
      description: 'List Linear issues',
      promptSnippet: 'List Linear issues',
      parameters: { type: 'object', properties: { team: { type: 'string' } } } as any,
      execute: async (_id, params) => {
        proxyCalls.push(params);
        return { content: [{ type: 'text', text: 'ISSUE-1' }], details: undefined };
      },
    };
    const read = createReadToolDefinition(root);
    const turnPrompt = createTurnPrompt();
    const settingsManager = createOttoSettingsManager();
    const { session } = await createAgentSession({
      cwd: root, model, settingsManager,
      sessionManager: SessionManager.inMemory(root),
      resourceLoader: await createOttoResourceLoader({ cwd: root, agentDir: join(root, '.pi-agent'), settingsManager, turnPrompt }),
      customTools: [read, proxyTool],
      tools: [read.name, proxyTool.name],
      modelRuntime: {
        hasConfiguredAuth: () => true, getModel: () => model, getAvailableSnapshot: () => [model],
        streamSimple: () => { throw new Error('Provider/network access is forbidden'); },
      } as unknown as ModelRuntime,
    });

    const prompts: string[] = [];
    const results: string[] = [];
    const steps: Array<ToolCall | string> = [
      { type: 'toolCall', id: 'c1', name: 'read', arguments: { path: join(skillsDir, 'deploy', 'SKILL.md') } },
      { type: 'toolCall', id: 'c2', name: 'mcp__linear__list_issues', arguments: { team: 'core' } },
      'done',
    ];
    session.agent.streamFunction = (_model, context) => {
      prompts.push(getCurrentSystemPrompt(context.messages) ?? '');
      const last = context.messages.at(-1);
      if (last?.role === 'toolResult') results.push(last.content.map(c => (c.type === 'text' ? c.text : '')).join(''));
      const step = steps.shift()!;
      const stream = createAssistantMessageEventStream();
      const message: AssistantMessage = {
        role: 'assistant', content: typeof step === 'string' ? [{ type: 'text', text: step }] : [step],
        api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(),
        stopReason: typeof step === 'string' ? 'stop' : 'toolUse',
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      };
      queueMicrotask(() => {
        stream.push({ type: 'start', partial: { ...message, content: [] } });
        stream.push({ type: 'done', reason: message.stopReason as 'stop' | 'toolUse', message });
      });
      return stream;
    };

    try {
      turnPrompt.set({
        systemPrompt: 'You are Otto.\n\n<otto_agent name="Scout">\nBe brief.\n</otto_agent>',
        skills: [{ name: 'deploy', description: 'Ship it', filePath: join(skillsDir, 'deploy', 'SKILL.md') }],
      });
      await session.prompt('Ship the release');
      expect(prompts).toHaveLength(3);
      const prompt = prompts[0]!;
      expect(prompt.startsWith('You are Otto.')).toBe(true);
      expect(prompt).toContain('<otto_agent name="Scout">');
      expect(prompt).toContain('<available_skills>');
      expect(prompt).toContain('<name>deploy</name>');
      expect(prompt).toContain(`<location>${join(skillsDir, 'deploy', 'SKILL.md')}</location>`);
      // Pi's own preamble and docs are not in it: Otto's prompt is the preamble.
      expect(prompt).not.toContain('operating inside pi');
      expect(results[0]).toContain('Run the deploy script.');
      expect(proxyCalls).toEqual([{ team: 'core' }]);
      expect(results[1]).toBe('ISSUE-1');

      // The next turn names other skills (the agent was edited): the list follows.
      steps.push('ok');
      turnPrompt.set({ systemPrompt: 'You are Otto.', skills: [{ name: 'review', description: 'Review code', filePath: '/skills/review/SKILL.md' }] });
      await session.prompt('Next');
      const next = prompts.at(-1)!;
      expect(next).toContain('<location>/skills/review/SKILL.md</location>');
      expect(next).not.toContain('<name>deploy</name>');
    } finally {
      await session.abort();
      session.dispose();
    }
  }, 10000);
});
