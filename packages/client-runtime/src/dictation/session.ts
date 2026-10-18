import {
  mergeDictationDraft,
  sameDictationIdentity,
  type DictationDraft,
  type DictationIdentity,
} from "./draft.ts";

export interface DictationAudio {
  readonly bytes: Uint8Array;
  readonly mediaType: string;
  readonly durationMs: number;
}

export interface DictationLimits {
  readonly maxRecordingMs: number;
  readonly maxAudioBytes: number;
  readonly maxTranscriptionMs: number;
  readonly maxTranscriptCharacters: number;
  readonly maxDraftCharacters: number;
}

export const DEFAULT_DICTATION_LIMITS: DictationLimits = {
  maxRecordingMs: 60_000,
  maxAudioBytes: 10 * 1024 * 1024,
  maxTranscriptionMs: 30_000,
  maxTranscriptCharacters: 20_000,
  maxDraftCharacters: 100_000,
};

export interface DictationCapture {
  /** Stop recording and return owned audio bytes that remain valid after disposal. */
  stop(): Promise<DictationAudio>;
  /** Idempotently release local tracks, buffers, and temporary files synchronously; must not throw. */
  dispose(): void;
}

export type DictationTimer = ReturnType<typeof setTimeout> | number;

export interface DictationDependencies {
  /** Capture on this client, enforce limits while recording, and release resources on abort. */
  capture(input: {
    signal: AbortSignal;
    limits: DictationLimits;
    onError(cause: unknown): void;
    /**
     * A finished piece of a long recording, in order. A capture may cut a long recording into
     * pieces so each one transcribes while the person keeps talking; stop() returns the last one.
     */
    onSegment(audio: DictationAudio): void;
  }): Promise<DictationCapture>;
  /** Inject a real transcription implementation; this module supplies no provider or transport. */
  transcribe(input: {
    audio: DictationAudio;
    signal: AbortSignal;
    identity: DictationIdentity;
  }): Promise<string>;
  /** Synchronously and atomically update the latest draft; never defer the updater or send a message. */
  updateDraft(update: (current: DictationDraft) => DictationDraft): void;
  schedule(callback: () => void, milliseconds: number): DictationTimer;
  cancelSchedule(timer: DictationTimer | undefined): void;
}

export type DictationStatus =
  | "idle"
  | "starting"
  | "recording"
  | "transcribing"
  | "completed"
  | "cancelled"
  | "error";

export type DictationCancelReason = "cancel" | "navigation" | "disconnect" | "disposed";

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);

    if (signal.aborted) {
      reject(signal.reason);
      void promise.catch(() => undefined);

      return;
    }

    signal.addEventListener("abort", abort, { once: true });
    void promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

