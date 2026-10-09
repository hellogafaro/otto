import { useBlocker } from "@tanstack/react-router";
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
import { useState } from "react";
import {
  type CollectionField,
  type CollectionRecord,
  DocumentChoice,
} from "@/components/documents/document-data";
import { QueryState } from "@/components/query-state";
import { ApiError, read } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace";

export function CollectionManager({
  projectId,
  collection,
  disabled,
}: {
  projectId: string | null;
  collection?: CollectionRecord;
  disabled: boolean;
}) {
  const [open, setOpen] = useState<"create" | "edit" | null>(null);
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="ghost"
          disabled={disabled}
          onClick={() => setOpen("create")}
        >
          New collection
        </Button>
        {collection && (
          <Button
            variant="ghost"
            disabled={disabled}
            onClick={() => setOpen("edit")}
          >
            Manage collection
          </Button>
        )}
      </div>
      {open && (
        <CollectionDialog
          projectId={projectId}
          disabled={disabled}
          collection={open === "edit" ? collection : undefined}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}
function CollectionDialog({
  projectId,
  disabled,
  collection: initialCollection,
  onClose,
}: {
  projectId: string | null;
  collection?: CollectionRecord;
  disabled: boolean;
  onClose(): void;
}) {
  const { api, workspaceId, invalidate } = useWorkspace();
  const [collection] = useState(initialCollection);
  const [title, setTitle] = useState(collection?.title ?? "");
  const [fields, setFields] = useState<CollectionField[]>(
    collection?.fields ?? [],
  );
  const [view, setView] = useState<"table" | "list">(
    collection?.view ?? "table",
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const dirty =
    title !== (collection?.title ?? "") ||
    view !== (collection?.view ?? "table") ||
    JSON.stringify(fields) !== JSON.stringify(collection?.fields ?? []);
  useBlocker({
    shouldBlockFn: () =>
      pending || (dirty && !window.confirm("Discard Collection changes?")),
    enableBeforeUnload: pending || dirty,
  });
  async function write(archive?: boolean) {
    if (pending || disabled) return;
    if (
      archive === undefined &&
      (!title.trim() ||
        title.trim().length > 200 ||
        fields.some(
          (field) =>
            !field.title.trim() ||
            field.title.trim().length > 200 ||
            (field.options ?? []).length > 100 ||
            (field.options ?? []).some(
              (option) => !option.trim() || option.length > 200,
            ),
        ))
    ) {
      setError(
        new Error("Titles and choices must be between 1 and 200 characters."),
      );
      return;
    }
    setPending(true);
    setError(null);
    try {
      if (collection && archive !== undefined)
        await read(
          await api.collections[":id"].archive.$post({
            param: { workspaceId, id: collection.id },
            json: { editToken: collection.editToken, archived: archive },
          }),
        );
      else if (collection)
        await read(
          await api.collections[":id"].$patch({
            param: { workspaceId, id: collection.id },
            json: {
              title: title.trim(),
              fields,
              view,
              editToken: collection.editToken,
            },
          }),
        );
      else
        await read(
          await api.collections.$post({
            param: { workspaceId },
            json: {
              title: title.trim(),
              fields,
              projectId: projectId ?? undefined,
            },
          }),
        );
      await invalidate();
      onClose();
    } catch (error) {
      setError(
        error instanceof ApiError
          ? error
          : new Error(
              collection
                ? "Could not confirm this update. Reload the Collection before trying again."
                : "Could not confirm creation. Check Collections before trying again.",
            ),
      );
    } finally {
      setPending(false);
    }
  }
  function fieldAt(index: number, next: CollectionField) {
    setFields(fields.map((field, at) => (at === index ? next : field)));
  }
  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent
        showCloseButton={!pending}
        className="max-h-[85vh] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>
            {collection ? "Manage collection" : "New collection"}
          </DialogTitle>
          <DialogDescription>
            Existing field types and choices stay compatible with saved
            documents.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            write();
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="collection-title">Title</FieldLabel>
              <Input
                id="collection-title"
                value={title}
                maxLength={200}
                required
                disabled={pending || disabled}
                onChange={(event) => setTitle(event.target.value)}
              />
            </Field>
            {collection && (
              <DocumentChoice
                label="View"
                value={view}
                options={[
                  { id: "table", title: "Table" },
                  { id: "list", title: "List" },
                ]}
                onChange={(value) => setView(value as typeof view)}
                disabled={pending || disabled}
              />
            )}
            {fields.map((field, index) => {
              const existing = collection?.fields.some(
                (item) => item.id === field.id,
              );
              return (
                <FieldGroup key={field.id}>
                  <Field>
                    <FieldLabel htmlFor={`field-title-${field.id}`}>
                      Field title
                    </FieldLabel>
                    <Input
                      id={`field-title-${field.id}`}
                      value={field.title}
                      maxLength={200}
                      required
                      disabled={pending || disabled}
                      onChange={(event) =>
                        fieldAt(index, { ...field, title: event.target.value })
                      }
                    />
                  </Field>
                  <DocumentChoice
                    label="Field type"
                    value={field.type}
                    options={[
                      "text",
                      "number",
                      "date",
                      "checkbox",
                      "select",
                      "human",
                      "agent",
                      "document",
                    ].map((id) => ({ id, title: id }))}
                    onChange={(value) =>
                      fieldAt(index, {
                        ...field,
                        type: value as CollectionField["type"],
                        options: value === "select" ? [] : undefined,
                      })
                    }
                    disabled={pending || disabled || existing}
                  />
                  {field.type === "select" && (
                    <Field>
                      <FieldLabel htmlFor={`field-options-${field.id}`}>
                        Choices, one per line (maximum 100)
                      </FieldLabel>
                      <Textarea
                        id={`field-options-${field.id}`}
                        value={(field.options ?? []).join("\n")}
                        disabled={pending || disabled}
                        onChange={(event) =>
                          fieldAt(index, {
                            ...field,
                            options: event.target.value.split("\n"),
                          })
                        }
                      />
                    </Field>
                  )}
                  {!existing && (
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={pending || disabled}
                      onClick={() =>
                        setFields(fields.filter((item) => item.id !== field.id))
                      }
                    >
                      Remove field
                    </Button>
                  )}
                </FieldGroup>
              );
            })}
            <Button
              type="button"
              variant="outline"
              disabled={pending || disabled || fields.length >= 50}
              onClick={() =>
                setFields([
                  ...fields,
                  { id: crypto.randomUUID(), title: "", type: "text" },
                ])
              }
            >
              Add field
            </Button>
          </FieldGroup>
          <QueryState error={error} />
          <DialogFooter>
            {collection && (
              <Button
                type="button"
                variant="outline"
                disabled={
                  pending ||
                  disabled ||
                  title !== collection.title ||
                  view !== collection.view ||
                  JSON.stringify(fields) !== JSON.stringify(collection.fields)
                }
                onClick={() => write(!collection.archived)}
              >
                {collection.archived
                  ? "Restore collection"
                  : "Archive collection"}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending || disabled}>
              {pending ? "Saving" : "Save collection"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
