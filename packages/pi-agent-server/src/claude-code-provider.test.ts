import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent, type AgentMessage, type AgentTool } from '@earendil-works/pi-agent-core';
import { InMemoryCredentialStore, InMemoryModelsStore, Type, type AssistantMessage, type Message } from '@earendil-works/pi-ai';
import { createReadTool, ModelRegistry, ModelRuntime } from '@earendil-works/pi-coding-agent';
import { CLAUDE_MISSING, registerClaudeCodeProvider, toAnthropic, type ClaudeCodeOptions } from './claude-code-provider.ts';

// Every test drives the provider through Pi's own agent loop and the real Agent SDK, with
// `pathToClaudeCodeExecutable` pointing at a fake `claude`: the real CLI never runs, nothing
// touches the network, and Claude's session files go to a temp CLAUDE_CONFIG_DIR.
const FAKE_CLAUDE = join(import.meta.dir, 'test-fixtures', 'fake-claude');
const SYSTEM_PROMPT = 'You are the orchestrator. Pi system prompt, passed through verbatim.';

type Step = { text?: string; tool?: { name: string; input: Record<string, unknown> }; partial?: string; fallback?: string; crash?: boolean };
type LogEntry = { kind: string; pid: number; [key: string]: any };

let dir: string;
let configDir: string;

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'claude-code-provider-')));
  configDir = join(dir, 'claude-config');
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function setup(turns: Step[][], extra: Partial<ClaudeCodeOptions> = {}, tools: AgentTool<any>[] = []) {
  writeFileSync(join(dir, 'fake-claude-script.json'), JSON.stringify({ turns }));
  const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, modelsStore: new InMemoryModelsStore() });
  const registry = new ModelRegistry(runtime);
  registerClaudeCodeProvider(registry, { pathToClaudeCodeExecutable: FAKE_CLAUDE, claudeConfigDir: configDir, cwd: () => dir, ...extra });
  const model = registry.getAll().find((m) => m.provider === 'claude-code')!;
  const agent = new Agent({
    initialState: { systemPrompt: SYSTEM_PROMPT, model, tools: [createReadTool(dir), ...tools] },
    streamFn: (m, context, options) => registry.streamSimple(m, context, options),
    sessionId: 'pi-session',
  });
  return { agent, model };
}

