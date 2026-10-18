import * as Predicate from "effect/Predicate";
import * as Cause from "effect/Cause";

import { VOICE_AUDIO_MAX_BYTES, EnvironmentId, type VoiceTranscribeInput } from "@otto/contracts";

import type { DictationAudio, DictationDependencies, DictationLimits } from "./session.ts";

/**
 * Up to 15 minutes of dictation. maxAudioBytes bounds each piece a capture sends, which the
 * server's `voice.transcribe` caps; a transcription gets two minutes, as long pieces upload slowly.
 */
export const VOICE_DICTATION_LIMITS: Partial<DictationLimits> = {
  maxRecordingMs: 15 * 60_000,
  maxAudioBytes: VOICE_AUDIO_MAX_BYTES,
  maxTranscriptionMs: 120_000,
  maxTranscriptCharacters: 16_000,
};

/** Mobile records one file without pieces, so it keeps the one-minute default. */
export const MOBILE_DICTATION_LIMITS: Partial<DictationLimits> = {
  maxAudioBytes: VOICE_AUDIO_MAX_BYTES,
  maxTranscriptCharacters: 16_000,
};

export const DICTATION_TRANSCRIPTION_UNAVAILABLE = {
  noProvider: "Connect a transcription provider in Settings, Transcription.",
} as const;

export type DictationTranscriptionCapability =
  | { readonly available: true; readonly provider: string }
  | { readonly available: false; readonly reason: string };

/** Mirrors the server's standalone transcription path: a key for the default transcription provider. */
export function dictationTranscriptionCapability(input: {
  readonly voice?: { readonly transcriptionProvider?: string };
  readonly providers?: ReadonlyArray<{ readonly provider: string; readonly connected: boolean }>;
}): DictationTranscriptionCapability {
  const provider = input.voice?.transcriptionProvider ?? "openai";

  const connected = input.providers?.some(
    (status) => status.provider === provider && status.connected,
  );

  return connected
    ? { available: true, provider }
    : { available: false, reason: DICTATION_TRANSCRIPTION_UNAVAILABLE.noProvider };
}

const MEDIA_TYPES = new Map<string, VoiceTranscribeInput["mimeType"]>([
  ["audio/webm", "audio/webm"],
  ["audio/ogg", "audio/ogg"],
  ["audio/mp4", "audio/mp4"],
  ["audio/m4a", "audio/mp4"],
  ["audio/x-m4a", "audio/mp4"],
  ["audio/aac", "audio/mp4"],
  ["audio/mpeg", "audio/mpeg"],
  ["audio/wav", "audio/wav"],
  ["audio/x-wav", "audio/wav"],
  ["video/webm", "audio/webm"],
]);

/** Drops codec parameters so recorder output such as `audio/webm;codecs=opus` fits the RPC schema. */
export function dictationAudioMediaType(mediaType: string) {
  return MEDIA_TYPES.get(mediaType.split(";", 1)[0]!.trim().toLowerCase()) ?? null;
}

/** Encodes in 32 KB slices with the platform's btoa, far faster than a per-byte loop on long audio. */
export function encodeDictationAudioBase64(bytes: Uint8Array): string {
  const slices: string[] = [];

  for (let index = 0; index < bytes.length; index += 0x8000) {
    slices.push(String.fromCharCode(...bytes.subarray(index, index + 0x8000)));
  }

  return btoa(slices.join(""));
}

const FAILURE_MESSAGES = new Map<string, string>([
  ["provider-unavailable", DICTATION_TRANSCRIPTION_UNAVAILABLE.noProvider],
  ["busy", "Too many voice requests are running. Try again in a moment."],
  ["invalid-input", "The recording could not be transcribed. Try a shorter recording."],
  [
    "provider-auth",
    "The transcription provider rejected its API key. Replace it in Settings, Transcription.",
  ],
  [
    "provider-quota",
    "The transcription provider reported a quota, billing, or rate limit. Check that account.",
  ],
  ["network", "Could not reach the transcription provider. Check the network and try again."],
]);

type TranscribeResult =
  | { readonly _tag: "Success"; readonly value: { readonly text: string } }
  | { readonly _tag: "Failure"; readonly cause: unknown };

function failureReason(cause: unknown): string | null {
  const error = Cause.isCause(cause) ? Cause.squash(cause) : cause;

  if (!Predicate.isObjectOrArray(error)) return null;
  const record = error;

  return Predicate.isTagged(record, "VoiceCallError") &&
    "reason" in record &&
    Predicate.isString(record.reason)
    ? record.reason
    : null;
}

/** Binds dictation to the environment's `voice.transcribe` RPC, cancelling it server-side on abort. */
export function createVoiceDictationTranscriber<CancelResult>(options: {
  readonly transcribe: (target: {
    readonly environmentId: EnvironmentId;
    readonly input: VoiceTranscribeInput;
  }) => Promise<TranscribeResult>;
  readonly cancel: (target: {
    readonly environmentId: EnvironmentId;
    readonly input: { readonly operationId: string };
  }) => Promise<CancelResult>;
  readonly nextOperationId: () => string;
}): DictationDependencies["transcribe"] {
  return async ({
    audio,
    signal,
    identity,
  }: {
    audio: DictationAudio;
    signal: AbortSignal;
    identity: { readonly environmentId: string };
  }) => {
    signal.throwIfAborted();
    const mimeType = dictationAudioMediaType(audio.mediaType);

    if (!mimeType) throw new Error("This recording format can't be transcribed.");
    // Dictation identities carry the id of the environment the composer was bound to.
    const environmentId = EnvironmentId.make(identity.environmentId);
    const operationId = options.nextOperationId();

    const abort = () => {
      void options.cancel({ environmentId, input: { operationId } }).catch(() => undefined);
    };

    signal.addEventListener("abort", abort, { once: true });

    try {
      const result = await options.transcribe({
        environmentId,
        input: { operationId, audioBase64: encodeDictationAudioBase64(audio.bytes), mimeType },
      });

      signal.throwIfAborted();

      if (Predicate.isTagged(result, "Success")) return result.value.text;
      const reason = failureReason(result.cause);
      throw new Error(
        (reason && FAILURE_MESSAGES.get(reason)) ?? "Transcription failed. Try again.",
      );
    } finally {
      signal.removeEventListener("abort", abort);
    }
  };
}
