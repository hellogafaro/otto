import { Writable } from "node:stream";
import { createTool } from "@mastra/core/tools";
import type { Attempt } from "@otto/runs/runtime";
import { DomainError, required, withCleanup } from "@otto/shared";
import Docker from "dockerode";
import { z } from "zod";

export interface ComputerOptions {
  image: string;
  socketPath: string;
  ownerId: string;
}

const LIFETIME_SECONDS = 60;
const OUTPUT_BYTES = 16384;
const MEMORY_BYTES = 256 * 1024 * 1024;
const TMPFS = "rw,nosuid,nodev,noexec,size=64m,mode=1777";
const PROBE = `
const fs = require('node:fs');
if (process.getuid() !== 1000 || fs.readFileSync('/proc/1/comm', 'utf8').trim() !== 'sleep' || Number(fs.readFileSync('/proc/sys/kernel/yama/ptrace_scope', 'utf8')) < 1) process.exit(1);
try { fs.openSync('/proc/1/mem', 'r+'); process.exit(1); } catch {}
process.stdout.write('confined');
`;

export function createComputer(options: ComputerOptions) {
  if (
    !/^sha256:[a-f0-9]{64}$/.test(options.image) ||
    !options.socketPath.startsWith("/") ||
    !options.socketPath.endsWith(".sock") ||
    !/^[a-zA-Z0-9_-]{1,80}$/.test(options.ownerId)
  )
    throw new DomainError("invalid", "Computer deployment configuration");
  const docker = new Docker({ socketPath: options.socketPath, timeout: 2000 });
  const labels = {
    "otto.computer.owner": options.ownerId,
    "otto.computer.type": "offline-v1",
  };
  type Result = { exitCode: number; stdout: string; stderr: string };
  const entries = new Map<
    string,
    {
      computerId: string;
      toolCallId: string;
      code: string;
      abort: AbortController;
      work: Promise<Result>;
      cleaned: boolean;
      settled: boolean;
      destroy: () => Promise<void>;
    }
  >();
  const key = (attempt: Attempt) =>
    `${attempt.runId}:${attempt.attempt}:${attempt.launchKey}`;

  async function inspectOwned(container: Docker.Container, computerId: string) {
    const info = await container.inspect();
    const host = info.HostConfig;
    const config = info.Config;
    const environment = new Map(
      config.Env.map((item): [string, string] => {
        const separator = item.indexOf("=");
        return [item.slice(0, separator), item.slice(separator + 1)];
      }),
    );
    if (
      info.Id !== container.id ||
      info.Image !== options.image ||
      config.Labels?.["otto.computer.id"] !== computerId ||
      !Object.entries(labels).every(
        ([name, value]) => config.Labels?.[name] === value,
      ) ||
      config.User !== "node" ||
      (config.Entrypoint?.length ?? 0) !== 0 ||
      JSON.stringify(config.Cmd) !==
        JSON.stringify(["/bin/sleep", String(LIFETIME_SECONDS)]) ||
      host.NetworkMode !== "none" ||
      host.Privileged ||
      host.Init !== false ||
      !host.ReadonlyRootfs ||
      host.Memory !== MEMORY_BYTES ||
      host.MemorySwap !== MEMORY_BYTES ||
      host.CpuPeriod !== 100000 ||
      host.CpuQuota !== 50000 ||
      host.PidsLimit !== 64 ||
      JSON.stringify(host.CapDrop) !== JSON.stringify(["ALL"]) ||
      (host.CapAdd?.length ?? 0) !== 0 ||
      JSON.stringify(host.SecurityOpt) !==
        JSON.stringify(["no-new-privileges:true"]) ||
      host.PidMode ||
      host.IpcMode !== "private" ||
      host.UTSMode ||
      (host.VolumesFrom?.length ?? 0) !== 0 ||
      Object.keys(host.PortBindings ?? {}).length !== 0 ||
      (host.Binds?.length ?? 0) !== 0 ||
      (host.Devices?.length ?? 0) !== 0 ||
      (host.DeviceRequests?.length ?? 0) !== 0 ||
      (host.Mounts?.length ?? 0) !== 0 ||
      JSON.stringify(host.Tmpfs) !== JSON.stringify({ "/tmp": TMPFS }) ||
      environment.get("HOME") !== "/tmp" ||
      environment.get("PATH") !== "/usr/local/bin:/usr/bin:/bin" ||
      [...environment.keys()].some(
        (name) =>
          !["HOME", "PATH", "NODE_VERSION", "YARN_VERSION"].includes(name),
      )
    )
      throw new DomainError("unavailable", "Computer confinement mismatch");
    return info;
  }

  async function prepare() {
    const image = await docker.getImage(options.image).inspect();
    if (
      image.Id !== options.image ||
      image.Config.User !== "node" ||
      (image.Config.Entrypoint?.length ?? 0) !== 0 ||
      Object.keys(image.Config.Volumes ?? {}).length !== 0
    )
      throw new DomainError("unavailable", "Computer image unavailable");
    const containers = await docker.listContainers({
      all: true,
      filters: {
        label: Object.entries(labels).map(
          ([name, value]) => `${name}=${value}`,
        ),
      },
    });
    if (containers.length > 100)
      throw new DomainError("unavailable", "Computer cleanup backlog");
    for (const container of containers) {
      if (container.State === "running") continue;
      const computerId = container.Labels["otto.computer.id"];
      if (!computerId || !/^otto-[a-f0-9-]{36}$/.test(computerId))
        throw new DomainError(
          "unavailable",
          "Computer orphan identity mismatch",
        );
      const entry = [...entries.values()].find(
        (item) => item.computerId === computerId,
      );
      if (entry && !entry.settled) continue;
      if (entry) {
        await entry.destroy();
        continue;
      }
      const handle = docker.getContainer(container.Id);
      const info = await inspectOwned(handle, computerId);
      if (info.State.Running)
        throw new DomainError("unavailable", "Computer orphan still running");
      await handle.remove();
    }
    if (
      containers.filter((container) => container.State === "running").length >=
      4
    )
      throw new DomainError("unavailable", "Computer capacity");
  }

  return {
    prepare,
    tool(
      attempt: Attempt,
      signal: AbortSignal,
      authorize: () => Promise<void>,
    ) {
      return createTool({
        id: "computer_execute",
        description:
          "Run one bounded offline JavaScript computation in a fresh confined computer for this Run. Node.js only, no network, host files, credentials or browser. Use stdout for a small result and existing File/Chat tools to save it. The computer and all child processes are destroyed before the result is returned; no files persist. Only one computation is allowed per Run.",
        inputSchema: z.object({ code: z.string().min(1).max(16384) }).strict(),
        execute: async ({ code }, context) => {
          const toolCallId = required(context?.agent?.toolCallId, "forbidden");
          const external = context?.abortSignal
            ? AbortSignal.any([signal, context.abortSignal])
            : signal;
          external.throwIfAborted();
          await authorize();
          const identity = key(attempt);
          const prior = entries.get(identity);
          if (prior) {
            if (prior.toolCallId !== toolCallId || prior.code !== code)
              throw new DomainError(
                "conflict",
                "Computer already used by this Run",
              );
            const result = await prior.work;
            external.throwIfAborted();
            await authorize();
            return result;
          }
          if (
            [...entries.values()].filter((entry) => !entry.cleaned).length >= 4
          )
            throw new DomainError("unavailable", "Computer capacity");
          const abort = new AbortController();
          const combined = AbortSignal.any([external, abort.signal]);
          const computerId = `otto-${crypto.randomUUID()}`;
          let container: Docker.Container | undefined;
          let createSent = false;
          let createRejected = false;
          let provisioning: Promise<void> | undefined;
          let removal: Promise<void> | undefined;
          const entry = {
            computerId,
            toolCallId,
            code,
            abort,
            work: Promise.resolve({ exitCode: 0, stdout: "", stderr: "" }),
            cleaned: false,
            settled: false,
            destroy,
          };
          async function destroy() {
            if (entry.cleaned) return;
            removal ??= (async () => {
              await provisioning?.catch(() => {});
              if (!createSent || createRejected) {
                entry.cleaned = true;
                return;
              }
              if (!container) {
                const matches = await docker.listContainers({
                  all: true,
                  filters: { label: [`otto.computer.id=${computerId}`] },
                });
                if (matches.length !== 1)
                  throw new DomainError(
                    "unavailable",
                    "Computer provisioning outcome unconfirmed",
                  );
                container = docker.getContainer(
                  required(matches[0], "unavailable").Id,
                );
              }
              try {
                await inspectOwned(container, computerId);
                await container.remove({ force: true, v: true });
              } catch (error) {
                if (
                  !(
                    typeof error === "object" &&
                    error !== null &&
                    "statusCode" in error &&
                    error.statusCode === 404
                  )
                )
                  throw error;
              }
              entry.cleaned = true;
            })();
            try {
              await removal;
            } finally {
              removal = undefined;
            }
          }
          entries.set(identity, entry);
          const timer = setTimeout(() => abort.abort(), 20000);
          const stop = () => {
            void destroy().catch(() => {});
          };
          combined.addEventListener("abort", stop, { once: true });
          async function execute(
            source: string,
            limit: number,
          ): Promise<Result> {
            const handle = required(container, "unavailable");
            const info = await inspectOwned(handle, computerId);
            if (!info.State.Running)
              throw new DomainError("unavailable", "Computer not running");
            combined.throwIfAborted();
            await authorize();
            const execution = await handle.exec({
              Cmd: ["node", "-e", source],
              AttachStdout: true,
              AttachStderr: true,
              AttachStdin: false,
              Tty: false,
              WorkingDir: "/tmp",
              User: "node",
            });
            combined.throwIfAborted();
            const stream = await execution.start({
              hijack: true,
              stdin: false,
            });
            const stdout: Buffer[] = [];
            const stderr: Buffer[] = [];
            let bytes = 0;
            const sink = (output: Buffer[]) =>
              new Writable({
                write(chunk: Buffer, _encoding, callback) {
                  bytes += chunk.length;
                  if (bytes > limit) abort.abort();
                  else output.push(Buffer.from(chunk));
                  callback();
                },
              });
            const cancel = () =>
              stream.destroy(new Error("Computer execution stopped"));
            combined.addEventListener("abort", cancel, { once: true });
            try {
              await new Promise<void>((resolve, reject) => {
                stream.once("end", resolve);
                stream.once("close", resolve);
                stream.once("error", reject);
                docker.modem.demuxStream(stream, sink(stdout), sink(stderr));
                if (combined.aborted) cancel();
              });
            } finally {
              combined.removeEventListener("abort", cancel);
              stream.destroy();
            }
            combined.throwIfAborted();
            const result = await execution.inspect();
            if (result.Running || result.ExitCode === null)
              throw new DomainError(
                "unavailable",
                "Computer execution incomplete",
              );
            const output = {
              exitCode: result.ExitCode,
              stdout: Buffer.concat(stdout).toString(),
              stderr: Buffer.concat(stderr).toString(),
            };
            if (
              Buffer.byteLength(output.stdout) +
                Buffer.byteLength(output.stderr) >
              limit
            )
              throw new DomainError("unavailable", "Computer output limit");
            return output;
          }
          entry.work = withCleanup(
            async () => {
              try {
                await prepare();
                combined.throwIfAborted();
                await authorize();
                const existing = await docker.listContainers({
                  all: true,
                  filters: { label: [`otto.computer.id=${computerId}`] },
                });
                if (existing.length)
                  throw new DomainError(
                    "unavailable",
                    "Computer identity already exists",
                  );
                combined.throwIfAborted();
                provisioning = (async () => {
                  createSent = true;
                  try {
                    container = await docker.createContainer({
                      name: computerId,
                      Image: options.image,
                      User: "node",
                      Entrypoint: [],
                      Cmd: ["/bin/sleep", String(LIFETIME_SECONDS)],
                      Env: ["HOME=/tmp", "PATH=/usr/local/bin:/usr/bin:/bin"],
                      WorkingDir: "/tmp",
                      Labels: { ...labels, "otto.computer.id": computerId },
                      HostConfig: {
                        NetworkMode: "none",
                        Privileged: false,
                        Init: false,
                        Memory: MEMORY_BYTES,
                        MemorySwap: MEMORY_BYTES,
                        CpuPeriod: 100000,
                        CpuQuota: 50000,
                        PidsLimit: 64,
                        ReadonlyRootfs: true,
                        CapDrop: ["ALL"],
                        SecurityOpt: ["no-new-privileges:true"],
                        Tmpfs: { "/tmp": TMPFS },
                      },
                    });
                  } catch (error) {
                    createRejected =
                      typeof error === "object" &&
                      error !== null &&
                      "statusCode" in error &&
                      [400, 403, 404, 409].includes(Number(error.statusCode));
                    throw error;
                  }
                  await inspectOwned(container, computerId);
                  combined.throwIfAborted();
                  await authorize();
                  await container.start();
                })();
                await provisioning;
                combined.throwIfAborted();
                const probe = await execute(PROBE, 64);
                if (probe.exitCode !== 0 || probe.stdout !== "confined")
                  throw new DomainError(
                    "unavailable",
                    "Computer confinement unavailable",
                  );
                const result = await execute(code, OUTPUT_BYTES);
                combined.throwIfAborted();
                await authorize();
                return result;
              } catch {
                throw new DomainError(
                  "unavailable",
                  "Computer execution unavailable",
                );
              }
            },
            async () => {
              clearTimeout(timer);
              combined.removeEventListener("abort", stop);
              try {
                await destroy();
              } catch {
                throw new DomainError(
                  "unavailable",
                  "Computer cleanup unconfirmed",
                );
              }
            },
          ).finally(() => {
            entry.settled = true;
          });
          const result = await entry.work;
          external.throwIfAborted();
          await authorize();
          return result;
        },
      });
    },
    async cleanup(attempt: Attempt) {
      const identity = key(attempt);
      const entry = entries.get(identity);
      if (!entry) return;
      entry.abort.abort();
      await entry.work.catch(() => {});
      try {
        await entry.destroy();
      } catch {
        throw new DomainError("unavailable", "Computer cleanup unconfirmed");
      }
      if (!entry.cleaned)
        throw new DomainError("unavailable", "Computer cleanup unconfirmed");
      entries.delete(identity);
    },
  };
}
