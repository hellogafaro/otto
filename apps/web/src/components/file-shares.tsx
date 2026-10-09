import { useInfiniteQuery } from "@tanstack/react-query";
import { Button } from "@workspace/ui/components/button";
import { Checkbox } from "@workspace/ui/components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Field, FieldGroup, FieldLabel } from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import type { InferResponseType } from "hono/client";
import { useState } from "react";
import { QueryState } from "@/components/query-state";
import { ApiError, read, type workspaceApi } from "@/lib/api";
import type { SavedFile } from "@/lib/file-library";
import { useWorkspace } from "@/lib/workspace";

type Preview = InferResponseType<(typeof workspaceApi.shares.preview)["$post"]>;

export function FileShares({
  file,
  onClose,
}: {
  file: SavedFile;
  onClose(): void;
}) {
  const { workspaceId, api, invalidate } = useWorkspace();
  const [includeFile, setIncludeFile] = useState(false);
  const [preview, setPreview] = useState<Preview>();
  const [published, setPublished] = useState<string>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error>();
  const [createUncertain, setCreateUncertain] = useState(false);
  const shares = useInfiniteQuery({
    queryKey: ["workspace", workspaceId, "file-shares"],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      read(
        await api.shares.$get({
          param: { workspaceId },
          query: {
            type: "file",
            limit: "100",
            ...(pageParam ? { after: pageParam } : {}),
          },
        }),
      ),
    getNextPageParam: (page) => page.next ?? undefined,
  });
  const owned =
    (shares.error ? undefined : shares.data)?.pages
      .flatMap((page) => page.items)
      .filter(
        (share) =>
          share.selection.type === "file" &&
          share.selection.targetId === file.id,
      ) ?? [];
  async function act(
    operation: () => Promise<unknown>,
    createsPreview = false,
  ) {
    if (pending || (createsPreview && createUncertain)) return;
    setPending(true);
    setError(undefined);
    try {
      await operation();
    } catch (cause) {
      if (
        createsPreview &&
        !(
          cause instanceof ApiError &&
          cause.status >= 400 &&
          cause.status < 500
        )
      )
        setCreateUncertain(true);
      setError(
        cause instanceof Error ? cause : new Error("Unable to update share."),
      );
    } finally {
      // A lost ACK may still have changed the publication or editToken.
      try {
        await invalidate();
      } catch (cause) {
        // An exact acknowledged preview stays available when only refreshing fails.
        setError(
          (current) =>
            current ??
            (cause instanceof Error
              ? cause
              : new Error("Unable to refresh shares.")),
        );
      } finally {
        setPending(false);
      }
    }
  }
  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>Share selected file</DialogTitle>
          <DialogDescription>
            Publishing makes this frozen selection readable by anyone with its
            link. Later metadata edits do not update it.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field orientation="horizontal">
            <Checkbox
              id="share-bytes"
              checked={includeFile}
              disabled={pending || Boolean(preview)}
              onCheckedChange={(checked) => setIncludeFile(checked)}
            />
            <FieldLabel htmlFor="share-bytes">
              Include downloadable file bytes
            </FieldLabel>
          </Field>
          {createUncertain && (
            <p role="alert">
              Preview creation could not be confirmed. Refresh the share list
              and reuse a saved preview below. Creating another preview is
              blocked in this dialog to avoid duplicates.
            </p>
          )}
          {!preview && (
            <Button
              disabled={pending || createUncertain}
              onClick={() =>
                act(async () => {
                  setPublished(undefined);
                  setPreview(
                    await read(
                      await api.shares.preview.$post({
                        param: { workspaceId },
                        json: {
                          selection: {
                            type: "file",
                            targetId: file.id,
                            includeFile,
                          },
                        },
                      }),
                    ),
                  );
                }, true)
              }
            >
              {pending ? "Preparing" : "Preview selection"}
            </Button>
          )}
          {preview && (
            <>
              <p>{preview.preview.title}</p>
              {preview.preview.type === "file" && (
                <p>
                  {preview.preview.file
                    ? `${preview.preview.file.byteLength.toLocaleString()} bytes included`
                    : "Metadata only"}{" "}
                  · {preview.preview.labels.join(", ") || "No labels"}
                </p>
              )}
              {!published && (
                <div className="flex gap-2">
                  <Button
                    disabled={pending}
                    onClick={() =>
                      act(async () => {
                        // A failed ACK cannot leave a stale token publishable again.
                        setPreview(undefined);
                        await read(
                          await api.shares[":id"].publish.$post({
                            param: { workspaceId, id: preview.id },
                            json: { editToken: preview.editToken },
                          }),
                        );
                        setPublished(preview.id);
                        setPreview(undefined);
                      })
                    }
                  >
                    {pending ? "Publishing" : "Publish to internet"}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={pending}
                    onClick={() => setPreview(undefined)}
                  >
                    Close preview
                  </Button>
                </div>
              )}
            </>
          )}
          {published && (
            <Field>
              <FieldLabel>Published link</FieldLabel>
              <Input
                readOnly
                value={`${location.origin}/shares/${published}`}
              />
              <Button
                variant="outline"
                onClick={() =>
                  act(() =>
                    navigator.clipboard.writeText(
                      `${location.origin}/shares/${published}`,
                    ),
                  )
                }
              >
                Copy published link
              </Button>
            </Field>
          )}
          {createUncertain && (
            <Button
              variant="outline"
              disabled={pending || shares.isFetching}
              onClick={() => shares.refetch()}
            >
              Refresh share list
            </Button>
          )}
          <QueryState
            pending={shares.isPending}
            error={shares.error}
            retry={() => shares.refetch()}
          />
          <div className="flex max-h-40 flex-col gap-2 overflow-y-auto">
            {owned.map((share) => (
              <div
                key={share.id}
                className="flex items-center justify-between gap-2"
              >
                <span>
                  {share.published
                    ? "Published selection"
                    : "Unpublished preview"}
                </span>
                {share.published && (
                  <Button
                    variant="ghost"
                    disabled={pending}
                    onClick={() =>
                      act(() =>
                        navigator.clipboard.writeText(
                          `${location.origin}/shares/${share.id}`,
                        ),
                      )
                    }
                  >
                    Copy link
                  </Button>
                )}
                <Button
                  variant="ghost"
                  disabled={pending}
                  onClick={() =>
                    act(async () => {
                      if (share.selection.type !== "file") return;
                      setPublished(undefined);
                      setPreview(undefined);
                      setIncludeFile(share.selection.includeFile);
                      setPreview(
                        await read(
                          await api.shares.preview.$post({
                            param: { workspaceId },
                            json: {
                              selection: share.selection,
                              existing: {
                                id: share.id,
                                editToken: share.editToken,
                              },
                            },
                          }),
                        ),
                      );
                    })
                  }
                >
                  Refresh selection
                </Button>
                <Button
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    act(async () => {
                      // Even a lost revoke ACK makes the prior publication/token uncertain.
                      if (published === share.id) setPublished(undefined);
                      if (preview?.id === share.id) setPreview(undefined);
                      await read(
                        await api.shares[":id"].revoke.$post({
                          param: { workspaceId, id: share.id },
                        }),
                      );
                    })
                  }
                >
                  Revoke
                </Button>
              </div>
            ))}
          </div>
          {shares.hasNextPage && (
            <Button
              variant="outline"
              disabled={pending || shares.isFetchingNextPage}
              onClick={() => shares.fetchNextPage()}
            >
              More shares
            </Button>
          )}
          {error && <p role="alert">{error.message}</p>}
          <Button variant="ghost" disabled={pending} onClick={onClose}>
            Close
          </Button>
        </FieldGroup>
      </DialogContent>
    </Dialog>
  );
}
