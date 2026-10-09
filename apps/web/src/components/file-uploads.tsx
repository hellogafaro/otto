import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Field, FieldGroup, FieldLabel } from "@workspace/ui/components/field";
import { Spinner } from "@workspace/ui/components/spinner";
import { useEffect, useRef, useState } from "react";
import { VisibilityField } from "@/components/file-edit";
import { MAX_UPLOAD_BYTES } from "@/lib/file-library";
import { uploadFile } from "@/lib/file-upload";
import { useWorkspace } from "@/lib/workspace";

interface Upload {
  file: File;
  requestId: string;
  state: "waiting" | "uploading" | "uncertain" | "saved";
  error?: string;
  selection?: {
    workspaceId: string;
    projectId?: string;
    folderId?: string;
    visibility: "user" | "workspace";
  };
}

export function FileUploads({
  files,
  folderId,
  projectId,
  folderVisibility,
  onClose,
}: {
  files: File[];
  folderId?: string;
  projectId?: string;
  folderVisibility?: "user" | "workspace";
  onClose(): void;
}) {
  const { workspaceId, invalidate } = useWorkspace();
  const [uploads, setUploads] = useState<Upload[]>(() =>
    files.map((file) => ({
      file,
      requestId: crypto.randomUUID(),
      state: "waiting",
    })),
  );
  const [visibility, setVisibility] = useState<"user" | "workspace">("user");
  const controllers = useRef(new Map<string, AbortController>());
  useEffect(
    () => () => {
      for (const controller of controllers.current.values()) controller.abort();
    },
    [],
  );
  const active = uploads.some((upload) => upload.state === "uploading");
  const started = uploads.some((upload) => upload.selection);
  async function send(upload: Upload) {
    if (controllers.current.has(upload.requestId)) return;
    const controller = new AbortController();
    controllers.current.set(upload.requestId, controller);
    const selection = upload.selection ?? {
      workspaceId,
      folderId,
      projectId,
      visibility,
    };
    setUploads((items) =>
      items.map((item) =>
        item.requestId === upload.requestId
          ? { ...item, state: "uploading", error: undefined, selection }
          : item,
      ),
    );
    try {
      await uploadFile({
        ...selection,
        file: upload.file,
        requestId: upload.requestId,
        signal: controller.signal,
      });
      setUploads((items) =>
        items.map((item) =>
          item.requestId === upload.requestId
            ? { ...item, state: "saved", error: undefined }
            : item,
        ),
      );
      await invalidate();
    } catch (cause) {
      setUploads((items) =>
        items.map((item) =>
          item.requestId === upload.requestId
            ? {
                ...item,
                state: "uncertain",
                error: controller.signal.aborted
                  ? "Stopped waiting. The server may have saved this file; retry the same request to reconcile."
                  : cause instanceof Error
                    ? cause.message
                    : "Upload could not be confirmed. Retry the same request.",
              }
            : item,
        ),
      );
    } finally {
      controllers.current.delete(upload.requestId);
    }
  }
  return (
    <Dialog open onOpenChange={(open) => !open && !active && onClose()}>
      <DialogContent showCloseButton={!active}>
        <DialogHeader>
          <DialogTitle>Upload files</DialogTitle>
          <DialogDescription>
            Up to 100,000,000 bytes per file. Retry keeps the exact upload
            request; closing loses that retry selection.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <VisibilityField
            value={visibility}
            onChange={setVisibility}
            disabled={started}
            allowWorkspace={folderVisibility !== "user"}
          />
          <div className="flex max-h-72 flex-col gap-3 overflow-y-auto">
            {uploads.map((upload) => (
              <Field key={upload.requestId}>
                <FieldLabel>{upload.file.name}</FieldLabel>
                <span>{upload.file.size.toLocaleString()} bytes</span>
                {upload.file.size > MAX_UPLOAD_BYTES ? (
                  <p role="alert">File exceeds 100,000,000 bytes.</p>
                ) : upload.state === "saved" ? (
                  <p role="status">Saved</p>
                ) : upload.state === "uploading" ? (
                  <div className="flex items-center gap-2">
                    <Spinner />
                    <span role="status">Uploading and verifying</span>
                    <Button
                      variant="ghost"
                      onClick={() =>
                        controllers.current.get(upload.requestId)?.abort()
                      }
                    >
                      Abort
                    </Button>
                  </div>
                ) : (
                  <Button variant="outline" onClick={() => send(upload)}>
                    {upload.state === "uncertain"
                      ? "Retry exact upload"
                      : "Upload"}
                  </Button>
                )}
                {upload.error && <p role="alert">{upload.error}</p>}
              </Field>
            ))}
          </div>
          <Button variant="ghost" disabled={active} onClick={onClose}>
            {uploads.every((upload) => upload.state === "saved")
              ? "Done"
              : "Close"}
          </Button>
        </FieldGroup>
      </DialogContent>
    </Dialog>
  );
}
