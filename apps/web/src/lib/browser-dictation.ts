import * as Predicate from "effect/Predicate";
import {
  createDictationSession,
  type DictationDependencies,
  type DictationLimits,
} from "@otto/client-runtime/dictation";
import {
  browserDependencies,
  startDictationCapture,
  type DictationCaptureDependencies,
} from "./dictation-capture";

/**
 * A long dictation is cut into pieces this long. Each transcribes while the person keeps talking,
 * and stays well under the models' ~2,000-token output cap, which truncates past ~8 minutes.
 */
export const DICTATION_SEGMENT_MS = 3 * 60_000;

/** The recorder's own deadline trails the session's, so reaching the limit never fails. */
const CAPTURE_GRACE_MS = 5_000;

/**
 * Connect local browser capture to an environment-owned transcription operation. onStream gets
 * the recorder's microphone stream, so a level meter shares it instead of opening the mic again.
 */
export function createBrowserDictationSession(
  dependencies: Omit<DictationDependencies, "capture" | "schedule" | "cancelSchedule">,
  limits: Partial<DictationLimits> = {},
  captureDependencies?: DictationCaptureDependencies,
  onStream?: (stream: MediaStream) => void,
) {
  return createDictationSession(
    {
      ...dependencies,
      schedule: (callback, milliseconds) => globalThis.setTimeout(callback, milliseconds),
      // SAFETY: The dictation controller returns the opaque handle created by this same setTimeout scheduler.
      cancelSchedule: (timer) => globalThis.clearTimeout(timer as ReturnType<typeof setTimeout>),
      capture: async ({ signal, limits, onError, onSegment }) => {
        const deps = onStream ? (captureDependencies ?? browserDependencies()) : undefined;

        // Set once recording starts below; each piece then advances it to its own end.
        let startedAt = 0;

        // Each piece's own length, measured from when the previous one ended.
        const pieceOf = async (blob: Blob, endedAt: number) => {
          const durationMs = endedAt - startedAt;
          startedAt = endedAt;

          return {
            bytes: new Uint8Array(await blob.arrayBuffer()),
            mediaType: blob.type,
            durationMs,
          };
        };

        const capture = await startDictationCapture(
          {
            signal,
            // The session stops itself at maxRecordingMs; the recorder only backs it up, later.
            maxDurationMs: limits.maxRecordingMs + CAPTURE_GRACE_MS,
            maxBytes: limits.maxAudioBytes,
            segmentMs: DICTATION_SEGMENT_MS,
            onSegment: (blob) => {
              void pieceOf(blob, performance.now()).then((piece) => onSegment?.(piece), onError);
            },
          },
          deps && onStream
            ? {
                ...deps,
                createRecorder: (stream) => {
                  onStream(stream);

                  return deps.createRecorder(stream);
                },
              }
            : captureDependencies,
        );

        void capture.result.catch(onError);
        startedAt = performance.now();

        return {
          stop: async () => {
            const stoppedAt = performance.now();

            return pieceOf(await capture.release(), stoppedAt);
          },
          dispose: capture.cancel,
        };
      },
    },
    limits,
  );
}

/** Explains why this browser cannot record, or returns null when capture can start. */
export function browserDictationCaptureReason(
  scope: {
    readonly isSecureContext?: boolean;
    readonly navigator?: { readonly mediaDevices?: { readonly getUserMedia?: unknown } };
    readonly MediaRecorder?: unknown;
  } = globalThis,
): string | null {
  if (scope.isSecureContext === false) {
    return "The browser only opens the microphone on HTTPS pages. Open this page over HTTPS.";
  }

  if (!Predicate.isFunction(scope.navigator?.mediaDevices?.getUserMedia) || !scope.MediaRecorder) {
    return "This browser can't record audio.";
  }

  return null;
}
