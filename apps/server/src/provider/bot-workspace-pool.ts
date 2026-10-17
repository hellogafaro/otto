import * as Match from "effect/Match";
import * as NodeCrypto from "node:crypto";

import { Workspace } from "@mastra/core/workspace";
import type { BotId, BotSandbox, ServerSettings } from "@otto/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as RcMap from "effect/RcMap";
import * as Scope from "effect/Scope";
import * as Schema from "effect/Schema";
import { Duration } from "effect";
import type { OttoBotWorkspace } from "./bot-workspace.ts";

/** Every bot gets its own computer; a thread without a bot gets its own. */
export function botRuntimeResourceScope(input: {
  readonly botId?: BotId;
  readonly threadId: string;
}): string {
  return input.botId ? `bot-${input.botId}` : `thread-${input.threadId}`;
}

export function botWorkspaceResourceKey(input: {
  readonly resourceScope: string;
  readonly cwd?: string;
  readonly sandbox?: BotSandbox | null;
  readonly credentialFingerprint?: string;
}): string {
  const sandbox = input.sandbox ?? "local";

  return sandbox === "local"
    ? `${sandbox}:${input.cwd ?? "no-workspace"}:${input.resourceScope}`
    : `${sandbox}:${input.credentialFingerprint ?? "no-credentials"}:${input.resourceScope}`;
}

export function botWorkspaceCredentialFingerprint(
  environment: Readonly<Record<string, string>>,
): string {
  return NodeCrypto.createHash("sha256")
    .update(
      JSON.stringify(
        Object.entries(environment).toSorted(([left], [right]) => left.localeCompare(right)),
      ),
    )
    .digest("hex");
}

/** A Boat key saved in Settings wins; BOAT_API_KEY in the server's environment is the fallback. */
export function botSandboxEnvironment(
  settings: ServerSettings["sandbox"],
  provider: Exclude<BotSandbox, "local">,
  serverBoatKey: string | undefined,
) {
  const configured = Object.fromEntries(
    settings.providers[provider].environment.flatMap((variable) =>
      variable.value.trim() ? [[variable.name, variable.value] as const] : [],
    ),
  );

  return provider === "boat" && serverBoatKey?.trim()
    ? { BOAT_API_KEY: serverBoatKey.trim(), ...configured }
    : configured;
}

export function botWorkspaceIdentity(resourceKey: string): string {
  // Credentials select a live client, not a new durable Railway VM.
  const identityKey = resourceKey.replace(/^railway:[^:]*:/, "railway:");

  return `otto-${NodeCrypto.createHash("sha256").update(identityKey).digest("hex").slice(0, 24)}`;
}

export interface BotWorkspaceLease {
  readonly workspace: OttoBotWorkspace;
  readonly wokeFromSleep: boolean;
  readonly release: () => Promise<void>;
}

class BotWorkspacePoolError extends Schema.TaggedErrorClass<BotWorkspacePoolError>()(
  "BotWorkspacePoolError",
  { message: Schema.String },
) {}

interface BotWorkspacePoolOptions {
  readonly idleTimeToLive?: Duration.Input;
  readonly clock?: Clock.Clock;
}

interface PooledWorkspace {
  readonly workspace: OttoBotWorkspace;
  readonly wokeFromSleep: boolean;
}

interface PoolState {
  readonly map: RcMap.RcMap<string, PooledWorkspace, BotWorkspacePoolError>;
  readonly scope: Scope.Closeable;
}

/**
 * Keeps one workspace alive while matching thread sessions use it. After the
 * final release the workspace stays awake for `idleTimeToLive` (zero by default), then sleeps.
 * The next acquire wakes the same workspace, and reports `wokeFromSleep` so
 * callers can reconnect resources, such as a browser, that outlived the sleep.
 * Computers are never deleted here; the computer sweep deletes the ones no bot owns.
 */
