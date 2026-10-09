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
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty";
import { Field, FieldGroup, FieldLabel } from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import { useRef, useState } from "react";

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
  creation,
  checkProjects,
}: {
  title: string;
  initial?: { title: string; repositoryUrl: string | null };
  onClose: () => void;
  save: (
    input: { title: string; repositoryUrl: string },
    changed: { title: boolean; repositoryUrl: boolean },
  ) => Promise<void>;
  creation?: "saved" | "uncertain";
  checkProjects?: (title: string) => Promise<void>;
}) {
  const [original] = useState(initial);
  const [name, setName] = useState(initial?.title ?? "");
  const [repositoryUrl, setRepositoryUrl] = useState(
    initial?.repositoryUrl ?? "",
  );
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
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
            if (inFlight.current || creation === "uncertain") return;
            inFlight.current = true;
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
              inFlight.current = false;
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
                disabled={pending || Boolean(creation)}
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
                disabled={pending || Boolean(creation)}
              />
            </Field>
            {error && <p role="alert">{error}</p>}
            {creation === "uncertain" && (
              <p role="alert">
                The project may have been saved. Check projects before starting
                another one.
              </p>
            )}
            {creation === "saved" && <p>Project saved. Open it to continue.</p>}
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={onClose}
              >
                {creation ? "Close" : "Cancel"}
              </Button>
              {creation === "uncertain" && checkProjects && (
                <Button
                  type="button"
                  disabled={pending}
                  onClick={async () => {
                    if (inFlight.current) return;
                    inFlight.current = true;
                    setPending(true);
                    setError(undefined);
                    try {
                      await checkProjects(name.trim());
                    } catch (error) {
                      setError(
                        error instanceof Error
                          ? error.message
                          : "Unable to load projects.",
                      );
                    } finally {
                      inFlight.current = false;
                      setPending(false);
                    }
                  }}
                >
                  {pending ? "Checking" : "Check projects"}
                </Button>
              )}
              <Button
                type="submit"
                disabled={pending || !name.trim() || creation === "uncertain"}
              >
                {pending
                  ? "Saving"
                  : creation === "saved"
                    ? "Open project"
                    : "Save"}
              </Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}
