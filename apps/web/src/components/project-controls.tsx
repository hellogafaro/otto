import { RiBox3Line } from "@remixicon/react";
import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty";
import { Field, FieldGroup, FieldLabel } from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import { useState } from "react";

export const PROJECT_SORTS = ["title", "createdAt", "updatedAt"] as const;
export type ProjectSort = (typeof PROJECT_SORTS)[number];
export interface ProjectFilters {
  query?: string;
  sort?: ProjectSort;
  order?: "asc" | "desc";
  after?: string;
}
export function validateProjectFilters(
  search: Record<string, unknown>,
): ProjectFilters {
  return {
    query:
      typeof search.query === "string" ? search.query.slice(0, 200) : undefined,
    sort: PROJECT_SORTS.find((sort) => sort === search.sort) ?? "title",
    order: search.order === "desc" ? "desc" : "asc",
    after:
      typeof search.after === "string" &&
      search.after.length <= 4096 &&
      /^[A-Za-z0-9_-]+$/.test(search.after)
        ? search.after
        : undefined,
  };
}

export function ProjectListFilters({
  value,
  onChange,
}: {
  value: ProjectFilters;
  onChange: (value: ProjectFilters) => void;
}) {
  const [query, setQuery] = useState(value.query ?? "");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onChange({
          ...value,
          query: query.trim() || undefined,
          after: undefined,
        });
      }}
    >
      <FieldGroup className="flex-row flex-wrap items-end gap-2">
        <Field className="min-w-40 flex-1">
          <FieldLabel htmlFor="project-query">Search by whole words</FieldLabel>
          <Input
            id="project-query"
            maxLength={200}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </Field>
        <Button type="submit" variant="outline">
          Search
        </Button>
        {value.query && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setQuery("");
              onChange({ ...value, query: undefined, after: undefined });
            }}
          >
            Clear
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button type="button" variant="ghost" />}
          >
            Sort:{" "}
            {value.sort === "createdAt"
              ? "Created"
              : value.sort === "updatedAt"
                ? "Updated"
                : "Title"}
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuGroup>
              <DropdownMenuRadioGroup
                value={value.sort ?? "title"}
                onValueChange={(next) => {
                  const sort = PROJECT_SORTS.find((sort) => sort === next);
                  if (sort) onChange({ ...value, sort, after: undefined });
                }}
              >
                {PROJECT_SORTS.map((sort) => (
                  <DropdownMenuRadioItem key={sort} value={sort}>
                    {sort === "createdAt"
                      ? "Created"
                      : sort === "updatedAt"
                        ? "Updated"
                        : "Title"}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          type="button"
          variant="ghost"
          onClick={() =>
            onChange({
              ...value,
              order: value.order === "desc" ? "asc" : "desc",
              after: undefined,
            })
          }
        >
          {value.order === "desc" ? "Descending" : "Ascending"}
        </Button>
      </FieldGroup>
    </form>
  );
}

export function ProjectEmpty({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <RiBox3Line />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

/** One acknowledged metadata form for creation and last-write-wins edits. */
export function ProjectForm({
  title,
  initial,
  onClose,
  save,
}: {
  title: string;
  initial?: { title: string; repositoryUrl: string | null };
  onClose: () => void;
  save: (
    input: { title: string; repositoryUrl: string },
    changed: { title: boolean; repositoryUrl: boolean },
  ) => Promise<void>;
}) {
  const [original] = useState(initial);
  const [name, setName] = useState(initial?.title ?? "");
  const [repositoryUrl, setRepositoryUrl] = useState(
    initial?.repositoryUrl ?? "",
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Set the project title and optional repository URL.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setPending(true);
            setError(undefined);
            try {
              await save(
                {
                  title: name.trim(),
                  repositoryUrl: repositoryUrl.trim(),
                },
                {
                  title: name.trim() !== original?.title,
                  repositoryUrl:
                    repositoryUrl.trim() !== (original?.repositoryUrl ?? ""),
                },
              );
              onClose();
            } catch (error) {
              setError(
                error instanceof Error
                  ? error.message
                  : "Unable to save the project.",
              );
            } finally {
              setPending(false);
            }
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="project-title">Title</FieldLabel>
              <Input
                id="project-title"
                required
                maxLength={200}
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={pending}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="project-repository">
                Repository URL
              </FieldLabel>
              <Input
                id="project-repository"
                type="url"
                maxLength={2048}
                value={repositoryUrl}
                onChange={(event) => setRepositoryUrl(event.target.value)}
                disabled={pending}
              />
            </Field>
            {error && <p role="alert">{error}</p>}
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !name.trim()}>
                {pending ? "Saving" : "Save"}
              </Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}
