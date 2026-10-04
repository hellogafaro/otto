import { useInfiniteQuery } from "@tanstack/react-query";
import { Button } from "@workspace/ui/components/button";
import { Field, FieldLabel } from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import { useState } from "react";
import { DocumentChoice } from "@/components/documents/document-data";
import { canKeepDocumentDraft } from "@/components/documents/document-operation";
import { QueryState } from "@/components/query-state";
import { read } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace";

// Referenced Documents are selected by authorized discovery; never synthetic IDs.
export function DocumentReferenceChoice({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  disabled: boolean;
}) {
  const { api, workspaceId } = useWorkspace();
  const [query, setQuery] = useState("");
  const [queryText, setQueryText] = useState("");
  const documents = useInfiniteQuery({
    queryKey: ["workspace", workspaceId, "document-references", query],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      read(
        await api.documents.$get({
          param: { workspaceId },
          query: {
            limit: "100",
            sort: "title",
            after: pageParam,
            query: query || undefined,
          },
        }),
      ),
    getNextPageParam: (page) => page.next ?? undefined,
  });
  return (
    <>
      <DocumentChoice
        label={label}
        value={value}
        options={[
          { id: "", title: "Unset" },
          ...((documents.error && !canKeepDocumentDraft(documents.error)
            ? undefined
            : documents.data
          )?.pages
            .flatMap((page) => page.items)
            .map((document) => ({ id: document.id, title: document.title })) ??
            []),
        ]}
        onChange={onChange}
        disabled={disabled || Boolean(documents.error)}
      />
      <Field>
        <FieldLabel>Find documents by whole words</FieldLabel>
        <Input
          aria-label={`Find ${label}`}
          maxLength={200}
          value={queryText}
          disabled={disabled}
          onChange={(event) => setQueryText(event.target.value)}
        />
      </Field>
      <Button
        variant="ghost"
        disabled={disabled}
        onClick={() => setQuery(queryText.trim())}
      >
        Find document
      </Button>
      <QueryState
        pending={documents.isPending}
        error={documents.error}
        retry={() => documents.refetch()}
      />
      {documents.hasNextPage && (
        <Button
          variant="outline"
          disabled={disabled || documents.isFetchingNextPage}
          onClick={() => documents.fetchNextPage()}
        >
          Load more documents
        </Button>
      )}
    </>
  );
}
