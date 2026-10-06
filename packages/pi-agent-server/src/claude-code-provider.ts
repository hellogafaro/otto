/**
 * The `claude-code` Pi provider (docs/pi-only-plan.md, phase B1): Claude as a model
 * behind Pi, driven through the user's own `claude` CLI and its own login. Claude's
 * tools are off; it calls Pi's tools through one in-process MCP server, Pi runs them
 * and keeps the only history that counts. Claude's session is a cache that is
 * rebuilt from Pi's history whenever the two diverge (compaction, branch, abort).
 * Otto never reads, stores or passes a Claude credential, and the child gets the
 * allow-listed `agentEnv()`, so no server secret or ANTHROPIC_* variable reaches it.
 *
 * Adapted from elidickinson/pi-claude-bridge (MIT, Copyright (c) Eli Dickinson,
 * https://github.com/elidickinson/pi-claude-bridge) and its cc-session-io writer
 * (MIT): the query options, the MCP relay paired by `claudecode/toolUseId`, the
 * stream-event mapping, the steer-before-result ordering and the REUSE/REBUILD rules.
 */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createSdkMcpServer, query, type Options, type Query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import {
  calculateCost, createAssistantMessageEventStream, getCurrentSystemPrompt, getCurrentTools,
  type Api, type AssistantMessage, type AssistantMessageEventStream, type Message, type Model,
  type SimpleStreamOptions, type Tool, type ToolResultMessage, type UserMessage,
} from '@earendil-works/pi-ai';
import type { ModelRegistry } from '@earendil-works/pi-coding-agent';
import { agentEnv } from '../../session-tools-core/src/runtime/agent-env.ts';

export const CLAUDE_CODE_PROVIDER = 'claude-code';
const SERVER = 'pi';
const TOOL_PREFIX = `mcp__${SERVER}__`;
/** Claude Code stamps every tools/call with the tool_use id it answers (a CC extension to MCP). */
const TOOL_USE_ID = 'claudecode/toolUseId';
const CONTINUE = '[Your context was rewritten (compacted or branched). What precedes this is the current history, ending with the tool result you were waiting for. Continue from there.]';

/** What a turn says when there is no `claude` to run (Otto does not ship one: the user's own CLI holds their login). */
export const CLAUDE_MISSING = 'Claude Code (`claude`) was not found. Install it, sign in by running `claude` and then `/login`, and try again; or set OTTO_CLAUDE_PATH to where it is installed.';

export interface ClaudeCodeOptions {
  /** The user's `claude`; defaults to the one on PATH. Without one a turn fails with `CLAUDE_MISSING`. */
  pathToClaudeCodeExecutable?: string;
  /** Where `claude` runs (a later phase routes it through `docker exec -i`). */
  spawnClaudeCodeProcess?: Options['spawnClaudeCodeProcess'];
  /** Claude's config dir, where its session files live; CLAUDE_CONFIG_DIR or ~/.claude. */
  claudeConfigDir?: string;
  cwd?: () => string;
  /** Test seam for the SDK's `query`. */
  query?: typeof query;
}

type McpResult = { content: Array<Record<string, unknown>>; isError?: boolean };
type Block = AssistantMessage['content'][number];
type Turn = {
  query: Query;
  input: ReturnType<typeof createInput>;
  stream: AssistantMessageEventStream | null;
  started: boolean;
  out: AssistantMessage;
  blocks: Map<number, { at: number; json: string }>;
  streamed: Set<string>;
  toolIds: Set<string>;
  waiting: Map<string, (result: McpResult) => void>;
  early: Map<string, McpResult>;
  aborted: boolean;
};
type State = { cache?: { sessionId: string; seen: string[]; prompt: string; stale?: boolean }; turn?: Turn };

export function registerClaudeCodeProvider(registry: ModelRegistry, options: ClaudeCodeOptions = {}): void {
  const models = registry.getAll().filter((m) => m.provider === 'anthropic')
    .map(({ id, name, reasoning, thinkingLevelMap, input, cost, contextWindow, maxTokens }) =>
      ({ id, name, reasoning, thinkingLevelMap, input, cost, contextWindow, maxTokens }));
  registry.registerProvider(CLAUDE_CODE_PROVIDER, {
    name: 'Claude Code', api: CLAUDE_CODE_PROVIDER, baseUrl: 'claude-code:', models,
    // Not a credential: `claude` signs in with the user's own login. Pi routes only to a provider with an auth method.
    apiKey: 'cli-login',
    streamSimple: createClaudeCodeStream(options),
  });
}

