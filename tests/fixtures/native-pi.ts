import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type {
  ComputerBackend,
  ComputerProcess,
  ProcessInspection,
} from "../../packages/environments/src";

/** Actual packaged Pi on a private scratch directory, ONLY a controlled transport fixture. No physical isolation/provisioning claim. */
export class NativePiComputer implements ComputerBackend {
  provider = "native-pi-controlled-fixture";
  readonly inputs: Parameters<ComputerBackend["launch"]>[0][] = [];
  readonly executions = new Map<
    string,
    {
      process: ComputerProcess;
      directory: string;
      child: ReturnType<typeof Bun.spawn>;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  async inspectComputer() {
    return {
      capabilities: {
        isolated: true,
        persistent: true,
        scopeIsolation: true,
        launchLookup: true,
        deadline: true,
        treeStop: true,
        stdio: true,
        files: true,
      },
    };
  }
  async launch(
    input: Parameters<ComputerBackend["launch"]>[0],
  ): Promise<ComputerProcess> {
    const existing = this.executions.get(input.launchKey);
    if (existing) return existing.process;
    this.inputs.push(input);
    const directory = await mkdtemp(join(tmpdir(), "otto-native-pi-"));
    for (const file of input.files) {
      const target = resolve(directory, file.path);
      if (!target.startsWith(`${directory}/`))
        throw new Error("Controlled path outside scratch");
      await mkdir(dirname(target), { recursive: true });
      await Bun.write(target, file.bytes);
    }
    const child = Bun.spawn(["setsid", ...input.argv], {
      cwd: directory,
      env: {
        PATH: "/usr/bin:/bin",
        HOME: directory,
        XDG_CONFIG_HOME: directory,
        ...input.env,
        TMPDIR: directory,
        // jiti otherwise ignores TMPDIR when it equals cwd and falls back to /tmp.
        JITI_RESPECT_TMPDIR_ENV: "1",
      },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    // Consume bounded stderr, preserving no process/account/credential values in logs.
    const errors = (async () => {
      const reader = child.stderr.getReader();
      let bytes = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.length;
          if (bytes > 1048576) {
            child.kill();
            break;
          }
        }
      } finally {
        await reader.cancel();
        reader.releaseLock();
      }
    })();
    const process: ComputerProcess = {
      reference: input.launchKey,
      stdout: child.stdout,
      exit: child.exited,
      async write(bytes) {
        child.stdin.write(bytes);
        await child.stdin.flush();
      },
      async stop() {
        const signal = Bun.spawnSync(["kill", "-TERM", "--", `-${child.pid}`], {
          stdout: "ignore",
          stderr: "ignore",
        });
        if (
          signal.exitCode !== 0 &&
          child.exitCode === null &&
          !child.signalCode
        )
          return { stopped: false };
        const stopped = await Promise.race([
          child.exited.then(() => true),
          new Promise<boolean>((resolve) => {
            const timer = setTimeout(() => resolve(false), 3000);
            timer.unref();
          }),
        ]);
        if (!stopped) return { stopped: false };
        await errors;
        const remaining = Bun.spawnSync(["kill", "-0", "--", `-${child.pid}`], {
          stdout: "ignore",
          stderr: "ignore",
        });
        return { stopped: remaining.exitCode !== 0 };
      },
      async detach() {},
    };
    const timer = setTimeout(
      () => {
        void process.stop();
      },
      Math.max(1, input.deadlineAt.getTime() - Date.now()),
    );
    this.executions.set(input.launchKey, { process, directory, child, timer });
    return process;
  }
  async lookup(
    _computerRef: string,
    launchKey: string,
  ): Promise<ProcessInspection> {
    const execution = this.executions.get(launchKey);
    if (!execution) return { state: "absent" };
    if (execution.child.exitCode === null && !execution.child.signalCode)
      return { state: "running", process: execution.process };
    const stopped = await execution.process.stop();
    return {
      state: "exited",
      reference: execution.process.reference,
      exitCode: await execution.child.exited,
      stopped: stopped.stopped,
    };
  }
  async close() {
    for (const execution of this.executions.values()) {
      clearTimeout(execution.timer);
      if (!(await execution.process.stop()).stopped)
        throw new Error("Controlled process cleanup unconfirmed");
      await rm(execution.directory, { recursive: true, force: true });
    }
    this.executions.clear();
  }
}
