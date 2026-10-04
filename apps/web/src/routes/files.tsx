import { RiAddLine, RiFolder3Line, RiSearchLine } from "@remixicon/react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import { useRef, useState } from "react";
import { useCommandPalette } from "@/components/command-palette";
import { EmptyPage } from "@/components/empty-page";
import { FileGallery } from "@/components/files";
import { IconAction } from "@/components/icon-action";
import { Page } from "@/components/page";
import { resourceKindOf } from "@/components/task-meta";
import { type Resource, resources as savedResources } from "@/mock/tasks";

// The open resource lives in the URL, so a lightbox can be linked to.
export type FilesSearch = { open?: string };

export function validateFilesSearch(
  search: Record<string, unknown>,
): FilesSearch {
  return { open: typeof search.open === "string" ? search.open : undefined };
}

// Every saved file and result, latest first, as a gallery with a lightbox.
// "New file" opens the file picker; picked files join at once (local
// only until file storage exists).
export function FilesPage({ search }: { search: FilesSearch }) {
  const navigate = useNavigate({ from: "/files" });
  const openPalette = useCommandPalette();
  const [resources, setResources] = useState<Resource[]>(savedResources);
  const picker = useRef<HTMLInputElement>(null);

  const add = (files: FileList) =>
    setResources((current) => [
      ...[...files].map((file) => {
        // Shown read-only in the viewer; an image also fills its tile.
        const url = URL.createObjectURL(file);
        return {
          id: crypto.randomUUID(),
          title: file.name,
          kind: resourceKindOf(file.type),
          url,
          preview: file.type.startsWith("image/") ? url : undefined,
          createdAt: new Date().toISOString(),
        };
      }),
      ...current,
    ]);

  const input = (
    <input
      ref={picker}
      type="file"
      multiple
      hidden
      onChange={(event) => {
        if (event.target.files) add(event.target.files);
        event.target.value = "";
      }}
    />
  );

  if (resources.length === 0) {
    return (
      <EmptyPage
        icon={RiFolder3Line}
        title="No files"
        description="Files and results saved from runs and tasks collect here."
      >
        <Button size="sm" onClick={() => picker.current?.click()}>
          <RiAddLine data-icon="inline-start" />
          New file
        </Button>
        {input}
      </EmptyPage>
    );
  }

  return (
    <Page
      title="Files"
      width="wide"
      actions={
        <>
          <IconAction
            label="Search"
            icon={RiSearchLine}
            onClick={() => openPalette("files")}
          />
          <IconAction
            label="New file"
            icon={RiAddLine}
            onClick={() => picker.current?.click()}
          />
          {input}
        </>
      }
    >
      <FileGallery
        resources={resources}
        openId={search.open}
        onOpen={(id) =>
          navigate({ search: id ? { open: id } : {}, replace: true })
        }
      />
    </Page>
  );
}