export function createClaudeCodeStream(opts: ClaudeCodeOptions = {}) {
  const states = new Map<string, State>();
  const configDir = opts.claudeConfigDir ?? process.env.CLAUDE_CONFIG_DIR;
  const configured = opts.pathToClaudeCodeExecutable;
  const executable = configured ? (existsSync(configured) ? configured : undefined) : Bun.which('claude') ?? undefined;

  return function streamClaudeCode(model: Model<Api>, context: { messages: Message[] }, options?: SimpleStreamOptions): AssistantMessageEventStream {
    const stream = createAssistantMessageEventStream();
    if (!executable && !opts.query && !opts.spawnClaudeCodeProcess) {
      const out = Object.assign(newOutput(model), { stopReason: 'error', errorMessage: CLAUDE_MISSING }) as AssistantMessage;
      queueMicrotask(() => { stream.push({ type: 'error', reason: 'error', error: out }); stream.end(); });
      return stream;
    }
    const oneShot = options?.cacheRetention === 'none'; // Pi's summarizers: no session to keep
    const key = options?.sessionId ?? '';
    const state: State = oneShot ? {} : states.get(key) ?? states.set(key, {}).get(key)!;
    const history = context.messages.filter((m) => m.role !== 'system');
    const hashes = history.map(hashOf);
    let i = history.length;
    while (i && history[i - 1].role === 'user') i--;
    const turnStart = i;
    while (i && history[i - 1].role === 'toolResult') i--;
    const results = history.slice(i, turnStart) as ToolResultMessage[];

    // Pi ran the tools Claude is parked on: hand the results to the waiting MCP handlers, steer first
    // (it shares stdin with the results, so Claude drains it at this tool boundary).
    const live = state.turn;
    if (live && results.some((r) => live.toolIds.has(r.toolCallId)) && isPrefix(state.cache!.seen, hashes)) {
      Object.assign(live, { stream, started: false, out: newOutput(model) });
      state.cache!.seen = hashes;
      onAbort(options?.signal, () => abort(state, live));
      const steer = history.slice(turnStart) as UserMessage[];
      void (steer.length ? live.input.push(userMessage(steer, 'next')) : Promise.resolve()).then(() => {
        for (const r of results) {
          const result = toMcp(r);
          const handler = live.waiting.get(r.toolCallId);
          if (handler) { live.waiting.delete(r.toolCallId); handler(result); } else live.early.set(r.toolCallId, result);
        }
      });
      return stream;
    }
    // Pi rewrote the history under a parked turn, or moved on without it: drop it and rebuild.
    if (live) abort(state, live);

    const cwd = opts.cwd?.() ?? process.cwd();
    const systemPrompt = getCurrentSystemPrompt(context.messages);
    const prior = history.slice(0, turnStart);
    const c = state.cache;
    const extra = prior.length - (c?.seen.length ?? 0);
    // REUSE: Claude's session holds Pi's history, plus at most Pi's copy of Claude's last reply.
    const reuse = !!c && !c.stale && c.prompt === hashOf(systemPrompt) && isPrefix(c.seen, hashes.slice(0, turnStart))
      && (extra === 0 || (extra === 1 && prior[turnStart - 1].role === 'assistant'));
    const sessionId = reuse ? c.sessionId : randomUUID();
    // REBUILD: a fresh session written from Pi's entries. The old file only ever was a cache.
    if (!reuse && prior.length) {
      writeSession(sessionFile(configDir, cwd, sessionId), sessionId, cwd, model.id, prior);
      if (c) rmSync(sessionFile(configDir, cwd, c.sessionId), { force: true });
    }
    state.cache = { sessionId, seen: hashes, prompt: hashOf(systemPrompt) };

    const turn = { stream, started: false, out: newOutput(model), blocks: new Map(), streamed: new Set(), toolIds: new Set(), waiting: new Map(), early: new Map(), aborted: false, input: createInput() } as Partial<Turn> as Turn;
    const prompt = history.slice(turnStart) as UserMessage[];
    void turn.input.push(prompt.length ? userMessage(prompt) : userMessage([{ role: 'user', content: CONTINUE, timestamp: Date.now() }]));
    const effort = model.reasoning && options?.reasoning ? (options.reasoning === 'minimal' ? 'low' : options.reasoning) : undefined;
    turn.query = (opts.query ?? query)({
      prompt: turn.input.stream,
      options: {
        cwd,
        env: agentEnv({ CLAUDE_CONFIG_DIR: configDir, ENABLE_CLAUDEAI_MCP_SERVERS: '0', DISABLE_AUTO_COMPACT: '1' }),
        model: model.id,
        tools: [], // none of Claude's own tools; only Pi's, through the MCP server below
        allowedTools: [`mcp__${SERVER}`],
        permissionMode: 'dontAsk', // Pi's tool gate decides; anything else Claude asks for is denied
        settingSources: [], // no user CLAUDE.md, hooks, plugins or MCP config
        strictMcpConfig: true,
        includePartialMessages: true,
        persistSession: !oneShot,
        systemPrompt: { type: 'preset', preset: 'claude_code', ...(systemPrompt ? { append: systemPrompt } : {}) },
        settings: { includeGitInstructions: false },
        mcpServers: { [SERVER]: toolServer(getCurrentTools(context.messages), turn) },
        ...(reuse || prior.length ? { resume: sessionId } : { sessionId }),
        ...(effort ? { effort, extraArgs: { 'thinking-display': 'summarized' } } : {}),
        ...(executable ? { pathToClaudeCodeExecutable: executable } : {}),
        ...(opts.spawnClaudeCodeProcess ? { spawnClaudeCodeProcess: opts.spawnClaudeCodeProcess } : {}),
      },
    });
    state.turn = turn;
    onAbort(options?.signal, () => abort(state, turn));
    void consume(state, turn, model);
    return stream;
  };
}

