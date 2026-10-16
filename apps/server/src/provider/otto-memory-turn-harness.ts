import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schedule from "effect/Schedule";
import * as Semaphore from "effect/Semaphore";
import * as Scope from "effect/Scope";
import {
  type BotMemoryAccess,
  type BotMemoryReviewInput,
  type BotMemoryReviewReservation,
  type BotMemoryStore,
  formatBotMemoryPrompt,
} from "../memory/bot-memory.ts";
import { formatAutomaticBotMemoryReview } from "../memory/bot-memory-review.ts";
import type { OttoMemoryToolHandler } from "../memory/bot-memory-tool-handlers.ts";

export type OttoMemoryReviewMode = "foreground" | "deferred";

export interface OttoMemoryTurnAdmission {
  readonly access: BotMemoryAccess;
  readonly input: BotMemoryReviewInput;
  /**
   * When false the bot-private `MEMORY.md` is withheld from the supplied prompt
   * context, matching the "Private bot memory" setting. User and group memory
   * are unaffected.
   */
  readonly privateBotMemory?: boolean;
}

/**
 * Provider-neutral memory lifecycle for one admitted bot turn.
 *
 * Provider transports decide only where to deliver `context` (the memory documents) and `review`
 * (this turn's automatic review request, if due), and whether review execution is
 * foreground or deferred. Claim ownership, successful-prompt accounting, exact tool-call
 * verification, retries, and cleanup stay here.
 */
export class OttoMemoryTurn {
  readonly context: string;
  readonly review: string;
  readonly reviewIncluded: boolean;
  readonly access: BotMemoryAccess;

  private readonly store: BotMemoryStore;
  private readonly reservation: BotMemoryReviewReservation;
  get reviewCallContractSatisfied(): boolean {
    return this.successfulMemoryCalls === 1;
  }

  private successfulMemoryCalls = 0;
  private foregroundState: "pending" | "succeeded" | "failed" = "pending";
  private reviewSettled = false;
  private readonly semaphore = Effect.runPromise(Semaphore.make(1));
  private readonly scope: Scope.Scope;
  private scopeClosed = false;

  constructor(
    store: BotMemoryStore,
    access: BotMemoryAccess,
    reservation: BotMemoryReviewReservation,
    context: string,
    scope: Scope.Scope,
  ) {
    this.store = store;
    this.access = access;
    this.reservation = reservation;
    this.context = context;
    this.reviewIncluded = reservation.memoryReviewIncluded;
    this.review = this.reviewIncluded
      ? formatAutomaticBotMemoryReview(access.groupId !== null, reservation.reviewInputs)
      : "";
    this.scope = scope;
  }

  wrapMemoryHandler(handler: OttoMemoryToolHandler): OttoMemoryToolHandler {
    if (!this.reviewIncluded) return handler;

    return async (input) => {
      const result = await handler(input);
      this.successfulMemoryCalls += 1;

      return result;
    };
  }

  async finishForeground(succeeded: boolean, mode: OttoMemoryReviewMode): Promise<void> {
    return this.exclusive(async () => {
      if (this.foregroundState === "pending") {
        if (succeeded) {
          await this.store.recordSuccessfulPrompt(this.reservation);
          this.foregroundState = "succeeded";
        } else {
          this.foregroundState = "failed";
        }
      }

      if (this.foregroundState === "failed") {
        await this.settleReview(false);

        return;
      }

      if (!this.reviewIncluded) {
        await this.closeScope();

        return;
      }

      if (mode === "foreground") {
        await this.settleReview(this.reviewCallContractSatisfied);
      }
    });
  }

  async finishDeferredReview(succeeded: boolean): Promise<void> {
    return this.exclusive(async () => {
      await this.settleReview(
        this.foregroundState === "succeeded" && succeeded && this.reviewCallContractSatisfied,
      );
    });
  }

  async close(): Promise<void> {
    return this.abandon();
  }

  async abandon(): Promise<void> {
    return this.exclusive(async () => {
      if (this.foregroundState === "pending") this.foregroundState = "failed";
      await this.settleReview(false);
    });
  }

  private async settleReview(completed: boolean): Promise<void> {
    if (this.reviewSettled) return;

    if (this.reviewIncluded) await this.store.settleReviewClaim(this.reservation, completed);
    this.reviewSettled = true;
    await this.closeScope();
  }

  private async closeScope(): Promise<void> {
    if (this.scopeClosed) return;
    this.scopeClosed = true;
    await Effect.runPromise(Scope.close(this.scope, Exit.void));
  }

  async settleFromScope(): Promise<void> {
    if (this.reviewSettled) return;

    if (this.reviewIncluded) await this.store.settleReviewClaim(this.reservation, false);
    this.reviewSettled = true;
  }

  private exclusive(operation: () => Promise<void>): Promise<void> {
    return this.semaphore.then((semaphore) =>
      Effect.runPromise(Semaphore.withPermit(semaphore)(Effect.promise(operation))),
    );
  }
}

export class OttoMemoryTurnHarness {
  private readonly store: BotMemoryStore;

  constructor(store: BotMemoryStore) {
    this.store = store;
  }

  async admit({
    access,
    input,
    privateBotMemory,
  }: OttoMemoryTurnAdmission): Promise<OttoMemoryTurn> {
    const reservation = await this.store.reserveReviewCadence(access.botId, input);
    const scope = await Effect.runPromise(Scope.make());

    try {
      const promptSnapshot = await this.store.readPromptSnapshot(access);

      const snapshot = formatBotMemoryPrompt(
        privateBotMemory === false
          ? { ...promptSnapshot, memory: { ...promptSnapshot.memory, content: "", charCount: 0 } }
          : promptSnapshot,
      );

      const turn = new OttoMemoryTurn(this.store, access, reservation, snapshot, scope);

      const store = this.store;
      await Effect.runPromise(
        Effect.gen(function* () {
          yield* Effect.acquireRelease(Effect.succeed(turn), () =>
            Effect.promise(() => turn.settleFromScope()),
          );

          if (turn.reviewIncluded) {
            yield* Effect.promise(() =>
              store.renewReviewClaim(reservation).catch(() => false),
            ).pipe(Effect.repeat(Schedule.fixed("20 seconds")), Effect.asVoid, Effect.forkScoped);
          }
        }).pipe(Effect.provideService(Scope.Scope, scope)),
      );

      return turn;
    } catch (cause) {
      await Effect.runPromise(Scope.close(scope, Exit.void));
      await this.store.settleReviewCadence(reservation, false);
      throw cause;
    }
  }
}
