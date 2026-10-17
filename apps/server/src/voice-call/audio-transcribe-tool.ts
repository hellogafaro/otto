import * as NodeBuffer from "node:buffer";
import * as NodeCrypto from "node:crypto";
import {
  VOICE_AUDIO_MAX_BYTES,
  VoiceCallError,
  type LibraryFolderId,
  type OttoToolInputSchemas,
  type VoiceTranscribeInput,
} from "@otto/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { ServerSecretStore } from "../auth/server-secret-store.ts";
import { capToolText } from "../provider/tool-output.ts";
import { quote } from "../provider/workspace/bot-workspace-lifecycle.ts";
import { ServerSettingsService } from "../server-settings.ts";
import { voiceAdapters, type VoiceAdapters } from "./voice-adapters.ts";
import { voiceKeySecretName } from "./voice-call-manager.ts";

type AudioTranscribeInput = (typeof OttoToolInputSchemas.audio_transcribe)["Type"];

type AudioMimeType = VoiceTranscribeInput["mimeType"];

/** The bot's computer, as the tool uses it. Relative paths start in its working folder. */
export interface AudioComputer {
  readonly run: (
    command: string,
  ) => Promise<{ readonly exitCode: number; readonly stdout: string; readonly stderr: string }>;
  readonly readFile: (path: string) => Promise<Uint8Array>;
  readonly writeFile: (path: string, content: Uint8Array | string) => Promise<void>;
}

/** The calling bot's Library, limited to what it may see from this chat. */
export interface AudioLibrary {
  readonly read: (fileId: string) => Promise<{
    readonly name: string;
    readonly folderId: LibraryFolderId | null;
    readonly bytes: Uint8Array;
  }>;
  /** Saves a text file and returns its fileId. */
  readonly save: (input: {
    readonly fileName: string;
    readonly content: string;
    readonly folderId?: LibraryFolderId;
  }) => Promise<string>;
}

/** One request to the workspace's default transcription provider with its saved key. */
export type AudioTranscriber = (
  audio: { readonly bytes: Uint8Array; readonly mimeType: AudioMimeType },
  language: string | undefined,
  signal: AbortSignal,
) => Promise<string>;

/** The most a bot tool reads from the Library into memory. */
export const AUDIO_LIBRARY_MAX_BYTES = 8 * 1024 * 1024;

/** 16 kHz mono 16-bit WAV is 32,000 bytes a second, so 120 seconds stays under the request limit. */
export const AUDIO_CHUNK_SECONDS = 120;

/** Four hours of chunks; ffmpeg stops reading the source there. */
export const AUDIO_MAX_CHUNKS = 120;

/** Audio a provider takes as it is, when it is small enough. */
const DIRECT_TYPES = new Map<string, AudioMimeType>([
  ["wav", "audio/wav"],
  ["mp3", "audio/mpeg"],
  ["m4a", "audio/mp4"],
  ["ogg", "audio/ogg"],
  ["oga", "audio/ogg"],
  ["opus", "audio/ogg"],
]);

const extensionOf = (name: string) => /\.([^./]+)$/.exec(name)?.[1]?.toLowerCase() ?? "";

const isVoiceCallError = Schema.is(VoiceCallError);

/**
 * Transcribes an audio or video file from the bot's computer or the Library with the workspace's
 * default transcription provider. Small audio goes to the provider as it is; anything else becomes
 * 16 kHz mono WAV chunks through ffmpeg on the computer, transcribed in order and joined. The full
 * transcript is saved as <name>.txt beside a computer file, or as a Library file beside a Library
 * one, and the result names where, followed by the text capped like other tool output.
 */