async function consume(state: State, turn: Turn, model: Model<Api>): Promise<void> {
  try {
    for await (const msg of turn.query) {
      if (turn.aborted) break;
      if (msg.type === 'stream_event') onStreamEvent(turn, msg.event, model);
      else if (msg.type === 'assistant') onAssistant(turn, msg.message, model);
      else if (msg.type === 'result') {
        turn.input.end(); // nothing else closes the CLI's stdin
        if (msg.is_error) Object.assign(turn.out, { stopReason: 'error', errorMessage: msg.subtype === 'success' ? msg.result : msg.errors.join('; ') });
        // The turn is over: a follow-up may arrive before the CLI has exited, and must not see it as live.
        if (state.turn === turn) state.turn = undefined;
        end(turn, turn.out.stopReason === 'error' ? 'error' : 'done');
      }
    }
    throw new Error('claude exited without a result');
  } catch (error) {
    if (state.turn === turn) { // still live: neither finished nor aborted
      state.cache = undefined;
      Object.assign(turn.out, { stopReason: 'error', errorMessage: error instanceof Error ? error.message : String(error) });
      end(turn, 'error');
    }
  } finally {
    release(turn, 'Query ended');
    if (state.turn === turn) state.turn = undefined;
    turn.query.close();
  }
}

function abort(state: State, turn: Turn): void {
  if (turn.aborted || state.turn !== turn) return; // already over
  turn.aborted = true;
  if (state.cache) state.cache.stale = true; // the killed CLI may still flush into its session file
  state.turn = undefined;
  Object.assign(turn.out, { stopReason: 'aborted', errorMessage: 'Operation aborted' });
  end(turn, 'aborted');
  release(turn, 'Operation aborted');
  turn.input.end();
  void turn.query.interrupt().catch(() => {});
  turn.query.close();
}

/** Answer every parked MCP handler: one left waiting on a dead CLI never settles. */
function release(turn: Turn, reason: string): void {
  for (const handler of turn.waiting.values()) handler({ content: [{ type: 'text', text: reason }], isError: true });
  turn.waiting.clear();
}

function emit(turn: Turn, event: Record<string, unknown>): void {
  if (!turn.stream) return;
  if (!turn.started) { turn.started = true; turn.stream.push({ type: 'start', partial: turn.out }); }
  turn.stream.push({ ...event, partial: turn.out } as never);
}

