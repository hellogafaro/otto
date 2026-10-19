import * as NodeCrypto from "node:crypto";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import { type SandboxSize } from "@otto/contracts";
import { type OttoRemoteSession } from "../bot-workspace-types.ts";
import { quote, commandLine } from "../bot-workspace-lifecycle.ts";

/**
 * Otto sizes, mapped to Boat machine types. Small is 2 vCPU and 4 GB, medium is
 * Boat's default (4 vCPU, 8 GB), large is 8 vCPU and 16 GB.
 */
export const BOAT_MACHINE_TYPES = {
  small: "small",
  medium: "default",
  large: "large",
} as const satisfies Record<SandboxSize, "small" | "default" | "large">;

export type BoatMachineType = (typeof BOAT_MACHINE_TYPES)[SandboxSize];

/** Shared with the session so a later acquire can change the size before the next resume. */
export interface BoatMachineTypeRef {
  current: BoatMachineType;
}

export function boatMachineType(size: SandboxSize): BoatMachineType {
  return BOAT_MACHINE_TYPES[size];
}

const DEFAULT_MACHINE_TYPE: BoatMachineTypeRef = { current: "default" };

/**
 * Boat stops a computer by itself this long after Otto last used it, even if Otto is down. Its
 * disk is kept and it resumes on the next turn; running turns push this back well before it
 * runs out (see `COMPUTER_KEEP_AWAKE_INTERVAL`).
 */
export const BOAT_TTL_SECONDS = 300;

/**
 * After a turn, Boat stops the computer this long after it unless another turn starts first:
 * short enough that an idle computer stops soon, long enough that a quick reply finds it awake
 * without spending one of the account's limited starts.
 */
export const BOAT_IDLE_SECONDS = 120;

/** Where a command's environment is written, under the only folders Boat's file API accepts. */
const ENVIRONMENT_FOLDER = "/home/user/.otto/env";

/** The exit code and message a command gives when its environment file is gone. */
const MISSING_ENVIRONMENT = { exitCode: 125, stderr: "otto: environment file missing" };

async function boatErrorCode(cause: unknown): Promise<string | undefined> {
  const { ResponseError } = await import("@boatdev/sdk");

  if (!(cause instanceof ResponseError)) return undefined;
  const body: unknown = await cause.response
    .clone()
    .json()
    .catch(() => undefined);

  if (Predicate.hasProperty(body, "code") && Predicate.isString(body.code)) return body.code;
  if (
    Predicate.hasProperty(body, "error") &&
    Predicate.hasProperty(body.error, "code") &&
    Predicate.isString(body.error.code)
  ) {
    return body.error.code;
  }

  return undefined;
}

/** Boat's SDK reports every HTTP failure as "Response returned an error code"; surface its message. */
export async function boatFailure(cause: unknown): Promise<Error> {
  const { ResponseError } = await import("@boatdev/sdk");

  if (!(cause instanceof ResponseError))
    return cause instanceof Error ? cause : new Error(String(cause));

  const body: unknown = await cause.response
    .clone()
    .json()
    .catch(() => undefined);

  const message =
    Predicate.hasProperty(body, "message") && Predicate.isString(body.message)
      ? body.message.trim()
      : "";

  return message ? new Error(`Boat: ${message}`, { cause }) : cause;
}

