import * as Schema from "effect/Schema";

export interface PreviewOperationContext {
  readonly operation: string;
  readonly tabId?: string;
  readonly webContentsId?: number;
  readonly artifactPath?: string;
}

export class PreviewTabNotFoundError extends Schema.TaggedErrorClass<PreviewTabNotFoundError>()(
  "PreviewTabNotFoundError",
  { tabId: Schema.String },
) {
  override get message(): string {
    return `Preview tab not found: ${this.tabId}`;
  }
}

export class PreviewWebContentsNotFoundError extends Schema.TaggedErrorClass<PreviewWebContentsNotFoundError>()(
  "PreviewWebContentsNotFoundError",
  { tabId: Schema.String, webContentsId: Schema.Number },
) {
  override get message(): string {
    return `WebContents ${this.webContentsId} not found for preview tab ${this.tabId}`;
  }
}

export class PreviewWebviewNotInitializedError extends Schema.TaggedErrorClass<PreviewWebviewNotInitializedError>()(
  "PreviewWebviewNotInitializedError",
  { tabId: Schema.String },
) {
  override get message(): string {
    return `Preview tab "${this.tabId}" has no webview registered`;
  }
}

export class PreviewMainWindowClosedError extends Schema.TaggedErrorClass<PreviewMainWindowClosedError>()(
  "PreviewMainWindowClosedError",
  { tabId: Schema.String },
) {
  override get message(): string {
    return `Cannot start preview frame capture while the main window is closed: ${this.tabId}`;
  }
}

export class PreviewOperationError extends Schema.TaggedErrorClass<PreviewOperationError>()(
  "PreviewOperationError",
  {
    operation: Schema.String,
    tabId: Schema.optional(Schema.String),
    webContentsId: Schema.optional(Schema.Number),
    artifactPath: Schema.optional(Schema.String),
    cause: Schema.Defect(),
  },
) {
  static toTimelineMessage(error: PreviewOperationError): string {
    return error.cause instanceof Error ? error.cause.message : String(error.cause);
  }

  override get message(): string {
    const context = [
      this.tabId === undefined ? undefined : `tab ${this.tabId}`,
      this.webContentsId === undefined ? undefined : `WebContents ${this.webContentsId}`,
      this.artifactPath === undefined ? undefined : `artifact ${this.artifactPath}`,
    ].filter((value): value is string => value !== undefined);

    return `Desktop preview operation failed: ${this.operation}${context.length === 0 ? "" : ` (${context.join(", ")})`}`;
  }
}

export const isPreviewOperationError = Schema.is(PreviewOperationError);

export class PreviewArtifactPathOutsideDirectoryError extends Schema.TaggedErrorClass<PreviewArtifactPathOutsideDirectoryError>()(
  "PreviewArtifactPathOutsideDirectoryError",
  {
    artifactPath: Schema.String,
    artifactDirectory: Schema.String,
  },
) {
  override get message(): string {
    return `Preview artifact path ${this.artifactPath} is outside ${this.artifactDirectory}`;
  }
}

export class PreviewArtifactImageLoadError extends Schema.TaggedErrorClass<PreviewArtifactImageLoadError>()(
  "PreviewArtifactImageLoadError",
  { artifactPath: Schema.String },
) {
  override get message(): string {
    return `Preview artifact could not be loaded as an image: ${this.artifactPath}`;
  }
}

export class PreviewAutomationDevToolsOpenError extends Schema.TaggedErrorClass<PreviewAutomationDevToolsOpenError>()(
  "PreviewAutomationDevToolsOpenError",
  { webContentsId: Schema.Number },
) {
  override get message(): string {
    return `Close preview DevTools before using bot browser control for WebContents ${this.webContentsId}`;
  }
}

export class PreviewAutomationDebuggerAttachedError extends Schema.TaggedErrorClass<PreviewAutomationDebuggerAttachedError>()(
  "PreviewAutomationDebuggerAttachedError",
  { webContentsId: Schema.Number },
) {
  override get message(): string {
    return `Preview control cannot attach to WebContents ${this.webContentsId} because another debugger owns it`;
  }
}

export const PreviewManagerError = Schema.Union([
  PreviewTabNotFoundError,
  PreviewWebContentsNotFoundError,
  PreviewWebviewNotInitializedError,
  PreviewMainWindowClosedError,
  PreviewOperationError,
  PreviewArtifactPathOutsideDirectoryError,
  PreviewArtifactImageLoadError,
  PreviewAutomationDevToolsOpenError,
  PreviewAutomationDebuggerAttachedError,
]);

export type PreviewManagerError = typeof PreviewManagerError.Type;

export const isPreviewManagerError = Schema.is(PreviewManagerError);
