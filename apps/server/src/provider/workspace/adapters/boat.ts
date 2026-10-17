import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import { type OttoRemoteSession } from "../bot-workspace-types.ts";
import { quote, commandLine } from "../bot-workspace-lifecycle.ts";

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

export function boat(client: import("@boatdev/sdk").BoatApi, sandboxId: string): OttoRemoteSession {
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

  return {
    providerId: sandboxId,
    inspect: async () => {
      const current = await state();

      if (["ready", "idle", "running"].includes(current)) return "running";

      return current === "error" || current === "gone" ? "missing" : "sleeping";
    },
    wake: async () => {
      const { sandbox } = await client.get({ sandboxId });

      if (sandbox.state === "archiving") await waitUntilArchived();

      if (sandbox.state === "archived" || sandbox.state === "archiving")
        await client.resume({ sandboxId, resumeRequest: { ttlSeconds: null } });
      const { waitUntilReady } = await import("@boatdev/sdk");
      await waitUntilReady(client, sandboxId, { timeoutMs: 300_000 });
    },
    // Stop takes a native lifecycle snapshot; never force-stop and discard VM changes.
    sleep: async () => {
      await client.stop({ sandboxId });
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
    run: async (command, args, options) => {
      const timeout = options?.timeout ?? 600_000;

      if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 600_000)
        throw new Error("Boat command timeout must be greater than 0 and at most 600000 ms.");

      const env = Object.entries(options?.env ?? {}).map(([key, value]) =>
        quote(`${key}=${value}`),
      );

      const invocation = `${env.length ? `env ${env.join(" ")} ` : ""}${commandLine(command, args)}`;

      const result = await client.command({
        sandboxId,
        commandRequest: {
          command: options?.cwd ? `cd ${quote(options.cwd)} && ${invocation}` : invocation,
          timeoutSeconds: Math.ceil(timeout / 1_000),
        },
      });

      if (result.type !== "command.finished")
        throw new Error("Boat command did not finish in the foreground.");

      return {
        exitCode: result.timedOut ? 124 : (result.exitCode ?? (result.success ? 0 : 1)),
        stdout: result.stdout,
        stderr: result.stderr,
      };
    },
  };
}
