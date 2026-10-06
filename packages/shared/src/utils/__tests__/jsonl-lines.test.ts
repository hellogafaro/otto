import { describe, expect, it } from 'bun:test';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { join } from 'node:path';
import { createLineSplitter, LineTooLongError, readLines } from '../jsonl-lines.ts';

const LS = ' ';
const PS = ' ';

function split(chunks: Array<Uint8Array | string>, maxLength?: number): string[] {
  const lines: string[] = [];
  const splitter = createLineSplitter((line) => lines.push(line), maxLength);
  for (const chunk of chunks) splitter.push(chunk);
  splitter.end();
  return lines;
}

const bytes = (s: string) => new TextEncoder().encode(s);

describe('why node:readline is not used', () => {
  it('readline splits a JSON line on U+2028 / U+2029 (this is the bug the splitter avoids)', async () => {
    const line = JSON.stringify({ text: `a${LS}b${PS}c` });
    const seen: string[] = [];
    const rl = createInterface({ input: Readable.from([`${line}\n`]) });
    rl.on('line', (l) => seen.push(l));
    await new Promise((resolve) => rl.on('close', resolve));
    expect(seen.length).toBe(3);
    expect(() => JSON.parse(seen[0]!)).toThrow();
  });
});

describe('createLineSplitter', () => {
  it('splits on \\n only, in order', () => {
    expect(split(['one\ntwo\nthree\n'])).toEqual(['one', 'two', 'three']);
  });

  it('keeps U+2028 / U+2029 inside a line and the JSON parses', () => {
    const value = { text: `a${LS}b${PS}c`, n: 1 };
    const [line, ...rest] = split([`${JSON.stringify(value)}\n`]);
    expect(rest).toEqual([]);
    expect(JSON.parse(line!)).toEqual(value);
  });

  it('survives a chunk boundary at every byte offset of a multi-byte string', () => {
    const payload = { text: `é€😀${LS}x${PS}日本語` };
    const data = bytes(`${JSON.stringify(payload)}\n${JSON.stringify(payload)}\n`);
    for (let i = 0; i <= data.length; i++) {
      const lines = split([data.slice(0, i), data.slice(i)]);
      expect(lines.map((l) => JSON.parse(l))).toEqual([payload, payload]);
    }
  });

  it('survives one byte per chunk', () => {
    const payload = { text: `😀${LS}\n` };
    const data = bytes(`${JSON.stringify(payload)}\n`);
    const lines = split(Array.from(data, (b) => Uint8Array.of(b)));
    expect(lines.map((l) => JSON.parse(l))).toEqual([payload]);
  });

  it('drops one trailing \\r and keeps empty lines', () => {
    expect(split(['a\r\n\r\n\nb\r\n'])).toEqual(['a', '', '', 'b']);
  });

  it('flushes a final line without a trailing newline on end', () => {
    expect(split(['a\nb'])).toEqual(['a', 'b']);
    expect(split([])).toEqual([]);
    expect(split(['a\n'])).toEqual(['a']);
  });

  it('does not truncate a 10 MB line', () => {
    const big = 'x'.repeat(10 * 1024 * 1024);
    const data = bytes(`${JSON.stringify({ big })}\n`);
    const chunks: Uint8Array[] = [];
    for (let i = 0; i < data.length; i += 65536) chunks.push(data.slice(i, i + 65536));
    const lines = split(chunks);
    expect(lines.length).toBe(1);
    expect(JSON.parse(lines[0]!).big.length).toBe(big.length);
  });

  it('throws LineTooLongError past the configured max', () => {
    expect(split(['x'.repeat(10) + '\n'], 10)).toEqual(['x'.repeat(10)]);
    expect(() => split(['x'.repeat(11)], 10)).toThrow(LineTooLongError);
    expect(() => split(['xxxxxx', 'xxxxxx\n'], 10)).toThrow(LineTooLongError);
    expect(() => split(['x'.repeat(11) + '\n'], 10)).toThrow(LineTooLongError);
  });
});

describe('readLines', () => {
  it('reads a stream, flushes on end and stops on request', async () => {
    const lines: string[] = [];
    let ended = false;
    const stream = Readable.from([bytes('a\nb'), bytes('c\n'), bytes('d')]);
    readLines(stream, { onLine: (l) => lines.push(l), onEnd: () => { ended = true; } });
    await new Promise((resolve) => stream.on('end', resolve));
    expect(lines).toEqual(['a', 'bc', 'd']);
    expect(ended).toBe(true);
  });

  it('reports a too-long line to onError and stops reading', async () => {
    const stream = Readable.from(['x'.repeat(50), 'y\n']);
    const lines: string[] = [];
    const errors: Error[] = [];
    readLines(stream, { onLine: (l) => lines.push(l), onError: (e) => errors.push(e) }, 10);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(lines).toEqual([]);
    expect(errors[0]).toBeInstanceOf(LineTooLongError);
  });
});

const child = join(import.meta.dir, 'fixtures', 'jsonl-echo-child.ts');

/** Spawn the echo child, write each message as `JSON.stringify(x) + '\n'`, read lines back. */
async function roundTrip(runtime: string, args: string[], messages: unknown[], chunked: boolean): Promise<unknown[]> {
  const proc = spawn(runtime, [...args, child], { stdio: ['pipe', 'pipe', 'inherit'] });
  const echoed: string[] = [];
  const done = new Promise<void>((resolve, reject) => {
    readLines(proc.stdout, { onLine: (l) => echoed.push(l), onEnd: resolve, onError: reject });
    proc.on('error', reject);
  });
  const data = bytes(messages.map((m) => `${JSON.stringify(m)}\n`).join(''));
  if (chunked) {
    // Odd-sized writes so multi-byte characters straddle pipe chunks.
    for (let i = 0; i < data.length; i += 7) proc.stdin.write(data.slice(i, i + 7));
  } else {
    proc.stdin.write(data);
  }
  proc.stdin.end();
  await done;
  return echoed.map((l) => JSON.parse(l));
}

const messages = [
  { type: 'prompt', text: `line sep${LS}para sep${PS}emoji 😀 escaped\\n newline\nsecond line\r\nthird` },
  { type: 'event', nested: { arr: [`${LS}`, `${PS}`, '日本語', 'é'] } },
  { type: 'big', text: `${LS}${'ab😀'.repeat(200_000)}${PS}` },
];

describe('JSONL round trip through a child process', () => {
  const runtimes: Array<[string, string, string[]]> = [['bun', process.execPath, []]];
  if (Bun.which('node')) runtimes.push(['node', Bun.which('node')!, ['--experimental-strip-types']]);

  for (const [name, exe, args] of runtimes) {
    for (const chunked of [false, true]) {
      it(`${name}: U+2028, U+2029, emoji and newline escapes survive (${chunked ? 'small' : 'whole'} writes)`, async () => {
        expect(await roundTrip(exe, args, messages, chunked)).toEqual(messages);
      }, 60_000);
    }
  }
});
