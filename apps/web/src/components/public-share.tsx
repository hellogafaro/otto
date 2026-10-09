import { RiDownloadLine, RiFileTextLine } from "@remixicon/react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@workspace/ui/components/button";
import { useState } from "react";
import { Editor } from "@/components/editor/editor";
import { Page } from "@/components/page";
import { QueryState } from "@/components/query-state";
import { ApiError, client, read } from "@/lib/api";
import { boundedFileBlob, PREVIEW_BYTES } from "@/lib/file-library";

/** Anonymous frozen selections: no workspace/session context, credentials or private source navigation. */
export function PublicSharePage({ shareId }: { shareId: string }) {
  const [previewId, setPreviewId] = useState<string>();
  const showHtml = previewId === shareId;
  const share = useQuery({
    queryKey: ["public-share", shareId],
    gcTime: 0,
    staleTime: 0,
    retry: false,
    queryFn: async ({ signal }) =>
      read(
        await client.shares[":id"].$get(
          { param: { id: shareId } },
          { init: { credentials: "omit", signal } },
        ),
      ),
  });
  const file = share.data?.type === "file" ? share.data.file : null;
  const html = useQuery({
    queryKey: ["public-share", shareId, "html"],
    enabled: showHtml && file?.mediaType.split(";")[0]?.trim() === "text/html",
    gcTime: 0,
    staleTime: 0,
    retry: false,
    queryFn: async ({ signal }) => {
      if (!file)
        throw new Error("No file bytes were included in this selection.");
      const response = await client.shares[":id"].file.$get(
        { param: { id: shareId } },
        { init: { credentials: "omit", signal } },
      );
      return (
        await boundedFileBlob(response, file.byteLength, file.mediaType)
      ).text();
    },
  });
  const error =
    share.error instanceof ApiError && share.error.status === 404
      ? new Error("This shared selection is no longer available.")
      : share.error;
  return (
    <main className="flex min-h-svh flex-col">
      <Page
        title={
          share.error
            ? "Shared selection"
            : (share.data?.title ?? "Shared selection")
        }
        floating={null}
        actions={
          <Button
            variant="ghost"
            onClick={() => share.refetch()}
            disabled={share.isFetching}
          >
            Refresh
          </Button>
        }
      >
        <QueryState
          pending={share.isPending}
          error={error}
          retry={() => share.refetch()}
        />
        {share.data && !share.error && (
          <>
            <p className="text-muted-foreground">
              A frozen selection shared from Otto.
            </p>
            {share.data.type === "document" && (
              <Editor value={share.data.body} readOnly />
            )}
            {share.data.type === "chat" && (
              <div className="flex flex-col gap-5">
                {share.data.messages.map((message, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: frozen snapshots contain no message IDs; order and body identify this read-only entry.
                  <article key={`${index}:${message.body}`}>
                    <Editor value={message.body} readOnly />
                  </article>
                ))}
              </div>
            )}
            {share.data.type === "file" && (
              <>
                <div className="flex items-center gap-2">
                  <RiFileTextLine />
                  <span>{share.data.fileType}</span>
                </div>
                {share.data.labels.length > 0 && (
                  <p>{share.data.labels.join(", ")}</p>
                )}
                {file ? (
                  <>
                    <p>
                      {file.byteLength.toLocaleString()} bytes ·{" "}
                      {file.mediaType}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        nativeButton={false}
                        render={
                          <a
                            href={`/api${client.shares[":id"].file.$path({ param: { id: shareId } })}`}
                            download={share.data.title}
                          />
                        }
                      >
                        <RiDownloadLine data-icon="inline-start" />
                        Download shared file
                      </Button>
                      {file.mediaType.split(";")[0]?.trim() === "text/html" &&
                        file.byteLength <= PREVIEW_BYTES && (
                          <Button
                            variant="outline"
                            onClick={() =>
                              setPreviewId(showHtml ? undefined : shareId)
                            }
                          >
                            {showHtml ? "Close HTML preview" : "Preview HTML"}
                          </Button>
                        )}
                      {file.mediaType.split(";")[0]?.trim() === "text/html" &&
                        file.byteLength > PREVIEW_BYTES && (
                          <p>
                            HTML preview is limited to 8 MiB. Download the
                            shared file to open it.
                          </p>
                        )}
                    </div>
                    {showHtml && (
                      <>
                        <QueryState
                          pending={html.isPending}
                          error={html.error}
                          retry={() => html.refetch()}
                        />
                        {html.data !== undefined && !html.error && (
                          <iframe
                            title={share.data.title}
                            sandbox=""
                            referrerPolicy="no-referrer"
                            srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'">${html.data}`}
                            className="h-96 w-full"
                          />
                        )}
                      </>
                    )}
                  </>
                ) : (
                  <p>
                    This selection shares metadata only. File bytes were not
                    included.
                  </p>
                )}
              </>
            )}
          </>
        )}
      </Page>
    </main>
  );
}