const readLog = (): LogEntry[] => existsSync(join(dir, 'fake-claude-log.jsonl'))
  ? readFileSync(join(dir, 'fake-claude-log.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  : [];
const entries = (kind: string) => readLog().filter((e) => e.kind === kind);
const argValue = (argv: string[], name: string) => {
  const i = argv.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  return i < 0 ? undefined : argv[i].includes('=') ? argv[i].slice(argv[i].indexOf('=') + 1) : argv[i + 1];
};
const assistants = (agent: Agent) => agent.state.messages.filter((m): m is AssistantMessage => m.role === 'assistant');
const lastAssistant = (agent: Agent) => assistants(agent).at(-1)!;
const textOf = (m: AssistantMessage) => m.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
const user = (text: string): AgentMessage => ({ role: 'user', content: text, timestamp: Date.now() });

async function until(check: () => boolean, ms = 5000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out waiting');
    await Bun.sleep(20);
  }
}
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

describe('claude-code provider', () => {
  it('without a `claude` to run, the turn fails with a message that says how to get one', async () => {
    const { agent } = await setup([[{ text: 'never' }]], { pathToClaudeCodeExecutable: join(dir, 'no-such-claude') });
    await agent.prompt('hello');
    const reply = lastAssistant(agent);
    expect(reply.stopReason).toBe('error');
    expect(reply.errorMessage).toBe(CLAUDE_MISSING);
    expect(entries('spawn')).toHaveLength(0);
  });

  it("spawns claude with Claude's tools off, Pi's prompt as the append and a scrubbed env; usage reaches Pi", async () => {
    const secrets = { ANTHROPIC_API_KEY: 'sk-test-not-real', ANTHROPIC_BASE_URL: 'http://hijack.invalid', CLAUDE_CODE_OAUTH_TOKEN: 'oauth-test-not-real', ENCRYPTION_KEY: 'test-key' };
    Object.assign(process.env, secrets);
    try {
      const { agent, model } = await setup([[{ text: 'Hello there' }]]);
      await agent.prompt('hello');

      const [spawned] = entries('spawn');
      expect(spawned.argv).toContain('--strict-mcp-config');
      expect(argValue(spawned.argv, 'tools')).toBe('');
      expect(argValue(spawned.argv, 'allowedTools')).toBe('mcp__pi');
      expect(argValue(spawned.argv, 'permission-mode')).toBe('dontAsk');
      expect(argValue(spawned.argv, 'setting-sources')).toBe('');
      expect(argValue(spawned.argv, 'model')).toBe(model.id);
      expect(argValue(spawned.argv, 'session-id')).toMatch(/^[0-9a-f-]{36}$/);
      for (const key of Object.keys(secrets)) expect(spawned.env[key]).toBeUndefined();
      expect(spawned.env.CLAUDE_CONFIG_DIR).toBe(configDir);
      expect(spawned.env.ENABLE_CLAUDEAI_MCP_SERVERS).toBe('0');
      expect(spawned.env.DISABLE_AUTO_COMPACT).toBe('1');

      const [init] = entries('initialize');
      expect(init.request.appendSystemPrompt).toBe(SYSTEM_PROMPT);

      const reply = lastAssistant(agent);
      expect(textOf(reply)).toBe('Hello there');
      expect(reply.stopReason).toBe('stop');
      expect(reply.provider).toBe('claude-code');
      expect(reply.usage).toMatchObject({ input: 10, cacheRead: 5, cacheWrite: 2, output: 7, totalTokens: 24 });
      expect(reply.usage.cost.total).toBeGreaterThan(0);
      await until(() => entries('exit').length === 1);
    } finally {
      for (const key of Object.keys(secrets)) delete process.env[key];
    }
  });

  it("round trip: Claude calls Pi's read, Pi runs it, the result goes back and the text continues", async () => {
    writeFileSync(join(dir, 'note.txt'), 'hi from pi');
    const { agent } = await setup([[{ tool: { name: 'read', input: { path: 'note.txt' } } }, { text: 'The note says hi' }]]);
    await agent.prompt('read the note');

    const [tools] = entries('tools');
    const read = tools.tools.find((t: any) => t.name === 'read');
    expect(read.inputSchema.properties.path).toBeDefined();
    const [result] = entries('tool_result');
    expect(result.response.result.content[0].text).toContain('hi from pi');
    expect(entries('spawn')).toHaveLength(1); // one CLI process for the whole Pi turn

    const [call, final] = assistants(agent);
    expect(call.stopReason).toBe('toolUse');
    expect(call.content).toContainEqual(expect.objectContaining({ type: 'toolCall', name: 'read', arguments: { path: 'note.txt' } }));
    expect(agent.state.messages.find((m) => m.role === 'toolResult')).toMatchObject({ toolName: 'read', isError: false });
    expect(textOf(final)).toBe('The note says hi');
  });

  it('takes a non-streamed assistant message (Claude Code fallback) as content', async () => {
    const { agent } = await setup([[{ fallback: 'from the fallback' }]]);
    await agent.prompt('hi');
    expect(textOf(lastAssistant(agent))).toBe('from the fallback');
  });

  it('a follow-up queued during a turn resumes the same Claude session', async () => {
    const { agent } = await setup([[{ text: 'one' }], [{ text: 'two' }]]);
    const run = agent.prompt('first');
    agent.followUp(user('and then?'));
    await run;
    const spawns = entries('spawn');
    expect(spawns).toHaveLength(2);
    expect(spawns[1].resume).toBe(argValue(spawns[0].argv, 'session-id'));
    expect(textOf(lastAssistant(agent))).toBe('two');
  });

  it('a claude that dies without a result fails the turn, and the next turn starts clean', async () => {
    const { agent } = await setup([[{ crash: true }], [{ text: 'back' }]]);
    await agent.prompt('hi');
    expect(lastAssistant(agent)).toMatchObject({ stopReason: 'error' });
    await agent.prompt('again');
    expect(entries('spawn')[1].resume).toBeDefined(); // rebuilt from Pi's history, not resumed blindly
    expect(textOf(lastAssistant(agent))).toBe('back');
  });

  it('steers mid-turn: the steer reaches Claude before the tool result', async () => {
    const { agent } = await setup([[{ tool: { name: 'read', input: { path: 'missing.txt' } } }, { text: 'done' }]]);
    agent.subscribe((event) => {
      if (event.type === 'tool_execution_start') agent.steer(user('also check the logs'));
    });
    await agent.prompt('go');

    const kinds = readLog().map((e) => e.kind);
    expect(kinds.indexOf('steer')).toBeGreaterThan(-1);
    expect(kinds.indexOf('steer')).toBeLessThan(kinds.indexOf('tool_result'));
    expect(entries('steer')[0]).toMatchObject({ priority: 'next', message: { content: [{ type: 'text', text: 'also check the logs' }] } });
    expect(textOf(lastAssistant(agent))).toBe('done');
  });

  it('abort mid-stream ends the turn as aborted and leaves no claude process', async () => {
    const { agent } = await setup([[{ partial: 'Hel' }]]);
    const run = agent.prompt('hi');
    await until(() => entries('hanging').length === 1);
    agent.abort();
    await run;
    expect(lastAssistant(agent).stopReason).toBe('aborted');
    const { pid } = entries('spawn')[0];
    await until(() => !alive(pid));
  });

  it('abort mid-tool leaves no claude process, and the next turn rebuilds a fresh session', async () => {
    const slow: AgentTool<any> = {
      name: 'slow', label: 'Slow', description: 'Waits until aborted', parameters: Type.Object({}),
      execute: (_id, _params, signal) => new Promise((_, reject) => signal?.addEventListener('abort', () => reject(new Error('aborted')))),
    };
    const { agent } = await setup([[{ tool: { name: 'slow', input: {} } }], [{ text: 'fresh start' }]], {}, [slow]);
    let toolStarted = false;
    agent.subscribe((event) => { if (event.type === 'tool_execution_start') toolStarted = true; });
    const run = agent.prompt('go slow');
    await until(() => toolStarted);
    agent.abort();
    await run;
    const first = entries('spawn')[0];
    await until(() => !alive(first.pid));

    await agent.prompt('again');
    const second = entries('spawn')[1];
    expect(second.resume).toBeDefined();
    expect(second.resume).not.toBe(argValue(first.argv, 'session-id'));
    expect(entries('resume')[0].exists).toBe(true);
    expect(textOf(lastAssistant(agent))).toBe('fresh start');
  });

  it("reuses Claude's session while Pi's history matches, and rebuilds it from Pi's entries after compaction and branch", async () => {
    writeFileSync(join(dir, 'note.txt'), 'hi');
    const { agent } = await setup([
      [{ tool: { name: 'read', input: { path: 'note.txt' } } }, { text: 'one' }],
      [{ text: 'two' }],
      [{ text: 'three' }],
      [{ text: 'branched' }],
    ]);
    await agent.prompt('first');
    const afterFirst = [...agent.state.messages];
    await agent.prompt('second');

    const spawns = entries('spawn');
    const first = argValue(spawns[0].argv, 'session-id');
    expect(spawns[1].resume).toBe(first); // REUSE: Pi's history still matches Claude's session

    // Compaction: Pi replaces the old messages with a summary.
    const system = agent.state.messages.filter((m) => m.role === 'system');
    agent.state.messages = [...system, user('Summary: we read the note.'), lastAssistant(agent)];
    await agent.prompt('third');
    const compacted = entries('spawn')[2].resume;
    expect(compacted).toBeDefined();
    expect(compacted).not.toBe(first);
    const afterCompaction = entries('resume').at(-1)!;
    expect(afterCompaction.exists).toBe(true);
    expect(afterCompaction.records.map((r: any) => [r.type, r.message.content[0].text])).toEqual([['user', 'Summary: we read the note.'], ['assistant', 'two']]);

    // Branch: Pi navigates back to the end of the first turn.
    agent.state.messages = afterFirst;
    await agent.prompt('branch');
    const branched = entries('spawn')[3].resume;
    expect(branched).not.toBe(compacted);
    const records = entries('resume').at(-1)!.records;
    expect(records.map((r: any) => r.type)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(records[1].message.content[0]).toMatchObject({ type: 'tool_use', name: 'mcp__pi__read', input: { path: 'note.txt' } });
    expect(records[2].message.content[0]).toMatchObject({ type: 'tool_result', tool_use_id: records[1].message.content[0].id });
    expect(records.map((r: any) => r.parentUuid)).toEqual([null, records[0].uuid, records[1].uuid, records[2].uuid]);
    expect(existsSync(join(configDir, 'projects'))).toBe(true);
    expect(textOf(lastAssistant(agent))).toBe('branched');
  });

  it('spawnClaudeCodeProcess carries the turn, MCP frames included', async () => {
    const calls: Array<{ command: string; args: string[]; env: Record<string, string | undefined> }> = [];
    writeFileSync(join(dir, 'note.txt'), 'over the custom spawner');
    const { agent } = await setup([[{ tool: { name: 'read', input: { path: 'note.txt' } } }, { text: 'ok' }]], {
      // Stands in for `docker exec -i <container> claude ...`.
      spawnClaudeCodeProcess: (options) => {
        calls.push(options);
        return spawn(options.command, options.args, { cwd: options.cwd, env: options.env, stdio: ['pipe', 'pipe', 'pipe'] });
      },
    });
    await agent.prompt('read it');
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe(FAKE_CLAUDE);
    expect(calls[0].args).toContain('--strict-mcp-config');
    expect(calls[0].env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(entries('tool_result')[0].response.result.content[0].text).toContain('over the custom spawner');
    expect(textOf(lastAssistant(agent))).toBe('ok');
  });
});

describe('toAnthropic', () => {
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
  const assistant = (content: AssistantMessage['content'], provider = 'claude-code'): Message =>
    ({ role: 'assistant', content, api: 'claude-code', provider, model: 'm', usage, stopReason: 'toolUse', timestamp: 0 });
  const result = (id: string, text: string): Message =>
    ({ role: 'toolResult', toolCallId: id, toolName: 'read', content: [{ type: 'text', text }], isError: false, timestamp: 0 });

  it('pairs results with their tool calls, stubs missing ones and drops orphans and empty turns', () => {
    const out = toAnthropic([
      { role: 'user', content: 'go', timestamp: 0 },
      assistant([{ type: 'thinking', thinking: 'hm', thinkingSignature: 'sig' }, { type: 'toolCall', id: 'a', name: 'read', arguments: {} }, { type: 'toolCall', id: 'b', name: 'ls', arguments: {} }]),
      result('a', 'A'),
      { role: 'user', content: 'steer', timestamp: 0 },
      result('b', 'B'),
      result('zzz', 'orphan'),
      assistant([]),
      assistant([{ type: 'thinking', thinking: 'foreign', thinkingSignature: 'x' }, { type: 'toolCall', id: 'c', name: 'read', arguments: {} }], 'anthropic'),
    ]);
    expect(out.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'user', 'assistant', 'user']);
    expect(out[1].content.map((b) => b.type)).toEqual(['thinking', 'tool_use', 'tool_use']);
    expect(out[2].content).toEqual([
      { type: 'tool_result', tool_use_id: 'a', content: 'A', is_error: false },
      { type: 'tool_result', tool_use_id: 'b', content: 'B', is_error: false },
    ]);
    expect(out[3].content).toEqual([{ type: 'text', text: 'steer' }]);
    expect(out[4].content).toEqual([{ type: 'tool_use', id: 'c', name: 'mcp__pi__read', input: {} }]);
    expect(out[5].content).toEqual([{ type: 'tool_result', tool_use_id: 'c', content: '[no tool result recorded]', is_error: true }]);
  });
});
