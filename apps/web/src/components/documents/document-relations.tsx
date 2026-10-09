import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link, useBlocker } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import { Checkbox } from "@workspace/ui/components/checkbox";
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
import { useEffect, useState } from "react";
import { CollectionManager } from "@/components/documents/collection-manager";
import {
  DocumentChoice,
  DocumentDirectoryPages,
  type DocumentRecord,
  documentInputError,
} from "@/components/documents/document-data";
import { canKeepDocumentDraft } from "@/components/documents/document-operation";
import { DocumentReferenceChoice } from "@/components/documents/document-reference-choice";
import { Editor } from "@/components/editor/editor";
import { QueryState } from "@/components/query-state";
import { ApiError, read } from "@/lib/api";
import { useDirectory } from "@/lib/directory";
import { useWorkspace } from "@/lib/workspace";

export function DocumentRelations({
  document,
  editable,
  canWrite,
  blocked,
  runOperation,
  onDirtyChange,
  onDocument,
}: {
  document: DocumentRecord;
  editable: boolean;
  canWrite: boolean;
  blocked: boolean;
  runOperation(action: () => Promise<void>): Promise<void>;
  onDirtyChange(dirty: boolean): void;
  onDocument(document: DocumentRecord): Promise<void>;
}) {
  const { api, workspaceId, invalidate, workspace } = useWorkspace();
  const directory = useDirectory();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [adding, setAdding] = useState(false);
  const [proposalOpen, setProposalOpen] = useState(false);
  const [archivedCollections, setArchivedCollections] = useState(false);
  const [collectionId, setCollectionId] = useState(document.collectionId ?? "");
  const [properties, setProperties] = useState<DocumentRecord["properties"]>(
    document.properties,
  );
  const [propertyDirty, setPropertyDirty] = useState(false);
  const [propertyToken, setPropertyToken] = useState(document.editToken);
  const propertyStale = propertyDirty && propertyToken !== document.editToken;
  function changePropertyDirty(dirty: boolean) {
    setPropertyDirty(dirty);
    onDirtyChange(dirty);
  }
  useEffect(() => {
    if (!propertyDirty) {
      setCollectionId(document.collectionId ?? "");
      setProperties(document.properties);
      setPropertyToken(document.editToken);
    }
  }, [
    document.collectionId,
    document.editToken,
    document.properties,
    propertyDirty,
  ]);
  const [selectedFileId, setSelectedFileId] = useState("");
  const collections = useInfiniteQuery({
    queryKey: [
      "workspace",
      workspaceId,
      "document-collections",
      document.projectId,
      archivedCollections,
    ],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      read(
        await api.collections.$get({
          param: { workspaceId },
          query: {
            projectId: document.projectId ?? undefined,
            archived: archivedCollections ? "true" : "false",
            limit: "100",
            sort: "title",
            after: pageParam,
          },
        }),
      ),
    getNextPageParam: (page) => page.next ?? undefined,
  });
  const collection = useQuery({
    queryKey: ["workspace", workspaceId, "collection", collectionId],
    queryFn: async () =>
      read(
        await api.collections[":id"].$get({
          param: { workspaceId, id: collectionId },
        }),
      ),
    enabled: Boolean(collectionId),
    retry: false,
  });
  const files = useInfiniteQuery({
    queryKey: [
      "workspace",
      workspaceId,
      "document-file-picker",
      document.projectId,
    ],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      read(
        await api.files.$get({
          param: { workspaceId },
          query: {
            projectId: document.projectId ?? undefined,
            limit: "100",
            sort: "title",
            after: pageParam,
          },
        }),
      ),
    getNextPageParam: (page) => page.next ?? undefined,
    enabled: adding,
  });
  const proposals = useInfiniteQuery({
    queryKey: ["workspace", workspaceId, "document-proposals", document.id],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      read(
        await api.documents[":id"].proposals.$get({
          param: { workspaceId, id: document.id },
          query: { limit: "100", sort: "title", after: pageParam },
        }),
      ),
    getNextPageParam: (page) => page.next ?? undefined,
  });
  const collectionData =
    collection.error && !canKeepDocumentDraft(collection.error)
      ? undefined
      : collection.data;
  const collectionReadFailed = Boolean(collection.error);
  const listCollections =
    collections.error && !canKeepDocumentDraft(collections.error)
      ? undefined
      : collections.data;
  const listFiles =
    files.error && !canKeepDocumentDraft(files.error) ? undefined : files.data;
  const listProposals =
    proposals.error && !canKeepDocumentDraft(proposals.error)
      ? undefined
      : proposals.data;
  const locked = blocked || pending;
  async function run(action: () => Promise<unknown>) {
    setPending(true);
    setError(null);
    try {
      await runOperation(async () => {
        try {
          await action();
        } finally {
          await invalidate();
        }
      });
    } catch (error) {
      setError(
        error instanceof Error
          ? error
          : new Error("Unable to update document."),
      );
    } finally {
      setPending(false);
    }
  }
  const options =
    listCollections?.pages
      .flatMap((page) => page.items)
      .filter(
        (item) =>
          item.projectId === document.projectId &&
          !(
            collection.error &&
            !canKeepDocumentDraft(collection.error) &&
            item.id === collectionId
          ),
      )
      .map((item) => ({ id: item.id, title: item.title })) ?? [];
  const currentProperties = propertyDirty
    ? properties
    : document.collectionId === collectionId
      ? document.properties
      : properties;
  function property(id: string, value: string | number | boolean | null) {
    setProperties({ ...currentProperties, [id]: value });
    if (!propertyDirty) setPropertyToken(document.editToken);
    changePropertyDirty(true);
  }
  return (
    <div className="flex flex-col gap-5">
      <QueryState
        error={error}
        retry={() => {
          collections.refetch();
          collection.refetch();
          proposals.refetch();
        }}
      />
      <section className="flex flex-col gap-3">
        <h2>Attachments</h2>
        {document.fileIds.length === 0 && <p>No attachments</p>}
        {document.fileIds.map((id) => (
          <Attachment
            projectId={document.projectId}
            key={id}
            id={id}
            remove={
              editable
                ? () =>
                    run(async () =>
                      onDocument(
                        await read(
                          await api.documents[":id"].attachments.$put({
                            param: { workspaceId, id: document.id },
                            json: {
                              editToken: document.editToken,
                              fileIds: document.fileIds.filter(
                                (fileId) => fileId !== id,
                              ),
                            },
                          }),
                        ),
                      ),
                    )
                : undefined
            }
            disabled={locked}
          />
        ))}
        {editable && (
          <Button
            variant="outline"
            disabled={locked || document.fileIds.length >= 30}
            onClick={() => setAdding(true)}
          >
            Attach saved file
          </Button>
        )}
        <Dialog
          open={adding}
          onOpenChange={(open) => !pending && setAdding(open)}
        >
          <DialogContent
            showCloseButton={!pending}
            className="max-h-[85vh] overflow-y-auto"
          >
            <DialogHeader>
              <DialogTitle>Attach saved file</DialogTitle>
              <DialogDescription>
                The file must be readable by everyone who can read this
                document.
              </DialogDescription>
            </DialogHeader>
            <DocumentChoice
              label="File"
              value={selectedFileId}
              options={[
                { id: "", title: "Choose a file" },
                ...(listFiles?.pages
                  .flatMap((page) => page.items)
                  .filter((item) => !document.fileIds.includes(item.id))
                  .map((item) => ({ id: item.id, title: item.title })) ?? []),
              ]}
              onChange={setSelectedFileId}
              disabled={locked || Boolean(files.error)}
            />
            <QueryState
              pending={files.isPending}
              error={files.error ?? error}
              retry={() => files.refetch()}
            />
            {files.hasNextPage && (
              <Button
                variant="outline"
                disabled={files.isFetchingNextPage}
                onClick={() => files.fetchNextPage()}
              >
                Load more files
              </Button>
            )}
            <DialogFooter>
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => setAdding(false)}
              >
                Cancel
              </Button>
              <Button
                disabled={locked || Boolean(files.error) || !selectedFileId}
                onClick={() =>
                  run(async () => {
                    await onDocument(
                      await read(
                        await api.documents[":id"].attachments.$put({
                          param: { workspaceId, id: document.id },
                          json: {
                            editToken: document.editToken,
                            fileIds: [...document.fileIds, selectedFileId],
                          },
                        }),
                      ),
                    );
                    setAdding(false);
                    setSelectedFileId("");
                  })
                }
              >
                {pending ? "Attaching" : "Attach"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </section>
      <section className="flex flex-col gap-3">
        <h2>Collection</h2>
        {canWrite && (
          <DocumentChoice
            label="Browse collections"
            value={archivedCollections ? "archived" : "active"}
            options={[
              { id: "active", title: "Active collections" },
              { id: "archived", title: "Archived collections" },
            ]}
            onChange={(value) => setArchivedCollections(value === "archived")}
            disabled={locked}
          />
        )}
        <QueryState
          pending={collections.isPending}
          error={collections.error ?? collection.error}
          retry={() => {
            collections.refetch();
            collection.refetch();
          }}
        />
        {editable ? (
          <DocumentChoice
            label="Collection"
            value={collectionId}
            options={[
              ...(document.collectionId
                ? []
                : [{ id: "", title: "Choose a collection" }]),
              ...options,
            ]}
            onChange={(id) => {
              setCollectionId(id);
              if (!propertyDirty) setPropertyToken(document.editToken);
              setProperties(
                id === document.collectionId ? document.properties : {},
              );
              changePropertyDirty(true);
            }}
            disabled={locked || Boolean(collections.error)}
          />
        ) : (
          <p>{collectionData?.title ?? "No collection"}</p>
        )}
        {collections.hasNextPage && (
          <Button
            variant="outline"
            disabled={collections.isFetchingNextPage}
            onClick={() => collections.fetchNextPage()}
          >
            Load more collections
          </Button>
        )}
        {collectionData?.archived && (
          <p>
            This Collection is archived. Restore it before changing properties.
          </p>
        )}
        {collectionData && (
          <FieldGroup>
            {collectionData.fields.map((field) => (
              <Field key={field.id}>
                <FieldLabel htmlFor={`property-${field.id}`}>
                  {field.title}
                </FieldLabel>
                {field.type === "checkbox" ? (
                  <Checkbox
                    id={`property-${field.id}`}
                    checked={currentProperties[field.id] === true}
                    disabled={
                      !editable ||
                      locked ||
                      collectionReadFailed ||
                      Boolean(collectionData?.archived)
                    }
                    onCheckedChange={(value) =>
                      property(field.id, Boolean(value))
                    }
                  />
                ) : field.type === "select" ||
                  field.type === "human" ||
                  field.type === "agent" ? (
                  <DocumentChoice
                    label={field.title}
                    value={String(currentProperties[field.id] ?? "")}
                    options={[
                      { id: "", title: "Unset" },
                      ...(field.type === "select"
                        ? (field.options ?? []).map((id) => ({ id, title: id }))
                        : field.type === "human"
                          ? directory.members.map((item) => ({
                              id: item.userId,
                              title: item.name,
                            }))
                          : directory.agents.map((item) => ({
                              id: item.id,
                              title: item.title,
                            }))),
                    ]}
                    onChange={(value) => property(field.id, value || null)}
                    disabled={
                      !editable ||
                      locked ||
                      collectionReadFailed ||
                      Boolean(collectionData?.archived)
                    }
                  />
                ) : field.type === "document" ? (
                  <DocumentReferenceChoice
                    label={field.title}
                    value={String(currentProperties[field.id] ?? "")}
                    disabled={
                      !editable ||
                      locked ||
                      collectionReadFailed ||
                      Boolean(collectionData?.archived)
                    }
                    onChange={(value) => property(field.id, value || null)}
                  />
                ) : (
                  <Input
                    id={`property-${field.id}`}
                    type={
                      field.type === "number"
                        ? "number"
                        : field.type === "date"
                          ? "date"
                          : "text"
                    }
                    value={String(currentProperties[field.id] ?? "")}
                    maxLength={5000}
                    disabled={
                      !editable ||
                      locked ||
                      collectionReadFailed ||
                      Boolean(collectionData?.archived)
                    }
                    onChange={(event) =>
                      property(
                        field.id,
                        event.target.value === ""
                          ? null
                          : field.type === "number"
                            ? Number(event.target.value)
                            : event.target.value,
                      )
                    }
                  />
                )}
              </Field>
            ))}
          </FieldGroup>
        )}
        <DocumentDirectoryPages
          members={collectionData?.fields.some(
            (field) => field.type === "human",
          )}
          agents={collectionData?.fields.some(
            (field) => field.type === "agent",
          )}
        />
        {propertyStale && (
          <p role="alert">
            This document changed. Cancel properties and reload before applying
            them.
          </p>
        )}
        {editable && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={
                locked ||
                collectionReadFailed ||
                !collectionId ||
                !collectionData ||
                collectionData.archived ||
                !propertyDirty ||
                propertyStale
              }
              onClick={() =>
                run(async () => {
                  if (
                    Object.values(currentProperties).some(
                      (value) =>
                        typeof value === "number" && !Number.isFinite(value),
                    )
                  )
                    throw new Error(
                      "Use a finite number for Collection properties.",
                    );
                  await onDocument(
                    await read(
                      await api.documents[":id"].collection.$post({
                        param: { workspaceId, id: document.id },
                        json: {
                          collectionId,
                          properties: currentProperties,
                          editToken: propertyToken,
                        },
                      }),
                    ),
                  );
                  changePropertyDirty(false);
                })
              }
            >
              Save properties
            </Button>
            <Button
              variant="ghost"
              disabled={pending || !propertyDirty}
              onClick={() => {
                setCollectionId(document.collectionId ?? "");
                setProperties(document.properties);
                changePropertyDirty(false);
              }}
            >
              Cancel properties
            </Button>
          </div>
        )}
        {canWrite &&
          (!collection.error || canKeepDocumentDraft(collection.error)) && (
            <CollectionManager
              projectId={document.projectId}
              collection={collectionData}
              disabled={locked || collectionReadFailed || propertyDirty}
            />
          )}
      </section>
      <section className="flex flex-col gap-3">
        <h2>Proposals</h2>
        <QueryState
          pending={proposals.isPending}
          error={proposals.error}
          retry={() => proposals.refetch()}
        />
        {listProposals?.pages.flatMap((page) => page.items).length === 0 && (
          <p>No proposals</p>
        )}
        {listProposals?.pages
          .flatMap((page) => page.items)
          .map((proposal) => (
            <div key={proposal.id} className="flex flex-col gap-3">
              <h3>{proposal.title}</h3>
              <p>
                {
                  directory.actorOf(proposal.agentId ?? proposal.proposerId)
                    .name
                }
              </p>
              <Editor value={proposal.body} readOnly />
              {editable && (
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    disabled={
                      locked ||
                      Boolean(proposals.error) ||
                      proposal.editToken !== document.editToken
                    }
                    onClick={() =>
                      run(async () => {
                        await read(
                          await api.documents[":id"].proposals[
                            ":proposalId"
                          ].resolve.$post({
                            param: {
                              workspaceId,
                              id: document.id,
                              proposalId: proposal.id,
                            },
                            json: { accept: true },
                          }),
                        );
                        await onDocument(
                          await read(
                            await api.documents[":id"].$get({
                              param: { workspaceId, id: document.id },
                            }),
                          ),
                        );
                      })
                    }
                  >
                    Accept
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={locked || Boolean(proposals.error)}
                    onClick={() =>
                      run(async () => {
                        await read(
                          await api.documents[":id"].proposals[
                            ":proposalId"
                          ].resolve.$post({
                            param: {
                              workspaceId,
                              id: document.id,
                              proposalId: proposal.id,
                            },
                            json: { accept: false },
                          }),
                        );
                      })
                    }
                  >
                    Reject
                  </Button>
                  {proposal.editToken !== document.editToken && (
                    <p>
                      This proposal targets an older document. Reject it or
                      request a new proposal.
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
        {proposals.hasNextPage && (
          <Button
            variant="outline"
            disabled={proposals.isFetchingNextPage}
            onClick={() => proposals.fetchNextPage()}
          >
            Load more proposals
          </Button>
        )}
        {workspace.role !== "viewer" && (
          <Button
            variant="outline"
            disabled={locked}
            onClick={() => setProposalOpen(true)}
          >
            Propose a change
          </Button>
        )}
        {proposalOpen && (
          <ProposalDialog
            document={document}
            onClose={() => setProposalOpen(false)}
          />
        )}
      </section>
    </div>
  );
}

function Attachment({
  projectId,
  id,
  remove,
  disabled,
}: {
  projectId: string | null;
  id: string;
  remove?: () => Promise<void>;
  disabled: boolean;
}) {
  const { api, workspaceId } = useWorkspace();
  const file = useQuery({
    queryKey: ["workspace", workspaceId, "file", id],
    queryFn: async () =>
      read(await api.files[":id"].$get({ param: { workspaceId, id } })),
    retry: false,
  });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link to="/files" search={{ open: id, project: projectId ?? undefined }}>
        {file.error && !canKeepDocumentDraft(file.error)
          ? "Attachment unavailable"
          : (file.data?.title ?? "Attachment")}
      </Link>
      <QueryState
        pending={file.isPending}
        error={file.error}
        retry={() => file.refetch()}
      />
      {remove && (
        <Button variant="ghost" disabled={disabled} onClick={remove}>
          Remove attachment
        </Button>
      )}
    </div>
  );
}

function ProposalDialog({
  document: initialDocument,
  onClose,
}: {
  document: DocumentRecord;
  onClose(): void;
}) {
  const { api, workspaceId, invalidate } = useWorkspace();
  const [document] = useState(initialDocument);
  const [title, setTitle] = useState(document.title);
  const [body, setBody] = useState(document.body);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const dirty = title !== document.title || body !== document.body;
  useBlocker({
    shouldBlockFn: () =>
      pending || (dirty && !window.confirm("Discard this proposal?")),
    enableBeforeUnload: pending || dirty,
  });
  async function submit() {
    const invalid = documentInputError(title, body, []);
    if (invalid) {
      setError(new Error(invalid));
      return;
    }
    setPending(true);
    setError(null);
    try {
      await read(
        await api.documents[":id"].proposals.$post({
          param: { workspaceId, id: document.id },
          json: { title: title.trim(), body, editToken: document.editToken },
        }),
      );
      await invalidate();
      onClose();
    } catch (error) {
      setError(
        error instanceof ApiError
          ? error
          : new Error(
              "Could not confirm submission. Check proposals before trying again.",
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
          <DialogTitle>Propose a change</DialogTitle>
          <DialogDescription>
            The document author can accept or reject your proposal.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="proposal-title">Title</FieldLabel>
              <Input
                id="proposal-title"
                value={title}
                required
                maxLength={200}
                disabled={pending}
                onChange={(event) => setTitle(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="proposal-body">Body</FieldLabel>
              <Textarea
                id="proposal-body"
                value={body}
                maxLength={100000}
                disabled={pending}
                onChange={(event) => setBody(event.target.value)}
              />
            </Field>
          </FieldGroup>
          <QueryState error={error} />
          <DialogFooter>
            <Button
              variant="outline"
              disabled={pending}
              type="button"
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button disabled={pending} type="submit">
              {pending ? "Submitting" : "Submit proposal"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
