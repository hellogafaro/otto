import { flow } from "effect/Function";
import * as Option from "effect/Option";
import type {
  DesktopPreviewAnnotationTheme,
  DesktopPreviewColorScheme,
  DesktopPreviewFavicon,
  PreviewAnnotationPayload,
  PreviewAnnotationRect,
  DesktopPreviewRecordingFrame,
} from "@otto/contracts";

import { type BrowserWindow } from "electron";

import type * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";

import * as Schema from "effect/Schema";
import type * as Semaphore from "effect/Semaphore";
import type * as Scope from "effect/Scope";

import { PreviewOperationError, type PreviewManagerError } from "./preview-errors.ts";

export type PreviewNavStatus =
  | { kind: "Idle" }
  | { kind: "Loading"; url: string; title: string }
  | { kind: "Success"; url: string; title: string }
  | {
      kind: "LoadFailed";
      url: string;
      title: string;
      code: number;
      description: string;
    };

export interface PreviewTabState {
  tabId: string;
  webContentsId: number | null;
  navStatus: PreviewNavStatus;
  canGoBack: boolean;
  canGoForward: boolean;
  zoomFactor: number;
  pictureInPicture: boolean;
  colorScheme: DesktopPreviewColorScheme;
  /** User intent to silence this tab. Re-applied to each guest that attaches. */
  audioMuted: boolean;
  /** Observed from Chromium. Stays true while a muted tab keeps playing. */
  audible: boolean;
  favicon?: DesktopPreviewFavicon;
  updatedAt: string;
}

/** Discrete zoom levels mirroring Chrome's preset list. */
export const ZOOM_LEVELS: ReadonlyArray<number> = [
  0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0, 4.0, 5.0,
];

export const DEFAULT_ZOOM_FACTOR = 1.0;

export const ZOOM_EPSILON = 0.001;

export const RECORDING_FRAME_INTERVAL_MS = Math.ceil(1_000 / 12);

export const RECORDING_JPEG_QUALITY = 80;

export const PICTURE_IN_PICTURE_INITIAL_WIDTH = 480;

export const PICTURE_IN_PICTURE_INITIAL_HEIGHT = 320;

export const PICTURE_IN_PICTURE_MIN_WIDTH = 240;

export const PICTURE_IN_PICTURE_MIN_HEIGHT = 160;

export const PICTURE_IN_PICTURE_ASPECT_RATIO_EPSILON = 0.002;

export const MAX_ARTIFACT_SITE_SLUG_LENGTH = 80;

export const encodeUnknownJson = Schema.encodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

export const DEFAULT_ANNOTATION_THEME: DesktopPreviewAnnotationTheme = {
  colorScheme: "light",
  radius: "0.625rem",
  background: "white",
  foreground: "oklch(0.269 0 0)",
  popover: "white",
  popoverForeground: "oklch(0.269 0 0)",
  primary: "oklch(0.488 0.217 264)",
  primaryForeground: "white",
  muted: "rgb(0 0 0 / 4%)",
  mutedForeground: "oklch(0.556 0 0)",
  accent: "rgb(0 0 0 / 4%)",
  accentForeground: "oklch(0.269 0 0)",
  border: "rgb(0 0 0 / 8%)",
  input: "rgb(0 0 0 / 10%)",
  ring: "oklch(0.488 0.217 264)",
  fontSans: "system-ui, sans-serif",
  fontMono: "ui-monospace, monospace",
};