function end(turn: Turn, kind: 'done' | 'error' | 'aborted'): void {
  const stream = turn.stream;
  if (!stream) return;
  if (!turn.started) { turn.started = true; stream.push({ type: 'start', partial: turn.out }); }
  if (kind === 'done') stream.push({ type: 'done', reason: turn.out.stopReason as 'stop', message: turn.out });
  else stream.push({ type: 'error', reason: kind, error: turn.out });
  stream.end();
  turn.stream = null;
}

function addBlock(turn: Turn, block: Block): number {
  turn.out.content.push(block);
  const at = turn.out.content.length - 1;
  emit(turn, { type: `${block.type === 'toolCall' ? 'toolcall' : block.type}_start`, contentIndex: at });
  return at;
}

function endBlock(turn: Turn, at: number): void {
  const block = turn.out.content[at];
  if (block.type === 'text') emit(turn, { type: 'text_end', contentIndex: at, content: block.text });
  else if (block.type === 'thinking') emit(turn, { type: 'thinking_end', contentIndex: at, content: block.thinking });
  else emit(turn, { type: 'toolcall_end', contentIndex: at, toolCall: block });
}

function toBlock(turn: Turn, b: any): Block | undefined {
  if (b.type === 'text') return { type: 'text', text: b.text ?? '' };
  if (b.type === 'thinking') return { type: 'thinking', thinking: b.thinking ?? '', thinkingSignature: b.signature ?? '' };
  if (b.type !== 'tool_use' || !b.name.startsWith(TOOL_PREFIX)) return undefined;
  turn.toolIds.add(b.id);
  return { type: 'toolCall', id: b.id, name: b.name.slice(TOOL_PREFIX.length), arguments: b.input ?? {} };
}

/** Anthropic stream events → Pi stream events. A tool call ends Pi's stream; Claude waits in the MCP handler. */
function onStreamEvent(turn: Turn, ev: any, model: Model<Api>): void {
  if (!turn.stream) return;
  const out = turn.out;
  if (ev.type === 'message_start') {
    turn.streamed.add(ev.message.id);
    turn.blocks.clear();
    applyUsage(out, ev.message.usage, model);
  } else if (ev.type === 'content_block_start') {
    const block = toBlock(turn, { ...ev.content_block, input: {} });
    if (block) turn.blocks.set(ev.index, { at: addBlock(turn, block), json: '' });
  } else if (ev.type === 'content_block_delta') {
    const slot = turn.blocks.get(ev.index);
    const block = slot && out.content[slot.at];
    const d = ev.delta;
    if (!slot || !block) return;
    if (d.type === 'text_delta' && block.type === 'text') { block.text += d.text; emit(turn, { type: 'text_delta', contentIndex: slot.at, delta: d.text }); }
    else if (d.type === 'thinking_delta' && block.type === 'thinking') { block.thinking += d.thinking; emit(turn, { type: 'thinking_delta', contentIndex: slot.at, delta: d.thinking }); }
    else if (d.type === 'signature_delta' && block.type === 'thinking') block.thinkingSignature = (block.thinkingSignature ?? '') + d.signature;
    else if (d.type === 'input_json_delta' && block.type === 'toolCall') { slot.json += d.partial_json; emit(turn, { type: 'toolcall_delta', contentIndex: slot.at, delta: d.partial_json }); }
  } else if (ev.type === 'content_block_stop') {
    const slot = turn.blocks.get(ev.index);
    if (!slot) return;
    const block = out.content[slot.at];
    if (block.type === 'toolCall') {
      try { block.arguments = slot.json ? JSON.parse(slot.json) : {}; } catch { /* cut off: Pi fails the call */ }
    }
    endBlock(turn, slot.at);
  } else if (ev.type === 'message_delta') {
    const reason = ev.delta?.stop_reason;
    out.stopReason = reason === 'tool_use' ? 'toolUse' : reason === 'max_tokens' ? 'length' : 'stop';
    applyUsage(out, ev.usage, model);
  } else if (ev.type === 'message_stop' && out.content.some((b) => b.type === 'toolCall')) {
    out.stopReason = 'toolUse';
    end(turn, 'done');
  }
}

