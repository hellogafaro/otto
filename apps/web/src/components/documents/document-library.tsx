import { RiFileTextLine } from "@remixicon/react";
import { Link, useBlocker, useNavigate } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Field, FieldGroup, FieldLabel } from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import { Textarea } from "@workspace/ui/components/textarea";
import { useRef, useState } from "react";
import {
  DocumentChoice,
  DocumentDirectoryPages,
  documentInputError,
  FolderChoice,
  parseDocumentLabels,
  useDocument,
  useDocumentWriter,
} from "@/components/documents/document-data";
import { DocumentMenu } from "@/components/documents/document-menu";
import { GalleryItem } from "@/components/gallery";
import { QueryState } from "@/components/query-state";
import { ApiError, read } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace";

export function DocumentItem({
  document,
}: {
  document: { id: string; title: string };
}) {
  const detail = useDocument(document.id);
  const available = detail.error ? undefined : detail.data;
  return (
    <GalleryItem
      render={
        <Link
          to="/library/documents/$documentId"
          params={{ documentId: document.id }}
        />
      }
      className="aspect-[4/5] bg-card"
      tile={
        <p className="size-full mask-b-from-60% p-3 text-xs text-muted-foreground">
          {available
            ? excerptOf(available.body)
            : detail.error
              ? detail.error.message
              : "Loading document"}
        </p>
      }
      icon={RiFileTextLine}
      title={available?.title ?? document.title}
      menu={<DocumentMenu id={document.id} document={available} />}
    />
  );
}
function excerptOf(content: string) {
  return content
    .split("\n")
    .filter((line) => line.trim() && !line.startsWith("#"))
    .map((line) => line.replace(/^\s*(?:[-*+]|\d+\.)\s+(?:\[[ x]\]\s+)?/, ""))
    .join(" ")
    .replace(/[*_`]/g, "");
}

export function CreateDocument({
  onClose,
  projectId: initialProjectId = "",
  folderId: initialFolderId = "",
  visibility: initialVisibility = "user",
}: {
  onClose(): void;
  projectId?: string;
  folderId?: string;
  visibility?: "user" | "workspace";
}) {
  const { api, workspaceId, invalidate } = useWorkspace();
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [labels, setLabels] = useState("");
  const [projectId, setProjectId] = useState(initialProjectId);
  const [folderId, setFolderId] = useState(initialFolderId);
  const [visibility, setVisibility] = useState(initialVisibility);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const { directory, canWrite, members } = useDocumentWriter(projectId);
  const acknowledged = useRef(false);
  const dirty = Boolean(
    title ||
      body ||
      labels ||
      projectId !== initialProjectId ||
      folderId !== initialFolderId ||
      visibility !== initialVisibility,
  );
  useBlocker({
    shouldBlockFn: () =>
      !acknowledged.current &&
      (pending || (dirty && !window.confirm("Discard this new document?"))),
    enableBeforeUnload: () => !acknowledged.current && (pending || dirty),
  });
  async function create() {
    const parsed = parseDocumentLabels(labels);
    const invalid = documentInputError(title, body, parsed);
    if (invalid) {
      setError(new Error(invalid));
      return;
    }
    setPending(true);
    setError(null);
    try {
      const document = await read(
        await api.documents.$post({
          param: { workspaceId },
          json: {
            title: title.trim(),
            body,
            labels: parsed,
            visibility,
            projectId: projectId || undefined,
            folderId: folderId || undefined,
          },
        }),
      );
      await invalidate();
      acknowledged.current = true;
      onClose();
      await navigate({
        to: "/library/documents/$documentId",
        params: { documentId: document.id },
      });
    } catch (error) {
      setError(
        error instanceof ApiError
          ? error
          : new Error(
              "Could not confirm creation. Check Library before trying again.",
            ),
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent
        showCloseButton={!pending}
        className="max-h-[85vh] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>New document</DialogTitle>
          <DialogDescription>
            Write a document in this workspace.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            create();
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="new-document-title">Title</FieldLabel>
              <Input
                id="new-document-title"
                required
                maxLength={200}
                value={title}
                disabled={pending}
                onChange={(event) => setTitle(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="new-document-body">Body</FieldLabel>
              <Textarea
                id="new-document-body"
                value={body}
                maxLength={100000}
                disabled={pending}
                onChange={(event) => setBody(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="new-document-labels">
                Labels, one per line
              </FieldLabel>
              <Textarea
                id="new-document-labels"
                value={labels}
                disabled={pending}
                onChange={(event) => setLabels(event.target.value)}
              />
            </Field>
            <DocumentChoice
              label="Project"
              value={projectId}
              options={[{ id: "", title: "No project" }, ...directory.projects]}
              onChange={(value) => {
                setProjectId(value);
                setFolderId("");
              }}
              disabled={pending}
            />
            <DocumentDirectoryPages projects />
            <DocumentChoice
              label="Visibility"
              value={visibility}
              options={[
                { id: "user", title: "Only me" },
                { id: "workspace", title: "Workspace" },
              ]}
              onChange={(value) => {
                setVisibility(value as typeof visibility);
                setFolderId("");
              }}
              disabled={pending}
            />
            <FolderChoice
              key={projectId}
              projectId={projectId || null}
              visibility={visibility}
              value={folderId}
              onChange={setFolderId}
              disabled={pending}
            />
          </FieldGroup>
          <QueryState
            error={error ?? directory.error ?? members.error}
            retry={() => {
              directory.membersQuery.refetch();
              directory.agentsQuery.refetch();
              directory.projectsQuery.refetch();
              if (projectId) members.refetch();
            }}
          />
          {members.hasNextPage && !canWrite && (
            <Button
              variant="outline"
              type="button"
              onClick={() => members.fetchNextPage()}
            >
              Load more project members
            </Button>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              type="button"
              disabled={pending}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !canWrite}>
              {pending ? "Creating" : "Create document"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
