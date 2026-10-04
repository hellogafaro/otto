import { useInfiniteQuery } from "@tanstack/react-query";
import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Field, FieldGroup, FieldLabel } from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import { useState } from "react";
import { QueryState } from "@/components/query-state";
import { read } from "@/lib/api";
import type { SavedFile, SavedFolder } from "@/lib/file-library";
import { useWorkspace } from "@/lib/workspace";

/** A bounded, progressively loaded destination picker; server still checks Project, privacy, cycles and depth. */
export function FolderPicker({
  projectId,
  value,
  onChange,
  disabled,
  excludeId,
}: {
  projectId: string | null;
  value: string | null;
  onChange(id: string | null): void;
  disabled?: boolean;
  excludeId?: string;
}) {
  const { workspaceId, api } = useWorkspace();
  const folders = useInfiniteQuery({
    queryKey: ["workspace", workspaceId, "file-destinations", projectId],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      read(
        await api.folders.$get({
          param: { workspaceId },
          query: {
            limit: "100",
            sort: "title",
            archived: "false",
            ...(projectId ? { projectId } : {}),
            ...(pageParam ? { after: pageParam } : {}),
          },
        }),
      ),
    getNextPageParam: (page) => page.next ?? undefined,
  });
  const choices =
    folders.data?.pages
      .flatMap((page) => page.items)
      .filter(
        (folder) => folder.projectId === projectId && folder.id !== excludeId,
      ) ?? [];
  const selected = choices.find((folder) => folder.id === value);
  return (
    <Field>
      <FieldLabel>Folder</FieldLabel>
      <Button
        type="button"
        variant={!value ? "secondary" : "outline"}
        disabled={disabled}
        onClick={() => onChange(null)}
      >
        Top level
      </Button>
      {value && !selected && <p>Current folder selected</p>}
      <div className="flex max-h-40 flex-col gap-1 overflow-y-auto">
        {choices.map((folder) => (
          <Button
            key={folder.id}
            type="button"
            variant={value === folder.id ? "secondary" : "ghost"}
            disabled={disabled}
            onClick={() => onChange(folder.id)}
          >
            {folder.title} ·{" "}
            {folder.visibility === "user" ? "Only me" : "Workspace"}
          </Button>
        ))}
      </div>
      <QueryState
        pending={folders.isPending}
        error={folders.error}
        retry={() => folders.refetch()}
      />
      {folders.hasNextPage && (
        <Button
          type="button"
          variant="outline"
          disabled={folders.isFetchingNextPage || disabled}
          onClick={() => folders.fetchNextPage()}
        >
          More folders
        </Button>
      )}
    </Field>
  );
}

export function VisibilityField({
  value,
  onChange,
  disabled,
  allowWorkspace = true,
}: {
  value: "user" | "workspace";
  onChange(value: "user" | "workspace"): void;
  disabled?: boolean;
  allowWorkspace?: boolean;
}) {
  return (
    <Field>
      <FieldLabel>Visible to</FieldLabel>
      <div className="flex gap-2">
        <Button
          type="button"
          variant={value === "user" ? "secondary" : "outline"}
          disabled={disabled}
          onClick={() => onChange("user")}
        >
          Only me
        </Button>
        <Button
          type="button"
          variant={value === "workspace" ? "secondary" : "outline"}
          disabled={disabled || !allowWorkspace}
          onClick={() => onChange("workspace")}
        >
          Workspace
        </Button>
      </div>
    </Field>
  );
}

export function FileEdit({
  file,
  onClose,
}: {
  file: SavedFile;
  onClose(): void;
}) {
  const { workspaceId, api, invalidate } = useWorkspace();
  const [title, setTitle] = useState(file.title);
  const [labels, setLabels] = useState(file.labels.join(", "));
  const [visibility, setVisibility] = useState(file.visibility);
  const [folderId, setFolderId] = useState(file.folderId);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error>();
  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>Edit file</DialogTitle>
          <DialogDescription>
            Change metadata and placement. Saved bytes stay immutable.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setPending(true);
            setError(undefined);
            try {
              await read(
                await api.files[":id"].$patch({
                  param: { workspaceId, id: file.id },
                  json: {
                    title: title.trim(),
                    labels: labels
                      .split(",")
                      .map((label) => label.trim())
                      .filter(Boolean),
                    visibility,
                    folderId,
                  },
                }),
              );
              await invalidate();
              onClose();
            } catch (cause) {
              setError(
                cause instanceof Error ? cause : new Error("Unable to save."),
              );
            } finally {
              setPending(false);
            }
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="file-title">Title</FieldLabel>
              <Input
                id="file-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={200}
                required
                disabled={pending}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="file-labels">
                Labels, separated by commas
              </FieldLabel>
              <Input
                id="file-labels"
                value={labels}
                onChange={(event) => setLabels(event.target.value)}
                disabled={pending}
              />
            </Field>
            <VisibilityField
              value={visibility}
              onChange={setVisibility}
              disabled={pending}
            />
            <FolderPicker
              projectId={file.projectId}
              value={folderId}
              onChange={setFolderId}
              disabled={pending}
            />
            {error && <p role="alert">{error.message}</p>}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !title.trim()}>
                {pending ? "Saving" : "Save"}
              </Button>
            </div>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function FolderEdit({
  folder,
  parentId,
  projectId,
  parentVisibility,
  onClose,
}: {
  folder?: SavedFolder;
  parentId?: string;
  projectId?: string;
  parentVisibility?: "user" | "workspace";
  onClose(): void;
}) {
  const { workspaceId, api, invalidate } = useWorkspace();
  const [title, setTitle] = useState(folder?.title ?? "");
  const [visibility, setVisibility] = useState(
    folder?.visibility ?? parentVisibility ?? "user",
  );
  const [destination, setDestination] = useState(
    folder?.parentId ?? parentId ?? null,
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error>();
  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>{folder ? "Edit folder" : "New folder"}</DialogTitle>
          <DialogDescription>
            Folders can nest up to eight levels. Only empty folders can archive.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setPending(true);
            setError(undefined);
            try {
              if (folder)
                await read(
                  await api.folders[":id"].$patch({
                    param: { workspaceId, id: folder.id },
                    json: {
                      title: title.trim(),
                      visibility,
                      parentId: destination,
                    },
                  }),
                );
              else
                await read(
                  await api.folders.$post({
                    param: { workspaceId },
                    json: {
                      title: title.trim(),
                      visibility,
                      ...(destination ? { parentId: destination } : {}),
                      ...(projectId ? { projectId } : {}),
                    },
                  }),
                );
              await invalidate();
              onClose();
            } catch (cause) {
              setError(
                cause instanceof Error ? cause : new Error("Unable to save."),
              );
            } finally {
              setPending(false);
            }
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="folder-title">Title</FieldLabel>
              <Input
                id="folder-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                required
                maxLength={200}
                disabled={pending}
              />
            </Field>
            <VisibilityField
              value={visibility}
              onChange={setVisibility}
              disabled={pending}
            />
            {folder && (
              <FolderPicker
                projectId={folder.projectId}
                value={destination}
                onChange={setDestination}
                disabled={pending}
                excludeId={folder.id}
              />
            )}
            {error && <p role="alert">{error.message}</p>}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !title.trim()}>
                {pending ? "Saving" : "Save"}
              </Button>
            </div>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}
