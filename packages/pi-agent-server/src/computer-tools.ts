/**
 * Pi's built-in tools on a computer (`packages/shared/src/computer/types.ts`). The Computer lives
 * in the main process, so each command goes there over JSONL (`computer_exec`) and its output
 * streams back. Pi's tools take `operations` for this; only a turn whose prompt carried
 * `computer` uses them, every other turn runs the unchanged local tools.
 *
 * On a computer the tools work in box paths (C1): they are built for the turn's box folder, get
 * it as their context's cwd (Pi resolves relative paths against `ctx.cwd`), and `~` in a path is
 * the box's home, not the server's. grep and find are not offered on a computer (Pi's grep always
 * spawns a local ripgrep and find's glob has no portable shell form), so they tell the model to
 * use bash there.
 */

import type {
  BashOperations,
  EditOperations,
  LsOperations,
  ReadOperations,
  ToolDefinition,
  WriteOperations,
} from '@earendil-works/pi-coding-agent';
import type {
  PiComputerExecData,
  PiComputerExecExit,
  PiComputerExecKill,
  PiComputerExecRequest,
  PiTurnComputer,
} from '../../shared/src/agent/backend/pi/protocol.ts';

export type ComputerExecResult = { code: number; stdout: Buffer; stderr: Buffer };

export type ComputerExec = (
  argv: string[],
  options?: {
    cwd?: string;
    stdin?: string | Uint8Array;
    env?: Record<string, string>;
    signal?: AbortSignal;
    onData?: (chunk: Buffer) => void;
  },
) => Promise<ComputerExecResult>;

/** The subprocess end of the bridge: `exec` sends a request and settles on its `computer_exec_exit`. */
export function createComputerExecClient(send: (msg: PiComputerExecRequest | PiComputerExecKill) => void) {
  type Pending = {
    stdout: Buffer[];
    stderr: Buffer[];
    onData?: (chunk: Buffer) => void;
    resolve: (result: ComputerExecResult) => void;
    reject: (error: Error) => void;
  };
  const pending = new Map<string, Pending>();
  const nonce = Math.random().toString(36).slice(2, 10);
  let counter = 0;

  const exec: ComputerExec = (argv, options = {}) => new Promise((resolve, reject) => {
    const id = `pi-cx-${nonce}-${++counter}`;
    const { signal } = options;
    const onAbort = () => send({ type: 'computer_exec_kill', id });
    signal?.addEventListener('abort', onAbort, { once: true });
    pending.set(id, {
      stdout: [],
      stderr: [],
      onData: options.onData,
      resolve: (result) => { signal?.removeEventListener('abort', onAbort); resolve(result); },
      reject: (error) => { signal?.removeEventListener('abort', onAbort); reject(error); },
    });
    send({
      type: 'computer_exec',
      id,
      argv,
      ...(options.cwd ? { cwd: options.cwd } : {}),
      ...(options.stdin !== undefined ? { stdin: Buffer.from(options.stdin).toString('base64') } : {}),
      ...(options.env && Object.keys(options.env).length ? { env: options.env } : {}),
    });
  });

  return {
    exec,
    handleData(msg: PiComputerExecData): void {
      const run = pending.get(msg.id);
      if (!run) return;
      const chunk = Buffer.from(msg.data, 'base64');
      (msg.stream === 'stdout' ? run.stdout : run.stderr).push(chunk);
      run.onData?.(chunk);
    },
    handleExit(msg: PiComputerExecExit): void {
      const run = pending.get(msg.id);
      if (!run) return;
      pending.delete(msg.id);
      if (msg.error) run.reject(new Error(msg.error));
      else run.resolve({ code: msg.code, stdout: Buffer.concat(run.stdout), stderr: Buffer.concat(run.stderr) });
    },
  };
}

/** Run to completion; a non-zero exit is an error carrying the command's stderr. */
async function ok(exec: ComputerExec, argv: string[], stdin?: string): Promise<Buffer> {
  const { code, stdout, stderr } = await exec(argv, stdin === undefined ? {} : { stdin });
  if (code !== 0) throw new Error(stderr.toString('utf-8').trim() || `${argv[0]} exited with code ${code}`);
  return stdout;
}

