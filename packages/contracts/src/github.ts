import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./base-schemas.ts";

/**
 * GitHub links through the Otto GitHub App: a person's own, and the team's, which bots use for
 * anyone without their own. Tokens never leave the server.
 */
export const GitHubStatus = Schema.Struct({
  /** The linked GitHub login, or null when this person has not connected GitHub. */
  login: Schema.NullOr(TrimmedNonEmptyString),
  /** The team's GitHub login, or null when nobody connected one for the team. */
  teamLogin: Schema.NullOr(TrimmedNonEmptyString),
  /** Where the person adds repositories to the Otto GitHub App. */
  installUrl: TrimmedNonEmptyString,
});

export type GitHubStatus = typeof GitHubStatus.Type;

/** Which link a start, poll or disconnect acts on: the person's own, or the team's. */
export const GitHubLinkTarget = Schema.Struct({
  team: Schema.optional(Schema.Boolean),
});

export type GitHubLinkTarget = typeof GitHubLinkTarget.Type;

/** The code a person enters on GitHub to link their account. */
export const GitHubLinkCode = Schema.Struct({
  userCode: TrimmedNonEmptyString,
  verificationUri: TrimmedNonEmptyString,
  expiresAt: Schema.String,
  intervalSeconds: Schema.Number,
});

export type GitHubLinkCode = typeof GitHubLinkCode.Type;

export const GitHubLinkState = Schema.Literals(["pending", "connected", "expired", "denied"]);

export type GitHubLinkState = typeof GitHubLinkState.Type;

export const GitHubLinkPollResult = Schema.Struct({
  state: GitHubLinkState,
  ...GitHubStatus.fields,
});

export type GitHubLinkPollResult = typeof GitHubLinkPollResult.Type;

export class GitHubOperationError extends Schema.TaggedErrorClass<GitHubOperationError>()(
  "GitHubOperationError",
  {
    message: TrimmedNonEmptyString,
  },
) {}
