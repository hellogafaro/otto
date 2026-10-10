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
  const seen: {
    auth: string | null;
    model: unknown;
    size: number;
    filename: string | null;
    type: string | null;
  }[] = [];
  const sink = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const wire = await request.clone().text();
      const form = await request.formData();
      const file = form.get("file");
      seen.push({
        auth: request.headers.get("authorization"),
        model: form.get("model"),
        size: file instanceof Blob ? file.size : -1,
        filename: file instanceof File ? file.name : null,
        // Bun 1.4.2 formData() infers video/webm from the filename despite the audio/webm wire header.
        type: wire.match(/Content-Type: ([^\r\n]+)/i)?.[1] ?? null,
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
        {
          auth: `Bearer ${key}`,
          model: "vendor/model",
          size: 64,
          filename: "voice-input.webm",
          type: "audio/webm",
        },
      ]);
    } finally {
      await p.stop();
    }
  });

  it("keeps the official endpoint, redirect fence and codec-bearing multipart filename", async () => {
    const seen: {
      url: string;
      redirect: RequestRedirect | undefined;
      name: string | undefined;
    }[] = [];
    const request: typeof fetch = Object.assign(
      async (
        input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
      ) => {
        const body = init?.body;
        const file = body instanceof FormData ? body.get("file") : null;
        seen.push({
          url: String(input),
          redirect: init?.redirect,
          name: file instanceof File ? file.name : undefined,
        });
        return Response.json({ text: "literal <b>text</b>" });
      },
      { preconnect: fetch.preconnect },
    );
    const transcriber = createOpenRouterTranscriber(
      { apiKey: key, model: "mistralai/voxtral-mini-transcribe" },
      request,
    );
    expect(
      await transcriber.transcribe(
        new Blob(["fixture"], { type: "audio/mp4;codecs=mp4a.40.2" }),
      ),
    ).toBe("literal <b>text</b>");
    expect(seen).toEqual([
      {
        url: "https://openrouter.ai/api/v1/audio/transcriptions",
        redirect: "error",
        name: "voice-input.m4a",
      },
    ]);
    await expect(transcriber.transcribe(new Blob([]))).rejects.toMatchObject({
      reason: "failed",
    });
    await expect(
      transcriber.transcribe(new Blob([new Uint8Array(25 * 1024 * 1024 + 1)])),
    ).rejects.toMatchObject({ reason: "failed" });
    expect(seen).toHaveLength(1);
  });

  it("cancels a pending provider request without retrying or exposing its response", async () => {
    const controller = new AbortController();
    let calls = 0;
    const request: typeof fetch = Object.assign(
      async (
        _input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
      ) => {
        calls++;
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new Error("private provider detail")),
            { once: true },
          );
        });
      },
      { preconnect: fetch.preconnect },
    );
    const pending = createOpenRouterTranscriber(
      { apiKey: key, model: "m" },
      request,
    ).transcribe(audio, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({
      reason: "unavailable",
      message: "Transcription unavailable",
    });
    expect(calls).toBe(1);
    await expect(
      createOpenRouterTranscriber(
        { apiKey: key, model: "m" },
        request,
      ).transcribe(audio, controller.signal),
    ).rejects.toMatchObject({ reason: "unavailable" });
    expect(calls).toBe(1);
  });

  it("rejects malformed successful provider bodies with a coarse error", async () => {
    const p = peer(() =>
      Promise.resolve(Response.json({ text: 42, key: "private" })),
    );
    try {
      await expect(
        createOpenRouterTranscriber(
          { apiKey: key, model: "m" },
          p.request,
        ).transcribe(audio),
      ).rejects.toMatchObject({
        reason: "failed",
        message: "Transcription failed",
      });
      expect(p.seen).toHaveLength(1);
    } finally {
      await p.stop();
    }
  });

  it("bounds chunked provider JSON and cancels and releases the reader", async () => {
    let cancelled = false;
    let chunks = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        chunks++;
        controller.enqueue(new Uint8Array(128 * 1024).fill(65));
      },
      cancel() {
        cancelled = true;
      },
    });
    const request: typeof fetch = Object.assign(
      async () => new Response(stream),
      { preconnect: fetch.preconnect },
    );
    await expect(
      createOpenRouterTranscriber(
        { apiKey: key, model: "m" },
        request,
      ).transcribe(audio),
    ).rejects.toMatchObject({
      reason: "failed",
      message: "Transcription failed",
    });
    expect(cancelled).toBe(true);
    expect(stream.locked).toBe(false);
    expect(chunks).toBeLessThanOrEqual(4);
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