/** The image types Pi's read tool sends to the model, by their first bytes. */
function imageMimeType(head: Buffer): string | null {
  if (head.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return 'image/png';
  if (head.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
  if (head.subarray(0, 4).toString('latin1') === 'GIF8') return 'image/gif';
  if (head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

/** `bashEnv`: what this turn's bash calls get on top (the `otto` CLI's URL and run token); other tools get nothing. */
export function createComputerOperations(exec: ComputerExec, bashEnv: () => Record<string, string> = () => ({})) {
  const readFile = (path: string) => ok(exec, ['cat', '--', path]);
  const writeFile = async (path: string, content: string) => {
    await ok(exec, ['sh', '-c', 'cat > "$1"', 'sh', path], content);
  };

  const bash: BashOperations = {
    exec: async (command, cwd, { onData, signal, timeout }) => {
      if (signal?.aborted) throw new Error('aborted');
      const timer = new AbortController();
      const timeoutHandle = timeout ? setTimeout(() => timer.abort(), timeout * 1000) : undefined;
      try {
        const { code } = await exec(['bash', '-c', command], {
          cwd,
          env: bashEnv(),
          signal: signal ? AbortSignal.any([signal, timer.signal]) : timer.signal,
          onData,
        });
        if (signal?.aborted) throw new Error('aborted');
        if (timer.signal.aborted) throw new Error(`timeout:${timeout}`);
        return { exitCode: code };
      } finally {
        clearTimeout(timeoutHandle);
      }
    },
  };
  const read: ReadOperations = {
    readFile,
    access: async (path) => { await ok(exec, ['test', '-r', path]); },
    detectImageMimeType: async (path) => imageMimeType(await ok(exec, ['head', '-c', '12', '--', path])),
  };
  const write: WriteOperations = {
    writeFile,
    mkdir: async (dir) => { await ok(exec, ['mkdir', '-p', '--', dir]); },
  };
  const edit: EditOperations = {
    readFile,
    writeFile,
    access: async (path) => { await ok(exec, ['sh', '-c', 'test -r "$1" && test -w "$1"', 'sh', path]); },
  };
  const ls: LsOperations = {
    exists: async (path) => (await exec(['test', '-e', path])).code === 0,
    stat: async (path) => {
      const { code } = await exec(['sh', '-c', 'test -e "$1" || exit 2; test -d "$1"', 'sh', path]);
      if (code === 2) throw new Error(`Path not found: ${path}`);
      return { isDirectory: () => code === 0 };
    },
    readdir: async (path) => (await ok(exec, ['ls', '-1A', '--', path])).toString('utf-8').split('\n').filter(Boolean),
  };
  return { bash, read, write, edit, ls };
}

/** A tool that is not offered on a computer: the model is told to use bash instead. */
export function unavailableOnComputer(tool: ToolDefinition<any, any>): ToolDefinition<any, any> {
  return {
    ...tool,
    execute: async () => {
      throw new Error(`${tool.name} is not available on this computer; use bash (for example rg or find) instead.`);
    },
  };
}

type Execute = ToolDefinition<any, any>['execute'];

/** `~` in a tool's `path` is the box's home on a computer (Pi would expand it to the server's). */
function boxHome<T>(params: T, home: string): T {
  const path = (params as { path?: unknown } | null)?.path;
  if (typeof path !== 'string' || (path !== '~' && !path.startsWith('~/'))) return params;
  return { ...params, path: path === '~' ? home : `${home}/${path.slice(2)}` };
}

/** The tool context with the box folder as cwd; copied by descriptors so Pi's lazy getters stay lazy. */
function withCwd<T>(ctx: T, cwd: string): T {
  const descriptors = ctx ? Object.getOwnPropertyDescriptors(ctx) : {};
  return Object.defineProperties({}, { ...descriptors, cwd: { value: cwd, enumerable: true } }) as T;
}

/**
 * `local` on the host; while the turn has a computer, the tool `onComputer(cwd)` builds for the turn's box folder,
 * with box paths. Same name, schema and prompt text either way.
 */
export function routeToComputer(
  local: ToolDefinition<any, any>,
  onComputer: (cwd: string) => ToolDefinition<any, any>,
  turnComputer: () => PiTurnComputer | null,
): ToolDefinition<any, any> {
  const built = new Map<string, ToolDefinition<any, any>>();
  const forBox = (cwd: string) => {
    let tool = built.get(cwd);
    if (!tool) built.set(cwd, (tool = onComputer(cwd)));
    return tool;
  };
  return {
    ...local,
    execute: ((id, params, signal, onUpdate, ctx) => {
      const box = turnComputer();
      if (!box) return local.execute(id, params, signal, onUpdate, ctx);
      return forBox(box.cwd).execute(id, boxHome(params, box.home), signal, onUpdate, withCwd(ctx, box.cwd));
    }) as Execute,
  };
}
