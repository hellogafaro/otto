import { z } from "zod";

export const TRANSCRIPTION_MAX_BYTES = 25 * 1024 * 1024;
export const DEFAULT_TRANSCRIPTION_MODEL = "mistralai/voxtral-mini-transcribe";
const TIMEOUT_MS = 20_000;
const HEDGE_AFTER_MS = 1_500;
const BASE = "https://openrouter.ai/api/v1";

export type TranscriptionFailure = "timeout" | "unavailable" | "failed";
/** Carries a coarse reason only: provider bodies can echo audio-derived text or credentials. */
export class TranscriptionError extends Error {
  constructor(readonly reason: TranscriptionFailure) {
    super(`Transcription ${reason}`);
  }
}
export interface Transcriber {
  transcribe(audio: Blob): Promise<string>;
}

const response = z.object({ text: z.string() });
const transient = (error: unknown) =>
  error instanceof TranscriptionError && error.reason !== "failed";

/**
 * Speech to text through an OpenRouter model. A slow first request is hedged with a second one after
 * 1.5 s and a transient failure is retried once; the first success wins and cancels the other.
 */
export function createOpenRouterTranscriber(
  config: { apiKey: string; model: string },
  request: typeof fetch = fetch,
): Transcriber {
  async function attempt(audio: Blob, signal: AbortSignal) {
    const body = new FormData();
    body.set("model", config.model);
    body.set("file", audio, "voice-input");
    let reply: Response;
    try {
      reply = await request(`${BASE}/audio/transcriptions`, {
        method: "POST",
        redirect: "error",
        signal,
        headers: { Authorization: `Bearer ${config.apiKey}` },
        body,
      });
    } catch {
      throw new TranscriptionError(
        signal.reason instanceof DOMException &&
          signal.reason.name === "TimeoutError"
          ? "timeout"
          : "unavailable",
      );
    }
    if (!reply.ok) {
      await reply.body?.cancel();
      throw new TranscriptionError(
        reply.status === 429 || reply.status >= 500 ? "unavailable" : "failed",
      );
    }
    const parsed = response.safeParse(await reply.json().catch(() => null));
    if (!parsed.success) throw new TranscriptionError("failed");
    return parsed.data.text;
  }

  return {
    async transcribe(audio) {
      const cancel = new AbortController();
      const signal = AbortSignal.any([
        AbortSignal.timeout(TIMEOUT_MS),
        cancel.signal,
      ]);
      const run = () => attempt(audio, signal);
      let hedge: ReturnType<typeof setTimeout> | undefined;
      const slow = new Promise<void>((resolve) => {
        hedge = setTimeout(resolve, HEDGE_AFTER_MS);
      });
      const first = run();
      // The second request starts when the first is slow or fails transiently, never after a success.
      const second = Promise.race([
        slow,
        first.then(
          () => new Promise<never>(() => {}),
          (error: unknown) =>
            transient(error) ? undefined : Promise.reject(error),
        ),
      ]).then(run);
      try {
        return await Promise.any([first, second]);
      } catch (error) {
        throw error instanceof AggregateError ? error.errors.at(-1) : error;
      } finally {
        clearTimeout(hedge);
        cancel.abort();
      }
    },
  };
}
