import { RiFileTextLine } from "@remixicon/react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useBlocker } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import { Field, FieldGroup, FieldLabel } from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import { Textarea } from "@workspace/ui/components/textarea";
import { useCallback, useEffect, useRef, useState } from "react";
import { DetailView, Section } from "@/components/detail";
import {
  DocumentChoice,
  DocumentDirectoryPages,
  DocumentFolder,
  type DocumentRecord,
  documentInputError,
  FolderChoice,
  parseDocumentLabels,
  useDocument,
  useDocumentWriter,
} from "@/components/documents/document-data";
import {
  canKeepDocumentDraft,
  runDocumentOperation,
} from "@/components/documents/document-operation";
import { DocumentRelations } from "@/components/documents/document-relations";
import { Editor } from "@/components/editor/editor";
import { FloatingChat } from "@/components/floating-chat";
import { QueryState } from "@/components/query-state";
import { ActorAvatar } from "@/components/task-meta";
import { read } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace";

export function DocumentPage({ documentId }: { documentId: string }) {
  const { workspaceId } = useWorkspace();
  const document = useDocument(documentId);
  if (
    !document.data ||
    (document.error && !canKeepDocumentDraft(document.error))
  )
    return (
      <QueryState
        pending={document.isPending}
        error={document.error}
        retry={() => document.refetch()}
      />
    );
  return (
    <DocumentView
      key={`${workspaceId}:${documentId}`}
      document={document.data}
      readError={document.error}
      reload={() => document.refetch()}
    />
  );
}