/** A complete assistant message not seen as stream events: Claude Code's non-streaming fallback. */
function onAssistant(turn: Turn, message: any, model: Model<Api>): void {
  if (!turn.stream || turn.streamed.has(message.id)) return;
  for (const b of message.content ?? []) {
    const block = toBlock(turn, b);
    if (!block) continue;
    const at = addBlock(turn, block);
    if (block.type === 'text') emit(turn, { type: 'text_delta', contentIndex: at, delta: block.text });
    else if (block.type === 'thinking') emit(turn, { type: 'thinking_delta', contentIndex: at, delta: block.thinking });
    endBlock(turn, at);
  }
  applyUsage(turn.out, message.usage, model);
  if (turn.out.content.some((b) => b.type === 'toolCall')) { turn.out.stopReason = 'toolUse'; end(turn, 'done'); }
}

function applyUsage(out: AssistantMessage, u: any, model: Model<Api>): void {
  if (!u) return;
  const usage = out.usage;
  if (u.input_tokens != null) usage.input = u.input_tokens;
  if (u.output_tokens != null) usage.output = u.output_tokens;
  if (u.cache_read_input_tokens != null) usage.cacheRead = u.cache_read_input_tokens;
  if (u.cache_creation_input_tokens != null) usage.cacheWrite = u.cache_creation_input_tokens;
  usage.totalTokens = usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
  calculateCost(model, usage);
}

/** Pi's tools, served verbatim as JSON Schema (createSdkMcpServer's Zod path is lossy below the top level). */
function toolServer(tools: Tool[], turn: Turn) {
  const server = createSdkMcpServer({ name: SERVER, tools: [] });
  server.instance.server.fallbackRequestHandler = async (request) => {
    if (request.method === 'tools/list') {
      return { tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.parameters as never })) };
    }
    if (request.method !== 'tools/call') throw new Error(`Unsupported MCP method: ${request.method}`);
    const id = (request.params?._meta as Record<string, unknown> | undefined)?.[TOOL_USE_ID];
    if (typeof id !== 'string') throw new Error(`tools/call without _meta["${TOOL_USE_ID}"]: cannot pair it with Pi's tool call`);
    const early = turn.early.get(id);
    if (early) { turn.early.delete(id); return early; }
    return new Promise<McpResult>((resolve) => turn.waiting.set(id, resolve));
  };
  return server;
}

/** Claude's prompt as a parked stream, so a steer can reach stdin mid-turn. `push` resolves once the SDK wrote it. */
function createInput() {
  const queue: Array<[SDKUserMessage, () => void]> = [];
  let wake: (() => void) | undefined;
  let closed = false;
  async function* messages(): AsyncGenerator<SDKUserMessage> {
    while (true) {
      while (!queue.length && !closed) await new Promise<void>((resolve) => { wake = resolve; });
      const next = queue.shift();
      if (!next) return;
      try { yield next[0]; } finally { next[1](); }
    }
  }
  return {
    stream: messages(),
    push: (message: SDKUserMessage) => closed ? Promise.resolve() : new Promise<void>((resolve) => { queue.push([message, resolve]); wake?.(); }),
    end: () => { closed = true; for (const [, resolve] of queue.splice(0)) resolve(); wake?.(); },
  };
}

function userMessage(messages: UserMessage[], priority?: 'next'): SDKUserMessage {
  return { type: 'user', message: { role: 'user', content: messages.flatMap((m) => userContent(m.content)) as never }, parent_tool_use_id: null, ...(priority ? { priority } : {}) };
}

function userContent(content: UserMessage['content']): Array<Record<string, unknown>> {
  if (typeof content === 'string') return content ? [{ type: 'text', text: content }] : [];
  return content.map((b) => b.type === 'text' ? { type: 'text', text: b.text } : { type: 'image', source: { type: 'base64', media_type: b.mimeType, data: b.data } });
}

function toMcp(r: ToolResultMessage): McpResult {
  return { content: r.content.map((b) => b.type === 'text' ? { type: 'text', text: b.text } : { type: 'image', data: b.data, mimeType: b.mimeType }), isError: r.isError };
}

function newOutput(model: Model<Api>): AssistantMessage {
  return {
    role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id, stopReason: 'stop', timestamp: Date.now(),
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  };
}

function onAbort(signal: AbortSignal | undefined, fn: () => void): void {
  if (signal?.aborted) fn();
  else signal?.addEventListener('abort', fn, { once: true });
}

const hashOf = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('base64');
const isPrefix = (prefix: string[], all: string[]) => prefix.length <= all.length && prefix.every((h, i) => h === all[i]);

