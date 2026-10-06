/**
 * Main-process end of the Pi computer bridge: the subprocess's built-in tools ask for a command
 * (`computer_exec`), it runs on the turn's `Computer`, and the output streams back. The Computer
 * object lives here, in the server, so the subprocess only ever sees argv and bytes.
 */

import type { Computer, Spawned } from '../../../computer/types.ts';
import type { PiComputerExecData, PiComputerExecExit, PiComputerExecRequest } from './protocol.ts';

export function createComputerExecHost(send: (msg: PiComputerExecData | PiComputerExecExit) => void) {
  const running = new Map<string, Spawned>();
  /** Commands killed while their computer was still starting. */
  const killedEarly = new Set<string>();

  const pump = async (id: string, stream: ReadableStream<Uint8Array>, name: 'stdout' | 'stderr') => {
    const reader = stream.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      send({ type: 'computer_exec_data', id, stream: name, data: Buffer.from(value).toString('base64') });
    }
  };

  return {
    /** Runs the command; the computer is started first if it is not running (a box starts at its first tool call). */
    async exec(req: PiComputerExecRequest, computer: Computer | null): Promise<void> {
      if (!computer) {
        send({ type: 'computer_exec_exit', id: req.id, code: -1, error: 'This turn has no computer.' });
        return;
      }
      try {
        await computer.ensureRunning();
      } catch (error) {
        killedEarly.delete(req.id);
        send({ type: 'computer_exec_exit', id: req.id, code: -1, error: `The computer could not start: ${error instanceof Error ? error.message : String(error)}` });
        return;
      }
      if (killedEarly.delete(req.id)) {
        send({ type: 'computer_exec_exit', id: req.id, code: 130, error: 'aborted' });
        return;
      }
      let spawned: Spawned;
      try {
        spawned = computer.exec(req.argv, { ...(req.cwd ? { cwd: req.cwd } : {}), stdin: req.stdin !== undefined });
      } catch (error) {
        send({ type: 'computer_exec_exit', id: req.id, code: -1, error: error instanceof Error ? error.message : String(error) });
        return;
      }
      running.set(req.id, spawned);
      const stdin = req.stdin !== undefined && spawned.stdin
        ? Promise.resolve(spawned.stdin.write(Buffer.from(req.stdin, 'base64'))).then(() => spawned.stdin!.end())
        : undefined;
      void Promise.all([pump(req.id, spawned.stdout, 'stdout'), pump(req.id, spawned.stderr, 'stderr'), stdin, spawned.exited])
        .then(
          ([, , , code]) => send({ type: 'computer_exec_exit', id: req.id, code }),
          (error) => send({ type: 'computer_exec_exit', id: req.id, code: -1, error: error instanceof Error ? error.message : String(error) }),
        )
        .finally(() => running.delete(req.id));
    },

    kill(id: string): void {
      const spawned = running.get(id);
      if (spawned) spawned.kill();
      else killedEarly.add(id);
    },

    /** The subprocess is gone: nobody waits for these commands any more. */
    killAll(): void {
      for (const spawned of running.values()) spawned.kill();
      running.clear();
      killedEarly.clear();
    },
  };
}
