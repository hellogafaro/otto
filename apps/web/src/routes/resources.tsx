import { RiAddLine, RiBookShelfLine, RiSearchLine } from "@remixicon/react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import { useRef, useState } from "react";
import { useCommandPalette } from "@/components/command-palette";
import { EmptyPage } from "@/components/empty-page";
import { IconAction } from "@/components/icon-action";
import { Page } from "@/components/page";
import { ResourceGallery, resourceKindOf } from "@/components/resources";
import { type Resource, resources as savedResources } from "@/mock/tasks";

// The open resource lives in the URL, so a lightbox can be linked to.
export type ResourcesSearch = { open?: string };

export function validateResourcesSearch(
  search: Record<string, unknown>,
): ResourcesSearch {
  return { open: typeof search.open === "string" ? search.open : undefined };
}

// Every saved file and result, latest first, as a gallery with a lightbox.
// "New resource" opens the file picker; picked files join at once (local
// only until file storage exists).
export function ResourcesPage({ search }: { search: ResourcesSearch }) {
  const navigate = useNavigate({ from: "/resources" });
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
        icon={RiBookShelfLine}
        title="No resources"
        description="Files and results saved from runs and tasks collect here."
      >
        <Button size="sm" onClick={() => picker.current?.click()}>
          <RiAddLine data-icon="inline-start" />
          New resource
        </Button>
        {input}
      </EmptyPage>
    );
  }

  return (
    <Page
      title="Resources"
      width="wide"
      actions={
        <>
          <IconAction
            label="Search"
            icon={RiSearchLine}
            onClick={() => openPalette("resources")}
          />
          <IconAction
            label="New resource"
            icon={RiAddLine}
            onClick={() => picker.current?.click()}
          />
          {input}
        </>
      }
    >
      <ResourceGallery
        resources={resources}
        openId={search.open}
        onOpen={(id) =>
          navigate({ search: id ? { open: id } : {}, replace: true })
        }
      />
    </Page>
  );
}