export class BotWorkspacePool {
  private readonly state: Promise<PoolState>;
  private readonly clock: Clock.Clock | undefined;
  private readonly references = new Map<string, number>();
  private readonly acquisitions = new Map<string, number>();
  private readonly creators = new Map<string, () => Promise<OttoBotWorkspace | Workspace>>();
  private readonly sleepers = new Map<string, OttoBotWorkspace>();
  private readonly waking = new Set<string>();
  private readonly failed = new Set<string>();
  private readonly retrying = new Set<string>();
  private readonly closing = new Map<string, Promise<void>>();
  private readonly identityLocks = new Map<string, Promise<void>>();

  constructor(options: BotWorkspacePoolOptions = {}) {
    this.clock = options.clock;
    this.state = this.run(
      Effect.gen({ self: this }, function* () {
        const scope = yield* Scope.make();

        const map = yield* RcMap.make({
          idleTimeToLive: options.idleTimeToLive ?? Duration.zero,
          lookup: (key: string) =>
            Effect.acquireRelease(this.open(key), ({ workspace }) => this.close(key, workspace)),
        }).pipe(Scope.provide(scope));

        return { map, scope };
      }),
    );
  }

  private run<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
    return Effect.runPromise(
      this.clock ? effect.pipe(Effect.provideService(Clock.Clock, this.clock)) : effect,
    );
  }

  private open(key: string): Effect.Effect<PooledWorkspace, BotWorkspacePoolError> {
    const sleeping = this.sleepers.get(key);
    this.sleepers.delete(key);
    const wokeFromSleep = sleeping !== undefined;
    this.waking.add(key);
    this.failed.delete(key);

    return Effect.tryPromise({
      try: async () => sleeping ?? (await this.creators.get(key)!()),
      catch: toPoolError,
    }).pipe(
      Effect.map((created) =>
        created instanceof Workspace ? wrapMastraWorkspace(created) : created,
      ),
      Effect.tap((workspace) =>
        Effect.tryPromise({ try: () => workspace.wake(), catch: toPoolError }).pipe(
          Effect.tapCause(() =>
            Match.value(workspace.provider).pipe(
              Match.when("local", () =>
                Effect.promise(() => workspace.destroy().catch(() => undefined)),
              ),
              Match.when("boat", () => Effect.void),
              Match.orElse(() =>
                Effect.sync(() => {
                  this.sleepers.set(key, workspace);
                }),
              ),
            ),
          ),
        ),
      ),
      Effect.map((workspace) => ({ workspace, wokeFromSleep })),
      Effect.tapCause(() =>
        Effect.sync(() => {
          this.failed.add(key);
        }),
      ),
      Effect.ensuring(Effect.sync(() => this.waking.delete(key))),
    );
  }

  private close(key: string, workspace: OttoBotWorkspace): Effect.Effect<void> {
    return Effect.suspend(() => {
      const finish = Promise.withResolvers<void>();
      this.closing.set(key, finish.promise);

      return Effect.tryPromise(() => workspace.sleep()).pipe(
        Effect.tap(() => Effect.sync(() => this.sleepers.set(key, workspace))),
        // Remote workspaces can remain usable after a pause failure; retain them for retry.
        Effect.tapError(() =>
          Match.value(workspace.provider).pipe(
            Match.when("local", () =>
              Effect.promise(() => workspace.destroy().catch(() => undefined)),
            ),
            Match.orElse(() =>
              Effect.sync(() => {
                this.sleepers.set(key, workspace);
                this.failed.add(key);
              }),
            ),
          ),
        ),
        Effect.catch((error) => Effect.die(error.cause)),
        Effect.ensuring(
          Effect.sync(() => {
            if (this.closing.get(key) === finish.promise) this.closing.delete(key);
            finish.resolve();
          }),
        ),
      );
    });
  }

  async acquire(
    key: string,
    create: () => Promise<OttoBotWorkspace | Workspace>,
  ): Promise<BotWorkspaceLease> {
    this.acquisitions.set(key, (this.acquisitions.get(key) ?? 0) + 1);

    try {
      // Credential-scoped Railway keys share one VM; open them one at a time so only one creates it.
      if (!key.startsWith("railway:")) return await this.acquireOnce(key, create);
      const identity = botWorkspaceIdentity(key);
      const previous = this.identityLocks.get(identity);
      const lock = Promise.withResolvers<void>();
      this.identityLocks.set(identity, lock.promise);
      await previous;

      try {
        return await this.acquireOnce(key, create);
      } finally {
        lock.resolve();

        if (this.identityLocks.get(identity) === lock.promise) this.identityLocks.delete(identity);
      }
    } finally {
      const remaining = (this.acquisitions.get(key) ?? 1) - 1;

      if (remaining === 0) this.acquisitions.delete(key);
      else this.acquisitions.set(key, remaining);
    }
  }

  private async acquireOnce(
    key: string,
    create: () => Promise<OttoBotWorkspace | Workspace>,
  ): Promise<BotWorkspaceLease> {
    // Callers that join a wake in flight also reconnect, matching the caller that started it.
    const joinedWake = this.waking.has(key);
    const { map } = await this.state;
    // A replacement must not start while the previous workspace for this key is still sleeping.
    await this.closing.get(key);
    this.creators.set(key, create);
    const joinsWake = joinedWake || this.waking.has(key) || !(await this.run(RcMap.has(map, key)));
    const leaseScope = await this.run(Scope.make());

    const pooled = await this.run(RcMap.get(map, key).pipe(Scope.provide(leaseScope))).catch(
      async (cause: unknown) => {
        await this.run(Scope.close(leaseScope, Exit.void));

        if (this.failed.delete(key)) {
          const retained = this.sleepers.has(key);
          await this.run(RcMap.invalidate(map, key));

          if (retained) this.failed.add(key);
        }

        throw cause;
      },
    );

    this.references.set(key, (this.references.get(key) ?? 0) + 1);
    let released = false;

    return {
      workspace: pooled.workspace,
      wokeFromSleep: joinsWake && pooled.wokeFromSleep,
      release: async () => {
        if (released) return;
        released = true;
        const remaining = (this.references.get(key) ?? 1) - 1;

        if (remaining > 0) this.references.set(key, remaining);
        else this.references.delete(key);

        await this.run(Scope.close(leaseScope, Exit.void));
      },
    };
  }

  /** Sleeps every workspace still awake, including idle ones kept for `idleTimeToLive`. */
  async shutdown(): Promise<void> {
    const { scope } = await this.state;
    await this.run(Scope.close(scope, Exit.void));
  }

  /** Retries failed pauses for retained remote workspaces. */
  async retryFailedSleeps(): Promise<void> {
    const results = await Promise.allSettled(
      [...this.failed].map(async (key) => {
        const workspace = this.sleepers.get(key);

        if (
          !workspace ||
          this.references.has(key) ||
          this.acquisitions.has(key) ||
          this.retrying.has(key)
        )
          return;
        this.retrying.add(key);
        const finish = Promise.withResolvers<void>();
        this.closing.set(key, finish.promise);

        try {
          await workspace.sleep();
          this.failed.delete(key);
        } finally {
          this.retrying.delete(key);

          if (this.closing.get(key) === finish.promise) this.closing.delete(key);
          finish.resolve();
        }
      }),
    );

    const failure = results.find((result) => result.status === "rejected");

    if (failure?.status === "rejected") throw failure.reason;
  }
}

function toPoolError(cause: unknown): BotWorkspacePoolError {
  return new BotWorkspacePoolError({
    message: cause instanceof Error ? cause.message : String(cause),
  });
}

function wrapMastraWorkspace(workspace: Workspace): OttoBotWorkspace {
  return {
    id: workspace.id,
    provider: "local",
    workspace,
    inspect: async () => "running",
    wake: () => workspace.init(),
    sleep: () => workspace.stop(),
    destroy: () => workspace.destroy(),
  };
}
