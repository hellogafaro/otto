/**
 * GroupRoundReactor - Runs group chat rounds. Every bot hears a person's
 * message; after a short quiet window the bots answer one at a time.
 *
 * @module GroupRoundReactor
 */
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

export interface GroupRoundReactorShape {
  /** Start reacting to group chat messages and turn endings. */
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;

  /** Resolves when every received event and timer has been handled. For tests. */
  readonly drain: Effect.Effect<void>;
}

export class GroupRoundReactor extends Context.Service<GroupRoundReactor, GroupRoundReactorShape>()(
  "@otto/server/orchestration/Services/GroupRoundReactor",
) {}
