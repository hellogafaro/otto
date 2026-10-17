import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { LibraryFolderId, type VoiceTranscriptionProvider } from "@otto/contracts";
import { it } from "@effect/vitest";
import { describe, expect, vi } from "vite-plus/test";

import { ServerSecretStore } from "../auth/server-secret-store.ts";
import { layerTest as settingsLayerTest } from "../server-settings.ts";
import {
  type AudioComputer,
  type AudioLibrary,
  type AudioTranscriber,
  makeAudioTranscriber,
  transcribeAudioFile,
} from "./audio-transcribe-tool.ts";
import type { VoiceAdapters } from "./voice-adapters.ts";

const signal = new AbortController().signal;

const bytes = (text: string) => new TextEncoder().encode(text);

/** A computer whose files and command results are fixed, recording every command it runs. */
function fixtureComputer(input: {
  readonly sizes: Readonly<Record<string, number>>;
  readonly files?: Readonly<Record<string, string>>;
  readonly chunks?: ReadonlyArray<string>;
  readonly ffmpeg?: boolean;
}) {
  const commands: string[] = [];
  const written = new Map<string, string>();

  const computer: AudioComputer = {
    run: async (command) => {
      commands.push(command);
      const counted = /^wc -c < '(.+)'$/.exec(command)?.[1];

      if (counted !== undefined) {
        const size = input.sizes[counted];

        return size === undefined
          ? { exitCode: 1, stdout: "", stderr: "No such file" }
          : { exitCode: 0, stdout: `${size}\n`, stderr: "" };
      }

      if (command.startsWith("command -v ffmpeg")) {
        return { exitCode: input.ffmpeg === false ? 127 : 0, stdout: "", stderr: "" };
      }

      if (command.startsWith("ffmpeg ")) {
        return { exitCode: 0, stdout: (input.chunks ?? []).join("\n"), stderr: "" };
      }

      return { exitCode: 0, stdout: "", stderr: "" };
    },
    readFile: async (path) => {
      const name = path.split("/").at(-1) ?? path;
      const content = input.files?.[path] ?? input.files?.[name];

      if (content === undefined) throw new Error(`Unexpected read of ${path}`);

      return bytes(content);
    },
    writeFile: async (path, content) => {
      written.set(path, await new Blob([content]).text());
    },
  };

  return { computer, commands, written };
}

/** Transcribes each request as its own bytes, so the joined text shows the order. */
function echoTranscriber() {
  const calls: Array<{
    readonly text: string;
    readonly mimeType: string;
    readonly language?: string;
  }> = [];

  const transcribe: AudioTranscriber = async (audio, language) => {
    const text = new TextDecoder().decode(audio.bytes);
    calls.push({ text, mimeType: audio.mimeType, ...(language ? { language } : {}) });

    return text;
  };

  return { transcribe, calls };
}

