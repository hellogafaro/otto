import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { ApiEnv, ApiOptions } from "../apps/server/src/http";
import {
  createOpenRouterTranscriber,
  type Transcriber,
  TranscriptionError,
} from "../apps/server/src/transcription";
import { transcriptionApi } from "../apps/server/src/transcription-api";

/** A local peer standing in for OpenRouter; each reply is decided per request number. */
function peer(reply: (n: number, request: Request) => Promise<Response>) {
  const seen: { auth: string | null; model: unknown; size: number }[] = [];
  const sink = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const form = await request.formData();
      const file = form.get("file");
      seen.push({
        auth: request.headers.get("authorization"),
        model: form.get("model"),
        size: file instanceof Blob ? file.size : -1,
      });
      return reply(seen.length, request);
    },
  });
  const request: typeof fetch = Object.assign(
    (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
      fetch(sink.url, init),
    { preconnect: fetch.preconnect },
  );
  return { seen, request, stop: () => sink.stop(true) };
}
const ok = (text: string) => Promise.resolve(Response.json({ text }));
const audio = new Blob([new Uint8Array(64)], { type: "audio/webm" });
const key = crypto.randomUUID();

describe("OpenRouter transcriber", () => {
  it("sends the configured model and file with the bearer key", async () => {
    const p = peer(() => ok("hello"));
    try {
      const transcriber = createOpenRouterTranscriber(
        { apiKey: key, model: "vendor/model" },
        p.request,
      );
      expect(await transcriber.transcribe(audio)).toBe("hello");
      expect(p.seen).toEqual([
        { auth: `Bearer ${key}`, model: "vendor/model", size: 64 },
      ]);
    } finally {
      await p.stop();
    }
  });

  it("retries a transient failure once and does not retry a rejected request", async () => {
    const flaky = peer((n) =>
      n === 1
        ? Promise.resolve(new Response("provider detail", { status: 503 }))
        : ok("second"),
    );
    const rejected = peer(() =>
      Promise.resolve(new Response("provider detail", { status: 400 })),
    );
    try {
      expect(
        await createOpenRouterTranscriber(
          { apiKey: key, model: "m" },
          flaky.request,
        ).transcribe(audio),
      ).toBe("second");
      expect(flaky.seen.length).toBe(2);
      const error = await createOpenRouterTranscriber(
        { apiKey: key, model: "m" },
        rejected.request,
      )
        .transcribe(audio)
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(TranscriptionError);
      expect((error as TranscriptionError).reason).toBe("failed");
      expect((error as Error).message).not.toContain("provider detail");
      expect(rejected.seen.length).toBe(1);
    } finally {
      await flaky.stop();
      await rejected.stop();
    }
  });

  it("hedges a slow first request and the faster second wins", async () => {
    const p = peer((n) =>
      n === 1 ? new Promise<Response>(() => {}) : ok("fast"),
    );
    try {
      const started = Date.now();
      expect(
        await createOpenRouterTranscriber(
          { apiKey: key, model: "m" },
          p.request,
        ).transcribe(audio),
      ).toBe("fast");
      expect(p.seen.length).toBe(2);
      expect(Date.now() - started).toBeLessThan(5000);
    } finally {
      await p.stop();
    }
  });
});

describe("transcription route", () => {
  const app = (transcriber?: Transcriber) =>
    new Hono<ApiEnv>()
      .use("*", async (c, next) => {
        c.set("options", { transcriber } as ApiOptions);
        await next();
      })
      .route("/", transcriptionApi);
  const post = (
    transcriber: Transcriber | undefined,
    body: BodyInit,
    type = "audio/webm",
  ) =>
    app(transcriber).request("/transcriptions", {
      method: "POST",
      headers: { "Content-Type": type },
      body,
    });
  const failing = (
    reason: "timeout" | "unavailable" | "failed",
  ): Transcriber => ({
    transcribe: () => Promise.reject(new TranscriptionError(reason)),
  });

  it("answers with the transcript and maps each failure to its status", async () => {
    const works: Transcriber = {
      transcribe: async (blob) => `${blob.size} bytes as ${blob.type}`,
    };
    const done = await post(works, new Uint8Array(3));
    expect(await done.json()).toEqual({ text: "3 bytes as audio/webm" });
    expect((await post(undefined, new Uint8Array(3))).status).toBe(501);
    expect((await post(works, new Uint8Array(3), "text/plain")).status).toBe(
      400,
    );
    expect((await post(works, new Uint8Array(0))).status).toBe(400);
    expect(
      (await post(works, new Uint8Array(25 * 1024 * 1024 + 1))).status,
    ).toBe(413);
    expect((await post(failing("timeout"), new Uint8Array(3))).status).toBe(
      504,
    );
    expect((await post(failing("unavailable"), new Uint8Array(3))).status).toBe(
      503,
    );
    expect((await post(failing("failed"), new Uint8Array(3))).status).toBe(502);
  });
});
