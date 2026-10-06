import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createBashToolDefinition,
  createEditToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  createGrepToolDefinition,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import type { Computer } from '../../shared/src/computer/types.ts';
import { createComputerExecHost } from '../../shared/src/agent/backend/pi/computer-exec.ts';
import { createComputerExecClient, createComputerOperations, routeToComputer, unavailableOnComputer } from './computer-tools.ts';

/** A computer that runs on this machine and records what it was asked to run. */
function recordingComputer(calls: string[][]): Computer {
  return {
    id: 'test',
    ensureRunning: async () => {},
    stop: async () => {},
    exec(argv, o = {}) {
      calls.push(argv);
      const proc = Bun.spawn(argv, { cwd: o.cwd, stdin: o.stdin ? 'pipe' : 'ignore', stdout: 'pipe', stderr: 'pipe' });
      return {
        stdin: o.stdin ? proc.stdin as never : undefined,
        stdout: proc.stdout,
        stderr: proc.stderr,
        exited: proc.exited,
        kill: (signal) => proc.kill(signal as never),
      };
    },
  };
}

/** Subprocess client and main-process host wired back to back, as over JSONL. */
function bridge(computer: Computer | null) {
  let client!: ReturnType<typeof createComputerExecClient>;
  const host = createComputerExecHost((msg) => {
    const wire = JSON.parse(JSON.stringify(msg));
    if (wire.type === 'computer_exec_data') client.handleData(wire);
    else client.handleExit(wire);
  });
  client = createComputerExecClient((msg) => {
    const wire = JSON.parse(JSON.stringify(msg));
    if (wire.type === 'computer_exec') host.exec(wire, computer);
    else host.kill(wire.id);
  });
  return client;
}

const text = (result: { content: Array<{ type: string; text?: string }> }) =>
  result.content.map((c) => c.text ?? '').join('');

describe('Pi built-in tools on a computer', () => {
  let dir: string;
  let calls: string[][];
  let ops: ReturnType<typeof createComputerOperations>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pi-computer-tools-'));
    calls = [];
    ops = createComputerOperations(bridge(recordingComputer(calls)).exec);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('writes, reads, edits and lists through Computer.exec', async () => {
    const write = createWriteToolDefinition(dir, { operations: ops.write });
    await write.execute('w', { path: 'notes/a.txt', content: 'hello world\n' }, undefined, undefined, undefined as never);
    expect(readFileSync(join(dir, 'notes/a.txt'), 'utf-8')).toBe('hello world\n');

    const read = createReadToolDefinition(dir, { operations: ops.read });
    expect(text(await read.execute('r', { path: 'notes/a.txt' }, undefined, undefined, undefined as never))).toContain('hello world');

    const edit = createEditToolDefinition(dir, { operations: ops.edit });
    await edit.execute('e', { path: 'notes/a.txt', edits: [{ oldText: 'world', newText: 'computer' }] }, undefined, undefined, undefined as never);
    expect(readFileSync(join(dir, 'notes/a.txt'), 'utf-8')).toBe('hello computer\n');

    const ls = createLsToolDefinition(dir, { operations: ops.ls });
    expect(text(await ls.execute('l', { path: 'notes' }, undefined, undefined, undefined as never))).toContain('a.txt');

    expect(calls.map((argv) => argv[0])).toEqual(expect.arrayContaining(['mkdir', 'sh', 'cat', 'test', 'head', 'ls']));
  });

  it('runs bash in the computer, streaming its output with the exit code', async () => {
    const bash = createBashToolDefinition(dir, { operations: ops.bash });
    const result = await bash.execute('b', { command: 'echo out; echo err >&2' }, undefined, undefined, undefined as never);
    expect(text(result)).toContain('out');
    expect(text(result)).toContain('err');
    expect(calls[0]!.slice(0, 2)).toEqual(['bash', '-c']);
    await expect(bash.execute('b2', { command: 'exit 3' }, undefined, undefined, undefined as never)).rejects.toThrow(/code 3/);
  });

  it('kills the command when the tool is aborted', async () => {
    const abort = new AbortController();
    const started = Date.now();
    const running = ops.bash.exec('sleep 5', dir, { onData: () => {}, signal: abort.signal });
    setTimeout(() => abort.abort(), 50);
    await expect(running).rejects.toThrow('aborted');
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('reports a missing file as an error, not as empty content', async () => {
    await expect(ops.read.readFile(join(dir, 'missing.txt'))).rejects.toThrow(/No such file/);
  });

  it('fails a command when the turn has no computer', async () => {
    const noComputer = createComputerOperations(bridge(null).exec);
    await expect(noComputer.read.readFile(join(dir, 'x'))).rejects.toThrow('This turn has no computer.');
  });
});

describe('routeToComputer', () => {
  const fake = (name: string, answer: string) => ({
    name,
    label: name,
    description: name,
    parameters: {} as never,
    execute: async () => ({ content: [{ type: 'text' as const, text: answer }], details: undefined }),
  }) as unknown as ToolDefinition<any, any>;

  it('keeps the local tool unless the turn has a computer', async () => {
    let onComputer = false;
    const tool = routeToComputer(fake('read', 'host'), fake('read', 'box'), () => onComputer);
    expect(text(await tool.execute('1', {}, undefined, undefined, undefined as never))).toBe('host');
    onComputer = true;
    expect(text(await tool.execute('2', {}, undefined, undefined, undefined as never))).toBe('box');
    expect(tool.name).toBe('read');
  });

  it('turns grep away on a computer and points at bash', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pi-computer-grep-'));
    try {
      writeFileSync(join(dir, 'a.txt'), 'needle\n');
      const grep = createGrepToolDefinition(dir);
      const tool = routeToComputer(grep, unavailableOnComputer(grep), () => true);
      await expect(tool.execute('g', { pattern: 'needle' }, undefined, undefined, undefined as never)).rejects.toThrow(/use bash/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
