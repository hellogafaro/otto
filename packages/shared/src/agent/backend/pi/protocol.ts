/** Raw Pi SDK context metadata on JSONL events/responses. No runtime imports. */
export interface PiContextUsagePayload {
  contextUsage?: { tokens: number | null; contextWindow: number; percent?: number | null };
  compactionSettings?: { enabled: boolean; reserveTokens: number };
}

export interface PiCompactResult extends PiContextUsagePayload {
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  /** Fresh local estimate supplied by the SDK, not pre-compaction API usage. */
  estimatedTokensAfter?: number;
}

/**
 * Subprocess → main: should this large tool result be summarized? The decision
 * layer lives in the main process (decision model, toggle `largeResults`).
 */
export interface PiLargeResultGateRequest {
  type: 'large_result_gate_request';
  requestId: string;
  toolName: string;
  intent?: string;
  /** The start of the result; the gate reads less than this. */
  text: string;
  estimatedTokens: number;
}

/** Main → subprocess: `false` = the preview and saved file are enough; `true`/`null` = summarize. */
export interface PiLargeResultGateResponse {
  type: 'large_result_gate_response';
  requestId: string;
  summarize: boolean | null;
}

/**
 * Subprocess → main: run a built-in tool's command on the turn's computer (`Computer.exec`).
 * Sent only for turns whose prompt carried `computer: true`; byte payloads are base64.
 */
export interface PiComputerExecRequest {
  type: 'computer_exec';
  id: string;
  argv: string[];
  cwd?: string;
  /** Written to the command's stdin, then closed. */
  stdin?: string;
}

/** Subprocess → main: the tool was aborted; kill the command. */
export interface PiComputerExecKill {
  type: 'computer_exec_kill';
  id: string;
}

/** Main → subprocess: a chunk of the command's output. */
export interface PiComputerExecData {
  type: 'computer_exec_data';
  id: string;
  stream: 'stdout' | 'stderr';
  data: string;
}

/** Main → subprocess: the command ended (`error` = it could not run at all). */
export interface PiComputerExecExit {
  type: 'computer_exec_exit';
  id: string;
  code: number;
  error?: string;
}