/** One local dictation at a time; all completion effects are guarded by session and draft identity. */
export function createDictationSession(
  dependencies: DictationDependencies,
  options: Partial<DictationLimits> = {},
) {
  const limits = Object.freeze({ ...DEFAULT_DICTATION_LIMITS, ...options });

  for (const value of Object.values(limits)) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647)
      throw new RangeError("Invalid dictation limit");
  }

  let status: DictationStatus = "idle";
  let error: unknown;
  let disposed = false;
  const listeners = new Set<() => void>();

  function transition(next: DictationStatus, cause?: unknown) {
    const nextError = next === "error" ? cause : undefined;

    if (status === next && Object.is(error, nextError)) return;
    status = next;
    error = nextError;
    // Subscription changes apply to the next transition.
    const pendingListeners = [...listeners];

    for (const listener of pendingListeners) listener();
  }

  let active:
    | {
        original: DictationDraft;
        controller: AbortController;
        capture?: DictationCapture;
        /** Every piece recorded so far, in order, and its transcription. */
        audios: DictationAudio[];
        pieces: Promise<string>[];
        timer?: DictationTimer;
      }
    | undefined;

  // The recording and draft of a failed transcription, so retry() sends the same audio again.
  let failed: { original: DictationDraft; audios: readonly DictationAudio[] } | undefined;

  // The last dictation stopped on its own at maxRecordingMs rather than when the person stopped it.
  let stoppedAtLimit = false;

  function releaseCapture(run: NonNullable<typeof active>) {
    const capture = run.capture;
    delete run.capture;
    capture?.dispose();
  }

  function releaseActive(cause?: unknown) {
    const run = active;
    active = undefined;

    if (!run) return;
    dependencies.cancelSchedule(run.timer);
    run.controller.abort(cause);
    releaseCapture(run);
  }

  function terminate(next: DictationStatus, cause?: unknown) {
    const run = active;
    releaseActive(cause);
    failed =
      next === "error" && run && run.audios.length > 0
        ? { original: run.original, audios: run.audios }
        : undefined;
    transition(next, cause);
  }

  function validAudio(audio: DictationAudio) {
    return (
      audio.bytes.byteLength > 0 &&
      audio.bytes.byteLength <= limits.maxAudioBytes &&
      Number.isFinite(audio.durationMs) &&
      audio.durationMs > 0 &&
      audio.durationMs <= limits.maxRecordingMs &&
      audio.mediaType.trim().length > 0
    );
  }

  /** Starts one piece's transcription now; its failure surfaces when the pieces are joined. */
  function transcribePiece(run: NonNullable<typeof active>, audio: DictationAudio) {
    run.audios.push(audio);

    const piece = dependencies.transcribe({
      audio,
      signal: run.controller.signal,
      identity: run.original.identity,
    });

    void piece.catch(() => undefined);
    run.pieces.push(piece);
  }

  /** Joins every piece's transcript in recording order and merges it into the draft once. */
  async function joinPieces(run: NonNullable<typeof active>) {
    try {
      const texts = await abortable(Promise.all(run.pieces), run.controller.signal);

      if (active !== run) return;

      if (texts.some((text) => text.length > limits.maxTranscriptCharacters))
        throw new Error("Dictation transcript limit exceeded");

      const transcript = texts
        .map((text) => text.trim())
        .filter(Boolean)
        .join(" ");

      dependencies.updateDraft((current) =>
        active === run
          ? mergeDictationDraft(run.original, current, transcript, limits.maxDraftCharacters)
          : current,
      );

      if (active === run) terminate("completed");
    } catch (cause) {
      if (active === run) terminate("error", cause);
    }
  }

  function deadline(run: NonNullable<typeof active>, milliseconds: number, expire: () => void) {
    dependencies.cancelSchedule(run.timer);
    run.timer = dependencies.schedule(() => {
      if (active === run) expire();
    }, milliseconds);
  }

  const transcriptionDeadline = (run: NonNullable<typeof active>) =>
    deadline(run, limits.maxTranscriptionMs, () =>
      terminate("error", new Error("Transcription took too long. Try again.")),
    );

  async function finish() {
    if (status === "starting") {
      terminate("cancelled", "cancel");

      return;
    }

    const run = active;

    if (!run?.capture || status !== "recording") return;
    const capture = run.capture;
    transcriptionDeadline(run);
    transition("transcribing");

    if (active !== run) return;

    try {
      const audio = await abortable(capture.stop(), run.controller.signal);
      releaseCapture(run);

      if (active !== run) return;

      // A stop right after a piece ended leaves an empty last piece; the earlier pieces still count.
      if (!(audio.bytes.byteLength === 0 && run.pieces.length > 0)) {
        if (!validAudio(audio)) throw new Error("Invalid dictation audio or audio limit exceeded");
        transcribePiece(run, audio);
      }

      await joinPieces(run);
    } catch (cause) {
      if (active === run) terminate("error", cause);
    }
  }

  return {
    get status() {
      return status;
    },
    get error() {
      return error;
    },
    /** A failed transcription kept its recording, so retry() can send it again. */
    get canRetry() {
      return status === "error" && failed !== undefined;
    },
    /** The last dictation reached maxRecordingMs and stopped itself; what was said is kept. */
    get stoppedAtLimit() {
      return stoppedAtLimit;
    },
    /** Observe transitions synchronously; listeners must not throw. Returns an unsubscribe function. */
    subscribe(listener: () => void) {
      if (!disposed) listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    async start(draft: DictationDraft) {
      if (disposed) throw new Error("Dictation session is disposed");
      releaseActive();
      failed = undefined;
      stoppedAtLimit = false;

      const run: NonNullable<typeof active> = {
        original: { ...draft, identity: { ...draft.identity }, selection: { ...draft.selection } },
        controller: new AbortController(),
        audios: [],
        pieces: [],
      };

      active = run;
      // At the limit the recording stops and transcribes what was said instead of failing.
      deadline(run, limits.maxRecordingMs, () => {
        if (status === "starting") {
          terminate("cancelled", "cancel");

          return;
        }

        stoppedAtLimit = true;
        void finish();
      });
      transition("starting");

      if (active !== run) return;

      try {
        const acquisition = dependencies
          .capture({
            signal: run.controller.signal,
            limits,
            onError(cause) {
              if (active === run) terminate("error", cause);
            },
            onSegment(audio) {
              if (active !== run) return;

              if (validAudio(audio)) transcribePiece(run, audio);
              else terminate("error", new Error("Invalid dictation audio or audio limit exceeded"));
            },
          })
          .then((capture) => {
            if (active !== run) capture.dispose();
            else run.capture = capture;

            return capture;
          });

        await abortable(acquisition, run.controller.signal);

        if (active === run) transition("recording");
      } catch (cause) {
        if (active === run) terminate("error", cause);
      }
    },
    finish,
    /** Transcribes a failed dictation's recording again into the draft it started from. */
    async retry() {
      if (status !== "error" || !failed) return;
      const { original, audios } = failed;
      failed = undefined;

      const run: NonNullable<typeof active> = {
        original,
        controller: new AbortController(),
        audios: [],
        pieces: [],
      };

      active = run;
      transcriptionDeadline(run);
      transition("transcribing");

      if (active !== run) return;

      for (const audio of audios) transcribePiece(run, audio);
      await joinPieces(run);
    },
    cancel(reason: DictationCancelReason = "cancel") {
      terminate("cancelled", reason);
    },
    /** Call on navigation, draft replacement, and connectivity changes, including a return to the same chat. */
    updateContext(identity: DictationIdentity, connected: boolean) {
      const original = active?.original ?? failed?.original;

      if (original && (!connected || !sameDictationIdentity(original.identity, identity))) {
        terminate("cancelled", connected ? "navigation" : "disconnect");
      }
    },
    dispose() {
      disposed = true;
      terminate("cancelled", "disposed");
      listeners.clear();
    },
  };
}