function DocumentView({
  document,
  readError,
  reload,
}: {
  document: DocumentRecord;
  readError: Error | null;
  reload(): unknown;
}) {
  const { api, workspaceId, user, invalidate } = useWorkspace();
  const cache = useQueryClient();
  const { directory, canWrite, members } = useDocumentWriter(
    document.projectId,
  );
  // The draft retains the source fence through refetches; no background read overwrites it.
  const [source, setSource] = useState(document);
  const [title, setTitle] = useState(document.title);
  const [body, setBody] = useState(document.body);
  const [labels, setLabels] = useState(document.labels.join("\n"));
  const [visibility, setVisibility] = useState(document.visibility);
  const [folderId, setFolderId] = useState(document.folderId ?? "");
  const [editorRevision, setEditorRevision] = useState(0);
  const [pending, setPending] = useState(false);
  const operation = useRef(false);
  const perform = useCallback(
    (action: () => Promise<void>) =>
      runDocumentOperation(operation, action, setPending),
    [],
  );
  const [propertiesDirty, setPropertiesDirty] = useState(false);
  const locked = pending || Boolean(readError);
  const [error, setError] = useState<Error | null>(null);
  const editable = canWrite && document.createdBy === user.id;
  const dirty =
    title !== source.title ||
    body !== source.body ||
    labels !== source.labels.join("\n") ||
    visibility !== source.visibility ||
    folderId !== (source.folderId ?? "");
  const stale = source.editToken !== document.editToken;
  useBlocker({
    shouldBlockFn: () =>
      pending ||
      ((dirty || propertiesDirty) &&
        !window.confirm("Discard unsaved document changes?")),
    enableBeforeUnload: pending || dirty || propertiesDirty,
  });
  const reset = useCallback((next: DocumentRecord) => {
    setSource(next);
    setTitle(next.title);
    setBody(next.body);
    setLabels(next.labels.join("\n"));
    setVisibility(next.visibility);
    setFolderId(next.folderId ?? "");
    setEditorRevision((value) => value + 1);
    setError(null);
  }, []);
  useEffect(() => {
    if (!dirty && source.editToken !== document.editToken) reset(document);
  }, [document, dirty, source.editToken, reset]);
  async function acknowledge(next: DocumentRecord) {
    cache.setQueryData(
      ["workspace", workspaceId, "document", document.id],
      next,
    );
    reset(next);
    await invalidate();
  }
  async function save() {
    const parsed = parseDocumentLabels(labels);
    const invalid = documentInputError(title, body, parsed);
    if (invalid) {
      setError(new Error(invalid));
      return;
    }
    setError(null);
    try {
      await perform(async () =>
        acknowledge(
          await read(
            await api.documents[":id"].$patch({
              param: { workspaceId, id: document.id },
              json: {
                title: title.trim(),
                body,
                labels: parsed,
                visibility,
                folderId: folderId || null,
                editToken: source.editToken,
              },
            }),
          ),
        ),
      );
    } catch (error) {
      setError(
        error instanceof Error ? error : new Error("Unable to save document."),
      );
    }
  }
  async function archive() {
    setError(null);
    try {
      await perform(async () =>
        acknowledge(
          await read(
            await api.documents[":id"].archive.$post({
              param: { workspaceId, id: document.id },
              json: {
                archived: !document.archived,
                editToken: document.editToken,
              },
            }),
          ),
        ),
      );
    } catch (error) {
      setError(
        error instanceof Error
          ? error
          : new Error("Unable to change archive state."),
      );
    }
  }
  return (
    <DetailView
      parent={{
        label: "Documents",
        icon: RiFileTextLine,
        link: <Link to="/documents" />,
      }}
      current={{ icon: RiFileTextLine }}
      title={document.title}
      type="document"
      archives
      ask={
        <FloatingChat
          about="this document"
          projectId={document.projectId ?? undefined}
        />
      }
      people={
        <span className="flex h-8 items-center gap-2 border border-transparent px-2 font-medium">
          <ActorAvatar actorId={document.createdBy} />
          {directory.actorOf(document.createdBy).name}
        </span>
      }
      actions={
        editable && (
          <Button
            variant="ghost"
            size="sm"
            disabled={locked || dirty || propertiesDirty}
            onClick={archive}
          >
            {document.archived ? "Restore" : "Archive"}
          </Button>
        )
      }
      panel={
        <Section title="Properties">
          <div className="flex flex-col gap-3 px-2">
            <FieldGroup>
              <Field>
                <FieldLabel>Project</FieldLabel>
                {document.projectId ? (
                  <Link
                    to="/projects/$projectId"
                    params={{ projectId: document.projectId }}
                  >
                    {directory.projects.find(
                      (item) => item.id === document.projectId,
                    )?.title ?? "Open project"}
                  </Link>
                ) : (
                  <p>No project</p>
                )}
              </Field>
              {editable ? (
                <>
                  <DocumentChoice
                    label="Visibility"
                    value={visibility}
                    options={[
                      { id: "user", title: "Only me" },
                      { id: "workspace", title: "Workspace" },
                    ]}
                    onChange={(value) =>
                      setVisibility(value as typeof visibility)
                    }
                    disabled={locked}
                  />
                  <FolderChoice
                    projectId={document.projectId}
                    visibility={visibility}
                    value={folderId}
                    onChange={setFolderId}
                    disabled={locked}
                  />
                  <Field>
                    <FieldLabel htmlFor="document-labels">
                      Labels, one per line
                    </FieldLabel>
                    <Textarea
                      id="document-labels"
                      value={labels}
                      disabled={locked}
                      onChange={(event) => setLabels(event.target.value)}
                    />
                  </Field>
                </>
              ) : (
                <>
                  <DocumentFolder
                    folderId={document.folderId}
                    projectId={document.projectId}
                  />
                  <Field>
                    <FieldLabel>Visibility</FieldLabel>
                    <p>
                      {document.visibility === "user" ? "Only me" : "Workspace"}
                    </p>
                  </Field>
                  <Field>
                    <FieldLabel>Labels</FieldLabel>
                    <p>{document.labels.join(", ") || "No labels"}</p>
                  </Field>
                </>
              )}
            </FieldGroup>
            <p>{document.archived ? "Archived" : "Active"}</p>
          </div>
        </Section>
      }
    >
      <QueryState
        error={readError ?? error ?? directory.error ?? members.error}
        retry={() => {
          reload();
          directory.membersQuery.refetch();
          directory.agentsQuery.refetch();
          directory.projectsQuery.refetch();
          members.refetch();
        }}
      />
      <DocumentDirectoryPages members projects />
      {members.hasNextPage && !canWrite && (
        <Button variant="outline" onClick={() => members.fetchNextPage()}>
          Load more project members
        </Button>
      )}
      {stale && (
        <p role="alert">
          This document changed. Your draft is kept. Cancel to use the latest
          document before saving.
        </p>
      )}
      {editable && (
        <Field>
          <FieldLabel htmlFor="document-title">Title</FieldLabel>
          <Input
            id="document-title"
            value={title}
            maxLength={200}
            disabled={locked}
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
      )}
      <Editor
        key={`${editorRevision}:${editable}:${locked}:${!editable ? document.editToken : "draft"}`}
        value={editable ? body : document.body}
        onChange={setBody}
        readOnly={!editable || locked}
        placeholder="Start writing"
      />
      {editable && (
        <div className="flex items-center gap-2">
          <Button disabled={locked || !dirty || stale} onClick={save}>
            {pending ? "Saving" : "Save document"}
          </Button>
          <Button
            variant="outline"
            disabled={pending || (!dirty && !stale)}
            onClick={() => reset(document)}
          >
            Cancel
          </Button>
          {dirty && <span role="status">Unsaved changes</span>}
        </div>
      )}
      <DocumentRelations
        document={document}
        canWrite={canWrite}
        editable={editable}
        blocked={dirty || stale || locked}
        runOperation={perform}
        onDirtyChange={setPropertiesDirty}
        onDocument={acknowledge}
      />
    </DetailView>
  );
}