export const buildPreviewPictureInPictureDataUrl = (): string => {
  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'"
    >
    <meta name="color-scheme" content="dark">
    <style>
      html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: #111; }
      body { display: grid; place-items: center; }
      img { width: 100%; height: 100%; object-fit: contain; user-select: none; -webkit-user-drag: none; }
    </style>
  </head>
  <body>
    <img id="preview-frame" alt="Live browser preview">
    <script>
      const frame = document.getElementById("preview-frame");
      window.previewPictureInPicture.onFrame((next) => {
        frame.src = "data:image/jpeg;base64," + next.data;
      });
    </script>
  </body>
</html>`;

  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
};

export const fitPictureInPictureContentSize = (
  current: ReadonlyArray<number>,
  aspectRatio: number,
): readonly [width: number, height: number] => {
  const currentWidth = Math.max(1, current[0] ?? PICTURE_IN_PICTURE_INITIAL_WIDTH);
  const currentHeight = Math.max(1, current[1] ?? PICTURE_IN_PICTURE_INITIAL_HEIGHT);
  const currentArea = currentWidth * currentHeight;
  let width = Math.sqrt(currentArea * aspectRatio);
  let height = width / aspectRatio;

  const minimumScale = Math.max(
    1,
    PICTURE_IN_PICTURE_MIN_WIDTH / width,
    PICTURE_IN_PICTURE_MIN_HEIGHT / height,
  );

  width *= minimumScale;
  height *= minimumScale;

  return [Math.round(width), Math.round(height)];
};

export const artifactSiteSlug = (rawUrl: string): string => {
  try {
    const url = new URL(rawUrl);

    const slug = url.hostname
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, MAX_ARTIFACT_SITE_SLUG_LENGTH)
      .replace(/-+$/g, "");

    return slug || "site";
  } catch {
    return "site";
  }
};

const decodeCaptureRect = Schema.decodeUnknownOption(
  Schema.Struct({
    x: Schema.Number,
    y: Schema.Number,
    width: Schema.Number,
    height: Schema.Number,
  }),
);

export const normalizeCaptureRect = flow(
  decodeCaptureRect,
  Option.filter(
    (rect) =>
      [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) &&
      rect.width > 0 &&
      rect.height > 0,
  ),
  Option.map(({ x, y, width, height }) => ({
    x: Math.max(0, Math.floor(x)),
    y: Math.max(0, Math.floor(y)),
    width: Math.max(1, Math.ceil(width)),
    height: Math.max(1, Math.ceil(height)),
  })),
  Option.getOrNull,
);

export const captureAnnotationScreenshot = (
  tabId: string,
  wc: Electron.WebContents,
  cropRect: PreviewAnnotationRect | null,
): Effect.Effect<PreviewAnnotationPayload["screenshot"], PreviewManagerError> =>
  Effect.tryPromise({
    try: () =>
      wc.capturePage(
        cropRect
          ? {
              x: cropRect.x,
              y: cropRect.y,
              width: cropRect.width,
              height: cropRect.height,
            }
          : undefined,
      ),
    catch: (cause) =>
      new PreviewOperationError({
        operation: "captureAnnotationScreenshot",
        tabId,
        webContentsId: wc.id,
        cause,
      }),
  }).pipe(
    Effect.map((image) => {
      const size = image.getSize();

      return {
        dataUrl: image.toDataURL(),
        width: size.width,
        height: size.height,
        cropRect: cropRect ?? { x: 0, y: 0, width: size.width, height: size.height },
      };
    }),
  );

export const findZoomStep = (current: number): number => {
  const index = ZOOM_LEVELS.findIndex(
    (level) => Math.abs(level - current) < ZOOM_EPSILON || level > current,
  );

  if (index < 0) return ZOOM_LEVELS.length - 1;

  return Math.abs(ZOOM_LEVELS[index]! - current) < ZOOM_EPSILON ? index : index - 1;
};

/**
 * Clamp a client-supplied zoom factor onto the discrete ladder. The setting is
 * chosen from the same ladder, but it arrives over IPC from a schema that only
 * guarantees a positive number, so an out-of-band value snaps to the nearest
 * step rather than leaving the guest at a zoom the zoom controls can't reach.
 */
export const normalizeZoomFactor = (value: number | undefined): number => {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_ZOOM_FACTOR;
  let closest = ZOOM_LEVELS[0]!;

  for (const level of ZOOM_LEVELS) {
    if (Math.abs(level - value) < Math.abs(closest - value)) closest = level;
  }

  return closest;
};

export const nextZoomLevel = (current: number, direction: "in" | "out"): number => {
  const step = findZoomStep(current);

  if (direction === "in") {
    return ZOOM_LEVELS[Math.min(step + 1, ZOOM_LEVELS.length - 1)] ?? current;
  }

  return ZOOM_LEVELS[Math.max(step - 1, 0)] ?? current;
};

export type Listener = (tabId: string, state: PreviewTabState) => Effect.Effect<void>;

export type RecordingFrameListener = (frame: DesktopPreviewRecordingFrame) => Effect.Effect<void>;

export interface ManagedListeners {
  readonly attachmentId: symbol;
  readonly cancelFaviconCapture: () => void;
  readonly scope: Scope.Closeable;
  readonly webContents: Electron.WebContents;
}

export type FrameCaptureConsumer = "picture-in-picture" | "recording";

export interface FrameCaptureSession {
  readonly scope: Scope.Closeable;
  readonly consumers: ReadonlySet<FrameCaptureConsumer>;
  readonly lastPictureInPictureFrame: Buffer | null;
}

export interface PictureInPictureSession {
  readonly window: BrowserWindow;
  readonly webContentsId: number;
  readonly ready: Deferred.Deferred<void, PreviewManagerError>;
  readonly initializationScope: Scope.Closeable;
}

export interface PickSession {
  readonly cancel: Effect.Effect<void>;
}

export interface BrowserControlSession {
  readonly webContentsId: number;
  // Pins the WebContents' Debugger wrapper for the session's lifetime.
  // Electron's Debugger is GC-managed but registered with Chromium as a raw
  // DevToolsAgentHostClient pointer; collecting it while attached crashes the
  // browser process (electron/electron#53376). Detach must also go through
  // this reference: `wc.debugger` throws once the WebContents is destroyed.
  readonly debugger: Electron.Debugger;
  readonly semaphore: Semaphore.Semaphore;
  readonly scope: Scope.Closeable;
  readonly onMessage: (
    event: Electron.Event,
    method: string,
    params: Record<string, Schema.Json | undefined>,
  ) => void;
}

export const isPreviewRefreshShortcut = (input: Electron.Input): boolean =>
  input.type === "keyDown" &&
  input.key.toLowerCase() === "r" &&
  (input.meta || input.control) &&
  !input.shift &&
  !input.alt;

export const isPreviewEditingShortcut = (
  input: Electron.Input,
  platform: NodeJS.Platform,
): boolean => {
  const isMac = platform === "darwin";

  if (isMac ? !input.meta || input.control : !input.control || input.meta) return false;

  const key = input.key.toLowerCase();

  // Option changes the DOM key for macOS Paste and Match Style (for example, to ◊).
  if (isMac && input.alt && input.shift && input.code === "KeyV") return true;

  if (key === "v" && input.shift) return input.alt === isMac;

  if (input.alt) return false;

  if (key === "z") return !input.shift || platform !== "win32";

  if (input.shift) return false;

  return (
    key === "a" ||
    key === "c" ||
    key === "v" ||
    key === "x" ||
    (key === "y" && platform === "win32")
  );
};
