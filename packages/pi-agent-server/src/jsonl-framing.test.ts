import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Regression: the server framed stdin with `node:readline`, which also splits on U+2028 / U+2029.
 * Both are legal unescaped inside a JSON string, so a message carrying one was cut in half and
 * dropped ("Failed to parse JSONL"). Drives the real server over stdin from a scratch HOME.
 */

let scratchDir: string;

beforeAll(() => {
  scratchDir = mkdtempSync(join(tmpdir(), 'pi-jsonl-framing-'));
});

afterAll(() => {
  if (scratchDir) rmSync(scratchDir, { recursive: true, force: true });
});

function runServer(stdin: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(import.meta.dir, 'index.ts')], {
      cwd: scratchDir,
      env: { PATH: process.env.PATH ?? '', HOME: scratchDir, XDG_CONFIG_HOME: scratchDir, TMPDIR: scratchDir },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`timed out; stderr so far:\n${stderr.slice(-2000)}`));
    }, 30_000);
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('exit', () => {
      clearTimeout(timer);
      resolve(stderr);
    });
    child.stdin.end(stdin);
  });
}

describe('pi-agent-server stdin framing', () => {
  it('keeps U+2028 and U+2029 inside a JSON string in one message', async () => {
    const stderr = await runServer(`${JSON.stringify({ type: 'a b c' })}\n`);
    expect(stderr).toContain('Unknown message type: a b c');
    expect(stderr).not.toContain('Failed to parse JSONL');
  }, 30_000);
});
