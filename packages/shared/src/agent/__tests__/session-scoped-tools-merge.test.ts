import { describe, it, expect, beforeEach } from 'bun:test';
import {
  registerSessionScopedToolCallbacks,
  mergeSessionScopedToolCallbacks,
  getSessionScopedToolCallbacks,
  unregisterSessionScopedToolCallbacks,
} from '../session-scoped-tools.ts';

describe('session-scoped tool callback merge', () => {
  const sessionId = 'test-session-merge';

  beforeEach(() => {
    unregisterSessionScopedToolCallbacks(sessionId);
  });

  it('keeps callbacks registered earlier when merging turn-level callbacks', () => {
    const spawnSessionFn = async () => ({ sessionId: 'child', status: 'started' as const });
    registerSessionScopedToolCallbacks(sessionId, { spawnSessionFn: spawnSessionFn as never });

    const queryFn = async () => ({ text: 'ok', model: 'test' });
    mergeSessionScopedToolCallbacks(sessionId, { queryFn });

    const merged = getSessionScopedToolCallbacks(sessionId);
    expect(merged).toBeTruthy();
    expect(merged?.spawnSessionFn).toBe(spawnSessionFn as never);
    expect(merged?.queryFn).toBe(queryFn);
  });
});
