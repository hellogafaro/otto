import type { LibraryFile, ProjectId } from "@otto/contracts";
import { RiBookShelfLine, RiUploadLine } from "@remixicon/react";
import { useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";

import { useI18n } from "../../i18n";
import { LibraryLightbox } from "../library/LibraryLightbox";
import { LibraryCard, type LibraryCardItem } from "../library/LibraryPage";
import { sortLibraryItems } from "../library/library.logic";
import { useLibraryData, useLibraryUpload } from "../library/useLibrary";
import { Button } from "../ui/button";
import { DataGrid } from "../ui/data-grid";
import { Empty, EmptyDescription, EmptyMedia } from "../ui/empty";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/** Uploads files into the project's Library folder, made on first use: a quiet 28px top-bar icon. */
export function ProjectUpload({ projectId }: { readonly projectId: ProjectId }) {
  const { t } = useI18n();
  const { environmentId } = useLibraryData();
  const { upload, uploading } = useLibraryUpload();
  const input = useRef<HTMLInputElement>(null);

  const picker = (
    <input
      ref={input}
      type="file"
      multiple
      hidden
      onChange={(event) => {
        const chosen = [...(event.currentTarget.files ?? [])];
        event.currentTarget.value = "";

        if (environmentId && chosen.length > 0) {
          void upload(environmentId, chosen, { folderId: null, projectId });
        }
      }}
    />
  );

  return (
    <>
      {picker}
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="icon"
              variant="ghost-muted"
              aria-label={t("Upload files")}
              disabled={uploading}
              onClick={() => input.current?.click()}
            >
              <RiUploadLine aria-hidden className="size-4" />
            </Button>
          }
        />
        <TooltipPopup side="bottom">{t("Upload files")}</TooltipPopup>
      </Tooltip>
    </>
  );
}

/**
 * Otto: A project's Library tab: its own Library folder as the Library's cards. It holds the
 * folders of the project's chats, its tasks' comment files and anything uploaded here; a
 * folder opens in the Library. With nothing yet, the tab is an empty state; the top bar uploads.
 */
export function ProjectLibrary({ projectId }: { readonly projectId: ProjectId }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const data = useLibraryData();
  const folder = data.folders.find((candidate) => candidate.projectId === projectId);

  const shown = folder
    ? sortLibraryItems(
        data.folders.filter((candidate) => candidate.parentId === folder.id),
        data.files.filter((file) => file.folderId === folder.id),
      )
    : { folders: [], files: [] };

  const items: LibraryCardItem[] = [
    ...shown.folders.map((item) => ({ kind: "folder" as const, folder: item })),
    ...shown.files.map((item) => ({ kind: "file" as const, file: item })),
  ];

  const [preview, setPreview] = useState<LibraryFile | null>(null);
  const environmentId = data.environmentId;

  if (items.length === 0 || !environmentId) {
    return (
      <Empty>
        <EmptyMedia variant="icon">
          <RiBookShelfLine />
        </EmptyMedia>
        <EmptyDescription>
          {t("No files yet. What this project's chats and tasks save lands here.")}
        </EmptyDescription>
      </Empty>
    );
  }

  const open = (item: LibraryCardItem) => {
    if (item.kind === "folder") {
      return void navigate({ to: "/library", search: { folder: item.folder.id } });
    }

    if (item.file.type === "document") {
      return void navigate({ to: "/library/$fileId", params: { fileId: item.file.id } });
    }

    setPreview(item.file);
  };

  return (
    <>
      <DataGrid
        items={items}
        getItemKey={(item) =>
          item.kind === "folder" ? `folder:${item.folder.id}` : `file:${item.file.id}`
        }
        renderItem={(item) => (
          <LibraryCard
            environmentId={environmentId}
            data={data}
            item={item}
            onOpen={() => open(item)}
          />
        )}
      />
      <LibraryLightbox
        environmentId={environmentId}
        data={data}
        file={preview ? (data.files.find((file) => file.id === preview.id) ?? null) : null}
        siblings={shown.files.filter((file) => file.type !== "document")}
        onSelect={setPreview}
        onClose={() => setPreview(null)}
      />
    </>
  );
}