export function boat(
  client: import("@boatdev/sdk").BoatApi,
  sandboxId: string,
  machineType: BoatMachineTypeRef = DEFAULT_MACHINE_TYPE,
): OttoRemoteSession {
  const waitUntilArchived = async () => {
    const deadline = performance.now() + 300_000;

    while (true) {
      const { sandbox } = await client.get({ sandboxId });

      if (sandbox.state === "archived") return;

      if (sandbox.state === "error") throw new Error("Boat snapshot archival failed.");

      if (performance.now() >= deadline) throw new Error("Boat snapshot archival timed out.");
      await Effect.runPromise(Effect.sleep(2_000));
    }
  };

  const state = async () => {
    try {
      const { sandbox } = await client.get({ sandboxId });

      return sandbox.state;
    } catch (cause) {
      const { ResponseError } = await import("@boatdev/sdk");

      if (cause instanceof ResponseError && cause.response.status === 404) return "gone";
      throw cause;
    }
  };

  // A running computer cannot change size. The next resume, after Boat has archived it,
  // applies the size. A shrink Boat refuses leaves the computer on its current machine.
  const resume = async (type: BoatMachineType) => {
    try {
      await client.resume({
        sandboxId,
        resumeRequest: { ttlSeconds: BOAT_TTL_SECONDS, type },
      });
    } catch (cause) {
      if ((await boatErrorCode(cause)) !== "type_too_small") throw cause;
      await client.resume({ sandboxId, resumeRequest: { ttlSeconds: BOAT_TTL_SECONDS } });
    }
  };

  const wake = async () => {
    const { sandbox } = await client.get({ sandboxId });

    if (sandbox.state === "archiving") await waitUntilArchived();

    if (sandbox.state === "archived" || sandbox.state === "archiving")
      await resume(machineType.current);
    const { waitUntilReady } = await import("@boatdev/sdk");
    await waitUntilReady(client, sandboxId, { timeoutMs: 300_000 });
  };

  /**
   * Runs a call that needs the machine; a computer Boat stopped meanwhile, such as while its
   * turn waited on a person, is resumed and the call is sent again, once.
   */
  const whenAwake = async <A>(call: () => Promise<A>): Promise<A> => {
    try {
      return await call();
    } catch (cause) {
      const { ResponseError } = await import("@boatdev/sdk");

      if (!(cause instanceof ResponseError) || cause.response.status !== 409) throw cause;
      const current = await state();

      if (current !== "archived" && current !== "archiving") throw cause;
      await wake();

      return call();
    }
  };

  const writeFile = async (path: string, content: string) => {
    await whenAwake(() =>
      client.writeFile({
        sandboxId,
        fileWriteRequest: {
          path,
          content: Buffer.from(content).toString("base64"),
          encoding: "base64",
        },
      }),
    ).catch(async (cause: unknown) => {
      throw await boatFailure(cause);
    });
  };

  // A turn's end and the next turn's start both set the auto-stop; they reach Boat in the
  // order Otto made them, so a late "idle" never shortens a working turn's computer.
  let deadlineChanges: Promise<unknown> = Promise.resolve();

  const inOrder = (change: () => Promise<void>): Promise<void> => {
    const next = deadlineChanges.then(change, change);
    deadlineChanges = next.catch(() => undefined);

    return next;
  };

  /**
   * Environment files this session wrote, by content, so each is written once. Names are random:
   * a name derived from the values would show up in command history and could be guessed back.
   */
  const written = new Map<string, string>();

  const environmentFile = async (environment: ReadonlyArray<readonly [string, string]>) => {
    const content = environment
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `export ${quote(`${key}=${value}`)}\n`)
      .join("");

    const saved = written.get(content);

    if (saved) return saved;
    const path = `${ENVIRONMENT_FOLDER}/${NodeCrypto.randomUUID()}`;
    await writeFile(path, content);
    written.set(content, path);

    return path;
  };

  return {
    providerId: sandboxId,
    inspect: async () => {
      const current = await state();

      if (["ready", "idle", "running"].includes(current)) return "running";

      return current === "error" || current === "gone" ? "missing" : "sleeping";
    },
    wake,
    // Stop takes a native lifecycle snapshot; never force-stop and discard VM changes. A VM that
    // Boat's auto-stop already archived, or that is gone, needs nothing.
    sleep: async () => {
      const current = await state();

      if (current === "archived" || current === "gone") return;

      if (current !== "archiving") await client.stop({ sandboxId });
      await waitUntilArchived();
    },
    destroy: async () => {
      let result = await client.deleteSandbox({ sandboxId, xAsciiConfirmDelete: sandboxId });
      const deadline = performance.now() + 300_000;

      while (result.operation.status !== "completed") {
        if (result.operation.status === "blocked" && (await state()) === "gone") return;

        if (performance.now() >= deadline)
          throw new Error(
            result.operation.status === "blocked"
              ? "Boat deletion is blocked."
              : "Boat deletion timed out.",
          );
        await Effect.runPromise(Effect.sleep(2_000));
        result = await client.getDeletionOperation({ operationId: result.operation.id });
      }
    },
    // Resumes a computer Boat's auto-stop archived, or pushes the auto-stop back on a running one.
    keepAlive: () =>
      inOrder(async () => {
        const current = await state();

        if (current === "archived" || current === "archiving") return wake();
        await client.update({ sandboxId, updateSandboxRequest: { ttlSeconds: BOAT_TTL_SECONDS } });
      }),
    // After a turn: Boat stops the computer soon unless another turn pushes it back first.
    idle: () =>
      inOrder(async () => {
        const current = await state();

        if (current === "archived" || current === "archiving" || current === "gone") return;
        await client.update({ sandboxId, updateSandboxRequest: { ttlSeconds: BOAT_IDLE_SECONDS } });
      }),
    desktopUrl: async () => {
      const { desktopUrl } = await client.desktop({ sandboxId }).catch(async (cause: unknown) => {
        throw await boatFailure(cause);
      });

      if (!desktopUrl) throw new Error("Boat has no desktop for this computer yet. Try again.");

      return desktopUrl;
    },
    writePrivateFile: writeFile,
    run: async (command, args, options) => {
      const timeout = options?.timeout ?? 600_000;

      if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 600_000)
        throw new Error("Boat command timeout must be greater than 0 and at most 600000 ms.");

      const invocation = options?.cwd
        ? `cd ${quote(options.cwd)} && ${commandLine(command, args)}`
        : commandLine(command, args);

      const environment = Object.entries(options?.env ?? {});

      const send = async () => {
        // Boat keeps every command's text in its history, so values never go in it: they go in
        // a file through the file API, and the command loads that file by its path.
        const path = environment.length > 0 ? await environmentFile(environment) : undefined;

        const result = await whenAwake(() =>
          client.command({
            sandboxId,
            commandRequest: {
              command: path
                ? `if [ -r ${quote(path)} ]; then . ${quote(path)}; else echo ${quote(MISSING_ENVIRONMENT.stderr)} >&2; exit ${MISSING_ENVIRONMENT.exitCode}; fi; ${invocation}`
                : invocation,
              timeoutSeconds: Math.ceil(timeout / 1_000),
            },
          }),
        );

        if (result.type !== "command.finished")
          throw new Error("Boat command did not finish in the foreground.");

        return {
          path,
          exitCode: result.timedOut ? 124 : (result.exitCode ?? (result.success ? 0 : 1)),
          stdout: result.stdout,
          stderr: result.stderr,
        };
      };

      let result = await send();

      // A computer replaced or cleaned since the file was written gets it again, once.
      if (
        result.path &&
        result.exitCode === MISSING_ENVIRONMENT.exitCode &&
        result.stderr.includes(MISSING_ENVIRONMENT.stderr)
      ) {
        for (const [content, path] of written) if (path === result.path) written.delete(content);
        result = await send();
      }

      return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
    },
  };
}
