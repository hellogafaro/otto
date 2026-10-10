import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { ApiEnv } from "./http";
import { createLogger } from "./logger";
import { TRANSCRIPTION_MAX_BYTES, TranscriptionError } from "./transcription";

const logger = createLogger();
/** Dictation audio is the raw request body; it is only forwarded, never stored. */
export const transcriptionApi = new Hono<ApiEnv>().post(
  "/transcriptions",
  bodyLimit({
    maxSize: TRANSCRIPTION_MAX_BYTES,
    onError: (c) => c.json({ error: "too_large" }, 413),
  }),
  async (c) => {
    const { transcriber } = c.get("options");
    if (!transcriber) return c.json({ error: "not_configured" }, 501);
    const type = c.req.header("content-type") ?? "";
    if (!type.startsWith("audio/")) return c.json({ error: "invalid" }, 400);
    const audio = new Blob([await c.req.arrayBuffer()], { type });
    if (audio.size === 0) return c.json({ error: "invalid" }, 400);
    try {
      const text = await transcriber.transcribe(audio, c.req.raw.signal);
      logger.info(
        { audioBytes: audio.size, type, textLength: text.length },
        "transcription",
      );
      return c.json({ text });
    } catch (error) {
      const reason = error instanceof TranscriptionError && error.reason;
      return reason === "timeout"
        ? c.json({ error: "timeout" }, 504)
        : reason === "unavailable"
          ? c.json({ error: "unavailable" }, 503)
          : c.json({ error: "failed" }, 502);
    }
  },
);
