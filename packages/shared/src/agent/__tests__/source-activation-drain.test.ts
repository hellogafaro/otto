import { describe, expect, it } from 'bun:test';
import type { AgentEvent } from '@otto/core/types';
import {
  SourceActivationDrainController,
  type PendingActivationRestart,
} from '../source-activation-drain.ts';

// ============================================================
// Event builders
// ============================================================

function makeToolResult(toolUseId: string, toolName = 'mcp__session__source_test'): AgentEvent {
  return {
    type: 'tool_result',
    toolUseId,
    toolName,
    result: '✓ Source activated — the current turn will auto-restart with tools available',
    isError: false,
    turnId: 'turn-1',
  };
}

function makeTextComplete(text: string): AgentEvent {
  return {
    type: 'text_complete',
    text,
    isIntermediate: false,
    turnId: 'turn-2',
  };
}

/**
 * Build a consume function that hands out the given pending restarts in
 * order and returns null after they're exhausted.
 */
function consumeQueue(
  ...records: (PendingActivationRestart | null)[]
): () => PendingActivationRestart | null {
  const queue = [...records];
  return () => queue.shift() ?? null;
}

describe('SourceActivationDrainController', () => {
  it('drains consecutive tool_results, then fires BEFORE first non-tool_result', () => {
    const drain = new SourceActivationDrainController();
    const consume = consumeQueue(
      { sourceSlug: 'sourceA', userMessage: 'go' },
      null,
      null,
    );

    // tool_result A — captures
    expect(drain.shouldFireBeforeEvent(makeToolResult('A'))).toBeNull();
    expect(drain.observe(makeToolResult('A'), consume)).toBe(true);

    // tool_result B — drain
    expect(drain.shouldFireBeforeEvent(makeToolResult('B'))).toBeNull();
    expect(drain.observe(makeToolResult('B'), consume)).toBe(true);

    // tool_result C — drain
    expect(drain.shouldFireBeforeEvent(makeToolResult('C'))).toBeNull();
    expect(drain.observe(makeToolResult('C'), consume)).toBe(true);

    // text_complete — boundary; fires BEFORE yielding
    const fire = drain.shouldFireBeforeEvent(makeTextComplete('starting next turn'));
    expect(fire).not.toBeNull();
    expect(fire!.sourceSlug).toBe('sourceA');
    expect(drain.hasFired).toBe(true);
  });

  it('end-of-stream fallback fires when queue exhausts with captured pending', () => {
    const drain = new SourceActivationDrainController();
    drain.observe(makeToolResult('A'), () => ({ sourceSlug: 'sourceA', userMessage: 'go' }));
    // Pretend the queue drained naturally — no boundary event arrived.
    const fire = drain.shouldFireAtBoundary();
    expect(fire?.sourceSlug).toBe('sourceA');
  });

  it('no capture means no fire — even on non-tool_result event', () => {
    const drain = new SourceActivationDrainController();
    const consume = consumeQueue(null);
    drain.observe(makeToolResult('A', 'Read'), consume);
    expect(drain.shouldFireBeforeEvent(makeTextComplete('hi'))).toBeNull();
    expect(drain.shouldFireAtBoundary()).toBeNull();
  });

  it('is idempotent after firing through shouldFireBeforeEvent', () => {
    const drain = new SourceActivationDrainController();
    drain.observe(makeToolResult('A'), () => ({ sourceSlug: 'X', userMessage: 'm' }));
    const first = drain.shouldFireBeforeEvent(makeTextComplete('next'));
    expect(first).not.toBeNull();
    // Subsequent calls return null
    expect(drain.shouldFireBeforeEvent(makeTextComplete('another'))).toBeNull();
    expect(drain.shouldFireAtBoundary()).toBeNull();
  });

  it('preserves the first captured slug under racing pending restarts', () => {
    const drain = new SourceActivationDrainController();
    const consume = consumeQueue(
      { sourceSlug: 'firstWinner', userMessage: 'msg' },
      { sourceSlug: 'secondWinner', userMessage: 'msg' },
    );
    drain.observe(makeToolResult('A'), consume);
    drain.observe(makeToolResult('B'), consume);
    expect(drain.capturedSlug).toBe('firstWinner');
    expect(drain.shouldFireAtBoundary()?.sourceSlug).toBe('firstWinner');
  });
});