/** Where `claude` keeps a session for `cwd` (Claude Code's own project-key rule). */
export function sessionFile(configDir: string | undefined, cwd: string, sessionId: string): string {
  let path = cwd;
  try { path = realpathSync(cwd); } catch { /* not created yet */ }
  path = path.normalize('NFC');
  let key = path.replace(/[^a-zA-Z0-9]/g, '-');
  if (key.length > 200) {
    let h = 0;
    for (let i = 0; i < path.length; i++) h = ((h << 5) - h + path.charCodeAt(i)) | 0;
    key = `${key.slice(0, 200)}-${Math.abs(h).toString(36)}`;
  }
  return join(configDir ?? join(homedir(), '.claude'), 'projects', key, `${sessionId}.jsonl`);
}

/** Write Pi's history as a Claude Code session file: one record per message, chained by parentUuid. */
function writeSession(file: string, sessionId: string, cwd: string, model: string, messages: Message[]): void {
  let parentUuid: string | null = null;
  let time = Date.now() - messages.length;
  const lines = toAnthropic(messages).map((m) => {
    const uuid = randomUUID();
    const message = m.role === 'user' ? m : {
      id: `msg_${uuid.replace(/-/g, '')}`, type: 'message', role: 'assistant', model, content: m.content,
      stop_reason: m.content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn', stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 },
    };
    const record = { type: m.role, uuid, parentUuid, sessionId, timestamp: new Date(time++).toISOString(), isSidechain: false, cwd, userType: 'external', version: '2.1.83', gitBranch: 'HEAD', message };
    parentUuid = uuid;
    return JSON.stringify(record);
  });
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, lines.join('\n') + '\n');
}

/**
 * Pi messages → Anthropic messages. A turn's tool results go into one user message right after
 * their assistant message (a steer recorded between results moves after them), a missing result
 * gets a stub and an orphan result is dropped. Only Claude's own signed thinking survives.
 */
export function toAnthropic(messages: Message[]): Array<{ role: 'user' | 'assistant'; content: Array<Record<string, unknown>> }> {
  const out: Array<{ role: 'user' | 'assistant'; content: Array<Record<string, unknown>> }> = [];
  let pending = new Set<string>();
  let results: Array<Record<string, unknown>> | null = null;
  let at = -1;
  const close = () => {
    if (!pending.size) return;
    const stubs = [...pending].map((id) => ({ type: 'tool_result', tool_use_id: id, content: '[no tool result recorded]', is_error: true }));
    if (results) results.push(...stubs); else out.splice(at + 1, 0, { role: 'user', content: stubs });
    pending = new Set();
  };
  for (const m of messages) {
    if (m.role === 'user') {
      const content = userContent(m.content);
      out.push({ role: 'user', content: content.length ? content : [{ type: 'text', text: '[empty]' }] });
    } else if (m.role === 'assistant') {
      if (!m.content.length) continue; // aborted before anything streamed
      close();
      const blocks = m.content.flatMap((b): Array<Record<string, unknown>> => {
        if (b.type === 'text') return b.text ? [{ type: 'text', text: b.text }] : [];
        if (b.type === 'thinking') return m.provider === CLAUDE_CODE_PROVIDER && b.thinkingSignature ? [{ type: 'thinking', thinking: b.thinking, signature: b.thinkingSignature }] : [];
        return [{ type: 'tool_use', id: b.id, name: `${TOOL_PREFIX}${b.name}`, input: b.arguments ?? {} }];
      });
      out.push({ role: 'assistant', content: blocks.length ? blocks : [{ type: 'text', text: '[incompatible content omitted]' }] });
      at = out.length - 1;
      pending = new Set(m.content.flatMap((b) => b.type === 'toolCall' ? [b.id] : []));
      results = null;
    } else if (m.role === 'toolResult' && pending.delete(m.toolCallId)) {
      const images = m.content.some((b) => b.type === 'image');
      const content = images ? toMcp(m).content.map((b) => b.type === 'image' ? { type: 'image', source: { type: 'base64', media_type: b.mimeType, data: b.data } } : b)
        : m.content.map((b) => (b.type === 'text' ? b.text : '')).join('\n');
      const block = { type: 'tool_result', tool_use_id: m.toolCallId, content, is_error: m.isError };
      if (results) results.push(block); else { results = [block]; out.splice(at + 1, 0, { role: 'user', content: results }); }
    }
  }
  close();
  return out;
}