describe("audio_transcribe", () => {
  it("chunks a video with ffmpeg, transcribes the chunks in order and writes <name>.txt beside it", async () => {
    const { computer, commands, written } = fixtureComputer({
      sizes: { "videos/talk.mp4": 48_000_000 },
      chunks: ["chunk-0002.wav", "chunk-0000.wav", "notes.txt", "chunk-0001.wav", ""],
      files: { "chunk-0000.wav": "first", "chunk-0001.wav": "second", "chunk-0002.wav": "third" },
    });

    const { transcribe, calls } = echoTranscriber();

    const result = await transcribeAudioFile(
      { path: "videos/talk.mp4", language: "en" },
      { computer, transcribe, signal },
    );

    expect(calls).toEqual([
      { text: "first", mimeType: "audio/wav", language: "en" },
      { text: "second", mimeType: "audio/wav", language: "en" },
      { text: "third", mimeType: "audio/wav", language: "en" },
    ]);

    expect(written.get("videos/talk.txt")).toBe("first\nsecond\nthird");
    expect(result).toBe("Saved the full transcript to videos/talk.txt.\n\nfirst\nsecond\nthird");

    const ffmpeg = commands.find((command) => command.startsWith("ffmpeg "));
    expect(ffmpeg).toContain("-i 'videos/talk.mp4'");
    expect(ffmpeg).toContain("-vn -ac 1 -ar 16000 -c:a pcm_s16le");
    expect(ffmpeg).toContain("-segment_time 120");
    expect(commands.at(-1)).toMatch(/^rm -rf -- '\.otto\/audio\/[0-9a-f-]+'$/);
  });

  it("sends small audio from the computer as it is, without ffmpeg", async () => {
    const { computer, commands, written } = fixtureComputer({
      sizes: { "memo.mp3": 1_000 },
      files: { "memo.mp3": "short memo" },
    });

    const { transcribe, calls } = echoTranscriber();

    const result = await transcribeAudioFile(
      { path: "memo.mp3" },
      { computer, transcribe, signal },
    );

    expect(calls).toEqual([{ text: "short memo", mimeType: "audio/mpeg" }]);
    expect(commands.some((command) => command.includes("ffmpeg"))).toBe(false);
    expect(written.get("memo.txt")).toBe("short memo");
    expect(result).toContain("Saved the full transcript to memo.txt.");
  });

  it("reads a Library file and saves the transcript as a Library file in its folder", async () => {
    const folderId = LibraryFolderId.make("folder-1");
    const saved: Array<Parameters<AudioLibrary["save"]>[0]> = [];

    const library: AudioLibrary = {
      read: async (fileId) => {
        expect(fileId).toBe("file-1");

        return { name: "Standup.wav", folderId, bytes: bytes("library audio") };
      },
      save: async (file) => {
        saved.push(file);

        return "file-2";
      },
    };

    const { transcribe, calls } = echoTranscriber();

    const result = await transcribeAudioFile(
      { fileId: "file-1" as never },
      { library, transcribe, signal },
    );

    expect(calls).toEqual([{ text: "library audio", mimeType: "audio/wav" }]);
    expect(saved).toEqual([{ fileName: "Standup.txt", content: "library audio", folderId }]);
    expect(result).toBe(
      "Saved the full transcript to the Library as Standup.txt (fileId file-2).\n\nlibrary audio",
    );
  });

  it("copies a Library video to the computer for ffmpeg", async () => {
    const { computer, commands, written } = fixtureComputer({
      sizes: {},
      chunks: ["chunk-0000.wav"],
      files: { "chunk-0000.wav": "from the video" },
    });

    const library: AudioLibrary = {
      read: async () => ({ name: "demo.mp4", folderId: null, bytes: bytes("video bytes") }),
      save: async () => "file-3",
    };

    const { transcribe } = echoTranscriber();

    const result = await transcribeAudioFile(
      { fileId: "file-1" as never },
      { computer, library, transcribe, signal },
    );

    const source = [...written.keys()].find((path) => path.endsWith("/source.mp4"));
    expect(source).toMatch(/^\.otto\/audio\/[0-9a-f-]+\/source\.mp4$/);
    expect(written.get(source ?? "")).toBe("video bytes");
    expect(commands.find((command) => command.startsWith("ffmpeg "))).toContain(`-i '${source}'`);
    expect(result).toContain("(fileId file-3)");
    expect(result).toContain("from the video");
  });

  it("says what is missing instead of guessing", async () => {
    const { transcribe } = echoTranscriber();

    await expect(transcribeAudioFile({ path: "talk.mp4" }, { transcribe, signal })).rejects.toThrow(
      "This bot has no computer, so pass a Library fileId instead.",
    );

    await expect(
      transcribeAudioFile(
        { path: "missing.mp4" },
        { computer: fixtureComputer({ sizes: {} }).computer, transcribe, signal },
      ),
    ).rejects.toThrow("There is no file at missing.mp4.");

    await expect(
      transcribeAudioFile(
        { path: "talk.mp4" },
        {
          computer: fixtureComputer({ sizes: { "talk.mp4": 9_000_000 }, ffmpeg: false }).computer,
          transcribe,
          signal,
        },
      ),
    ).rejects.toThrow("ffmpeg isn't installed on your computer.");

    await expect(
      transcribeAudioFile(
        { fileId: "file-1" as never },
        {
          library: {
            read: async () => ({ name: "demo.mp4", folderId: null, bytes: bytes("video") }),
            save: async () => "unused",
          },
          transcribe,
          signal,
        },
      ),
    ).rejects.toThrow("Converting this file needs ffmpeg on your computer");
  });
});

describe("audio_transcribe provider", () => {
  const run = (
    transcriptionProvider: VoiceTranscriptionProvider | undefined,
    keys: Readonly<Record<string, string>>,
    adapter: VoiceAdapters["transcribe"] = async () => ({ text: "hello" }),
  ) => {
    const values = new Map(Object.entries(keys).map(([name, key]) => [name, bytes(key)]));

    const secrets = ServerSecretStore.of({
      get: (name) => Effect.sync(() => Option.fromUndefinedOr(values.get(name))),
      set: () => Effect.void,
      remove: () => Effect.void,
      create: () => Effect.void,
      getOrCreateRandom: () => Effect.succeed(new Uint8Array()),
    });

    return makeAudioTranscriber({ transcribe: adapter }).pipe(
      Effect.provide(
        Layer.mergeAll(
          settingsLayerTest({ voice: transcriptionProvider ? { transcriptionProvider } : {} }),
          Layer.succeed(ServerSecretStore, secrets),
        ),
      ),
      Effect.flatMap((transcriber) =>
        Effect.promise(() =>
          transcriber({ bytes: bytes("audio"), mimeType: "audio/wav" }, "fr", signal).then(
            (text) => ({ text }),
            (error: Error) => ({ error: error.message }),
          ),
        ),
      ),
    );
  };

  it.effect("uses the default transcription provider and its own key", () =>
    Effect.gen(function* () {
      const adapter = vi.fn<VoiceAdapters["transcribe"]>(async () => ({ text: "bonjour" }));

      expect(
        yield* run(
          "openrouter",
          { "voice-openrouter": "router-key", "voice-openai": "openai-key" },
          adapter,
        ),
      ).toEqual({ text: "bonjour" });

      expect(adapter).toHaveBeenCalledOnce();
      const [provider, key, request, , language] = adapter.mock.calls[0]!;
      expect([provider, key, request.audioBase64, request.mimeType, language]).toEqual([
        "openrouter",
        "router-key",
        "YXVkaW8=",
        "audio/wav",
        "fr",
      ]);
    }),
  );

  it.effect("fails clearly with no key for the default provider, never using another account", () =>
    Effect.gen(function* () {
      const adapter = vi.fn<VoiceAdapters["transcribe"]>();

      expect(yield* run("openrouter", { "voice-openai": "openai-key" }, adapter)).toEqual({
        error:
          "No transcription provider is set up. Ask a person to add one in Settings, Transcription.",
      });

      expect(yield* run(undefined, {}, adapter)).toMatchObject({
        error: expect.stringContaining("No transcription provider is set up"),
      });

      expect(adapter).not.toHaveBeenCalled();
    }),
  );
});
