type CaptureTrack = Pick<
  MediaStreamTrack,
  "readyState" | "stop" | "addEventListener" | "removeEventListener"
>;

type CaptureStream = { getTracks: () => CaptureTrack[] };

export interface DictationCaptureDependencies<Stream extends CaptureStream = MediaStream> {
  mediaDevices: Pick<MediaDevices, "addEventListener" | "removeEventListener"> & {
    getUserMedia: (constraints: MediaStreamConstraints) => Promise<Stream>;
  };
  document: Pick<Document, "hidden" | "addEventListener" | "removeEventListener">;
  createRecorder: (
    stream: Stream,
  ) => Pick<
    MediaRecorder,
    "start" | "stop" | "state" | "mimeType" | "addEventListener" | "removeEventListener"
  >;
  setTimeout: (callback: () => void, milliseconds: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (timer: ReturnType<typeof setTimeout>) => void;
}

export interface DictationCaptureOptions {
  signal?: AbortSignal;
  maxDurationMs?: number;
  /** The most one piece may hold; with segmentMs set, each piece counts on its own. */
  maxBytes?: number;
  /**
   * Cuts the recording into standalone files this long, each handed to onSegment as it ends, so a
   * long dictation transcribes while the person keeps talking. release() returns the last piece.
   */
  segmentMs?: number;
  onSegment?: (audio: Blob) => void;
}

export interface DictationCapture {
  /** Resolves after release, or rejects when recording is interrupted. */
  result: Promise<Blob>;
  release: () => Promise<Blob>;
  cancel: () => void;
}

export function browserDependencies(): DictationCaptureDependencies {
  if (
    typeof navigator === "undefined" ||
    !navigator.mediaDevices ||
    typeof MediaRecorder === "undefined"
  ) {
    throw new Error("Microphone recording is not supported in this browser.");
  }

  return {
    mediaDevices: navigator.mediaDevices,
    document,
    // Speech needs far less than the browser's default bitrate: 32 kbps Opus is about 240 KB a
    // minute, so pieces upload and transcribe faster.
    createRecorder: (stream) => new MediaRecorder(stream, { audioBitsPerSecond: 32_000 }),
    setTimeout: (callback, milliseconds) => globalThis.setTimeout(callback, milliseconds),
    clearTimeout: (timer) => globalThis.clearTimeout(timer),
  };
}

/** Captures audio in memory only; cancellation also handles permission grants arriving late. */
export async function startDictationCapture<Stream extends CaptureStream = MediaStream>(
  options: DictationCaptureOptions = {},
  dependencies?: DictationCaptureDependencies<Stream>,
): Promise<DictationCapture> {
  const aborted = () => new DOMException("Microphone capture was cancelled.", "AbortError");

  if (options.signal?.aborted) throw aborted();
  const maxDurationMs = options.maxDurationMs ?? 120_000;
  const maxBytes = options.maxBytes ?? 25 * 1024 * 1024;

  if (
    !Number.isFinite(maxDurationMs) ||
    maxDurationMs <= 0 ||
    !Number.isFinite(maxBytes) ||
    maxBytes <= 0
  ) {
    throw new RangeError("Capture limits must be positive finite numbers.");
  }

  if (!dependencies) return startDictationCapture(options, browserDependencies());
  const deps = dependencies;
  let stream: Stream | undefined;
  let recorder: ReturnType<DictationCaptureDependencies["createRecorder"]> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let segmentTimer: ReturnType<typeof setTimeout> | undefined;
  let segmenting = false;
  let finished = false;
  let releasing = false;
  let bytes = 0;
  const chunks: Blob[] = [];
  const removers: Array<() => void> = [];
  let resolveResult!: (blob: Blob) => void;
  let rejectResult!: (cause: unknown) => void;

  const result = new Promise<Blob>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  // Interruptions can precede the caller awaiting release.
  void result.catch(() => {});
  let rejectStart!: (cause: unknown) => void;

  const interrupted = new Promise<never>((_resolve, reject) => {
    rejectStart = reject;
  });

  const stopTracks = (value: CaptureStream) => {
    for (const track of value.getTracks()) track.stop();
  };

  const cleanup = () => {
    for (const remove of removers.splice(0)) remove();

    if (timer !== undefined) deps.clearTimeout(timer);

    if (segmentTimer !== undefined) deps.clearTimeout(segmentTimer);

    if (stream) stopTracks(stream);
  };

  const fail = (cause: unknown) => {
    if (finished) return;
    finished = true;
    cleanup();

    try {
      if (recorder && recorder.state !== "inactive") recorder.stop();
    } catch {
      // Tracks are already stopped even when the recorder cannot stop.
    }

    chunks.length = 0;
    rejectResult(cause);
    rejectStart(cause);
  };

  const listen = (
    target: Pick<EventTarget, "addEventListener" | "removeEventListener">,
    name: string,
    listener: EventListener,
  ) => {
    target.addEventListener(name, listener);
    removers.push(() => target.removeEventListener(name, listener));
  };

  const cancel = () => fail(aborted());

  if (options.signal) listen(options.signal, "abort", cancel);
  listen(deps.document, "visibilitychange", () => {
    if (deps.document.hidden)
      fail(new Error("Microphone capture stopped because the page is hidden."));
  });
  listen(deps.mediaDevices, "devicechange", () => fail(new Error("Microphone devices changed.")));

  try {
    if (deps.document.hidden) throw new Error("Cannot record while the page is hidden.");

    const permission = deps.mediaDevices
      .getUserMedia({ audio: true, video: false })
      .then((value) => {
        if (finished) {
          stopTracks(value);
          throw aborted();
        }

        return value;
      });

    stream = await Promise.race([permission, interrupted]);

    // An abort can occur between permission resolution and this continuation.
    if (finished) {
      stopTracks(stream);
      await interrupted;
    }

    for (const track of stream.getTracks()) {
      listen(track, "ended", () => fail(new Error("Microphone track ended.")));

      if (track.readyState === "ended") throw new Error("Microphone track ended.");
    }

    const recording = stream;

    const blobOf = (from: NonNullable<typeof recorder>) =>
      new Blob(chunks, { type: from.mimeType || chunks[0]?.type || "audio/webm" });

    // Each piece gets its own recorder so its file has a header and decodes on its own.
    const startRecorder = () => {
      const current = deps.createRecorder(recording);
      recorder = current;
      listen(current, "dataavailable", (event) => {
        // SAFETY: This listener is registered for MediaRecorder dataavailable events, whose payload is BlobEvent.
        const { data } = event as BlobEvent;
        bytes += data.size;

        if (bytes > maxBytes) {
          fail(new Error("Microphone capture exceeded the size limit."));
        } else if (data.size > 0) {
          chunks.push(data);
        }
      });
      listen(current, "error", () => fail(new Error("Microphone recording failed.")));
      listen(current, "stop", () => {
        if (finished) return;

        if (segmenting && !releasing) {
          segmenting = false;
          const piece = blobOf(current);
          chunks.length = 0;
          bytes = 0;
          options.onSegment?.(piece);
          startRecorder();

          return;
        }

        if (!releasing) {
          fail(new Error("Microphone recording stopped unexpectedly."));

          return;
        }

        finished = true;
        const audio = blobOf(current);
        chunks.length = 0;
        cleanup();
        resolveResult(audio);
      });
      current.start(250);

      if (options.segmentMs !== undefined && options.segmentMs > 0) {
        segmentTimer = deps.setTimeout(() => {
          if (finished || releasing) return;
          segmenting = true;

          try {
            current.stop();
          } catch (error) {
            fail(error);
          }
        }, options.segmentMs);
      }
    };

    startRecorder();
    timer = deps.setTimeout(
      () => fail(new Error("Microphone capture exceeded the duration limit.")),
      maxDurationMs,
    );

    return {
      result,
      cancel,
      release: () => {
        if (!finished && !releasing) {
          releasing = true;

          if (segmentTimer !== undefined) deps.clearTimeout(segmentTimer);

          try {
            // A piece being cut right now ends on its own; its stop event resolves the release.
            if (recorder && recorder.state !== "inactive") recorder.stop();

            // The final dataavailable/stop events are asynchronous in browsers.
            if (stream) stopTracks(stream);
          } catch (error) {
            fail(error);
          }
        }

        return result;
      },
    };
  } catch (error) {
    fail(error);
    throw error;
  } finally {
    // Permission failures may happen before the race installs its rejection handler.
    void interrupted.catch(() => {});
  }
}