export async function transcribeAudioFile(
  input: AudioTranscribeInput,
  deps: {
    readonly computer?: AudioComputer | undefined;
    readonly library?: AudioLibrary | undefined;
    readonly transcribe: AudioTranscriber;
    readonly signal: AbortSignal;
  },
): Promise<string> {
  const { computer, library, transcribe, signal } = deps;

  const source =
    input.path !== undefined
      ? { kind: "computer" as const, path: input.path, name: input.path.split("/").at(-1) ?? "" }
      : { kind: "library" as const, ...(await requireLibrary(library).read(input.fileId ?? "")) };

  let size = source.kind === "library" ? source.bytes.byteLength : 0;

  if (source.kind === "computer") {
    if (!computer) throw new Error("This bot has no computer, so pass a Library fileId instead.");
    const counted = await computer.run(`wc -c < ${quote(source.path)}`);

    if (counted.exitCode !== 0) throw new Error(`There is no file at ${source.path}.`);
    size = Number(counted.stdout.trim());
  }

  const extension = extensionOf(source.name);
  const directType = DIRECT_TYPES.get(extension);
  const texts: string[] = [];

  if (directType && size <= VOICE_AUDIO_MAX_BYTES) {
    const bytes =
      source.kind === "library"
        ? source.bytes
        : await requireComputer(computer).readFile(source.path);

    texts.push(await transcribe({ bytes, mimeType: directType }, input.language, signal));
  } else {
    const machine = requireComputer(computer);
    const folder = `.otto/audio/${NodeCrypto.randomUUID()}`;
    const sourcePath = source.kind === "library" ? `${folder}/source.${extension}` : source.path;

    try {
      const prepared = await machine.run(
        `command -v ffmpeg >/dev/null || exit 127; mkdir -p ${quote(folder)}`,
      );

      if (prepared.exitCode === 127) {
        throw new Error("ffmpeg isn't installed on your computer. Install it, then try again.");
      }

      if (prepared.exitCode !== 0) throw new Error("Could not prepare a folder on your computer.");

      if (source.kind === "library") await machine.writeFile(sourcePath, source.bytes);

      const converted = await machine.run(
        `ffmpeg -nostdin -hide_banner -loglevel error -i ${quote(sourcePath)} ` +
          `-t ${AUDIO_CHUNK_SECONDS * AUDIO_MAX_CHUNKS} -vn -ac 1 -ar 16000 -c:a pcm_s16le ` +
          `-f segment -segment_time ${AUDIO_CHUNK_SECONDS} ${quote(`${folder}/chunk-%04d.wav`)} && ` +
          `ls ${quote(folder)}`,
      );

      if (converted.exitCode !== 0) {
        const detail = converted.stderr.trim().split("\n").at(-1)?.slice(0, 300);

        throw new Error(
          `ffmpeg couldn't read ${source.name}${detail ? `: ${detail}` : "."} Check that it is an audio or video file.`,
        );
      }

      const chunks = converted.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => /^chunk-\d{4}\.wav$/.test(line))
        .toSorted();

      if (chunks.length === 0) throw new Error(`${source.name} has no audio track.`);

      for (const chunk of chunks) {
        signal.throwIfAborted();
        const bytes = await machine.readFile(`${folder}/${chunk}`);
        texts.push(await transcribe({ bytes, mimeType: "audio/wav" }, input.language, signal));
      }
    } finally {
      await machine.run(`rm -rf -- ${quote(folder)}`).catch(() => undefined);
    }
  }

  const transcript = texts.flatMap((text) => text.trim() || []).join("\n");

  const fileName = `${source.name.replace(/\.[^./]+$/, "")}.txt`;
  let location: string;

  if (source.kind === "computer") {
    location = source.path.slice(0, source.path.lastIndexOf("/") + 1) + fileName;
    await requireComputer(computer).writeFile(location, transcript);
  } else {
    const fileId = await requireLibrary(library).save({
      fileName,
      content: transcript,
      ...(source.folderId ? { folderId: source.folderId } : {}),
    });

    location = `the Library as ${fileName} (fileId ${fileId})`;
  }

  return capToolText(
    `Saved the full transcript to ${location}.\n\n${transcript || "No speech was recognized."}`,
    () => `Read the rest in ${location}.`,
  );
}

function requireComputer(computer: AudioComputer | undefined): AudioComputer {
  if (!computer) {
    throw new Error(
      "Converting this file needs ffmpeg on your computer, and this bot has no computer.",
    );
  }

  return computer;
}

function requireLibrary(library: AudioLibrary | undefined): AudioLibrary {
  if (!library) throw new Error("The Library is not available in this chat.");

  return library;
}

/**
 * Transcribes with the default provider chosen in Settings, Transcription, and that provider's
 * saved key, the one secret Voice shares. It never falls back to another provider or account.
 */
export const makeAudioTranscriber = (
  adapters: Pick<VoiceAdapters, "transcribe"> = voiceAdapters(),
) =>
  Effect.gen(function* () {
    const settings = yield* ServerSettingsService;
    const secrets = yield* Effect.serviceOption(ServerSecretStore);
    const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

    const transcriber: AudioTranscriber = async (audio, language, signal) => {
      const selection = await runPromise(
        Effect.gen(function* () {
          const voice = (yield* settings.getSettings).voice;
          const provider = voice.transcriptionProvider ?? "openai";

          const key = Option.isSome(secrets)
            ? yield* secrets.value.get(voiceKeySecretName(provider))
            : Option.none<Uint8Array>();

          return { provider, model: voice.transcriptionModels?.[provider], key };
        }),
      ).catch(() => {
        throw new Error("Transcription settings couldn't be read.");
      });

      if (Option.isNone(selection.key)) {
        throw new Error(
          "No transcription provider is set up. Ask a person to add one in Settings, Transcription.",
        );
      }

      try {
        const result = await adapters.transcribe(
          selection.provider,
          new TextDecoder().decode(selection.key.value),
          {
            operationId: "audio_transcribe",
            audioBase64: NodeBuffer.Buffer.from(audio.bytes).toString("base64"),
            mimeType: audio.mimeType,
          },
          AbortSignal.any([signal, AbortSignal.timeout(120_000)]),
          {
            ...(language ? { language } : {}),
            ...(selection.model ? { model: selection.model } : {}),
          },
        );

        return result.text;
      } catch (cause) {
        const reason = isVoiceCallError(cause) ? cause.reason : null;

        throw new Error(
          Match.value(reason).pipe(
            Match.when(
              "provider-auth",
              () =>
                "The transcription provider rejected its key. Ask a person to replace it in Settings, Transcription.",
            ),
            Match.when(
              "provider-quota",
              () => "The transcription provider reported a quota, billing or rate limit.",
            ),
            Match.when("network", () => "Could not reach the transcription provider. Try again."),
            Match.orElse(() => "The transcription provider couldn't transcribe this audio."),
          ),
          { cause },
        );
      }
    };

    return transcriber;
  });

let activeTranscriber: AudioTranscriber | undefined;

/** The running transcriber, published for tool handlers the way the Library tools are. */
export const activeAudioTranscriber = () => activeTranscriber;

export const layer = Layer.effectDiscard(
  makeAudioTranscriber().pipe(
    Effect.flatMap((transcriber) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          activeTranscriber = transcriber;
        }),
        () =>
          Effect.sync(() => {
            if (activeTranscriber === transcriber) activeTranscriber = undefined;
          }),
      ),
    ),
  ),
);
