/**
 * The run token of an agent turn (docs/final-plan.md PT): what the `otto` CLI an agent runs through bash shows the
 * server's `/api/agent/rpc`. Minted when a Pi turn starts, bound to the chat, its workspace and its user, and deleted
 * when the turn ends (or after `RUN_TOKEN_TTL_MS`, whichever is first). It is never stored: this map holds a SHA-256
 * of its secret, in memory only, and the token itself reaches nothing but the bash tool calls of that turn.
 *
 * A token is `<id>.<secret>`: the id finds the run, the secret's hash is compared in constant time.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createId } from '../id.ts';

export interface AgentRun {
  /** The run's id (the token's public half): what audit lines and the rate limit name. */
  id: string;
  chatId: string;
  workspaceId: string;
  /** Who every call runs as: the chat's user. */
  userId: string;
  /** The chat's agent, for audit lines only (it has no rights of its own). */
  agentId: string | null;
  expiresAt: number;
}

/** A turn longer than this loses the CLI: the bound for a turn whose end was never seen. */
export const RUN_TOKEN_TTL_MS = 60 * 60 * 1000;

const runs = new Map<string, AgentRun & { secretHash: Buffer }>();
let apiUrl: string | null = null;
let computerApiUrl: string | null = null;

const hash = (secret: string) => createHash('sha256').update(secret).digest();

/** Where the CLI reaches the server (the RPC port, on loopback). Set once the server listens; until then no turn gets a token. */
export function initAgentApiUrl(url: string | null): void {
  apiUrl = url;
}

/** The server's own HTTP address on the host (loopback), or null before it listens. */
export function getAgentApiUrl(): string | null {
  return apiUrl;
}

/**
 * Where the CLI inside an agent's box reaches the server (C1): `OTTO_COMPUTER_API_URL`, or the computer API
 * listener the server opens for boxes (`http://host.docker.internal:<port>`). Null = box turns get no token.
 */
export function initComputerApiUrl(url: string | null): void {
  computerApiUrl = url;
}

/**
 * A token for one turn, and the environment the turn's bash calls get: `OTTO_API_URL` and `OTTO_RUN_TOKEN`.
 * `computer`: the turn runs in a box, so the URL is the one the box can reach. Null when no server listens for
 * agents (tests, a process without one) or, for a box, when no address for boxes is known.
 */
export function createRunToken(
  run: Omit<AgentRun, 'id' | 'expiresAt'>,
  now = Date.now(),
  o: { computer?: boolean } = {},
): { token: string; env: { OTTO_API_URL: string; OTTO_RUN_TOKEN: string } } | null {
  const url = o.computer ? computerApiUrl : apiUrl;
  if (!url) return null;
  const id = createId();
  const secret = randomBytes(32).toString('base64url');
  runs.set(id, { ...run, id, expiresAt: now + RUN_TOKEN_TTL_MS, secretHash: hash(secret) });
  const token = `${id}.${secret}`;
  return { token, env: { OTTO_API_URL: url, OTTO_RUN_TOKEN: token } };
}

/** The run a token stands for, or null (unknown, wrong secret, expired: all alike). */
export function getRunByToken(token: unknown, now = Date.now()): AgentRun | null {
  if (typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  const entry = dot > 0 ? runs.get(token.slice(0, dot)) : undefined;
  if (!entry) return null;
  if (!timingSafeEqual(entry.secretHash, hash(token.slice(dot + 1)))) return null;
  if (entry.expiresAt <= now) {
    runs.delete(entry.id);
    return null;
  }
  const { secretHash: _, ...run } = entry;
  return run;
}

/** Ends a token (the turn ended, was aborted or failed). Unknown tokens are ignored. */
export function deleteRunToken(token: string): void {
  const dot = token.indexOf('.');
  if (dot > 0) runs.delete(token.slice(0, dot));
}
