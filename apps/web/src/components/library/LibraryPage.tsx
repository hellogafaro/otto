import {
  LIBRARY_MAX_FOLDER_DEPTH,
  LIBRARY_SYSTEM_FOLDER_IDS,
  type LibraryFile,
  type LibraryFolder,
  LibraryFolderId,
  libraryFolderPath,
} from "@otto/contracts";
import {
  RiAddLine,
  RiArrowRightSLine,
  RiBookShelfLine,
  RiFolderLine,
  RiFileLine,
  RiFileTextLine,
  RiFolderAddLine,
  RiImageLine,
  RiLockLine,
  RiStackLine,
  RiUploadLine,
} from "@remixicon/react";
import { useNavigate } from "@tanstack/react-router";
import { AsyncResult } from "effect/unstable/reactivity";
import { useRef, useState, type DragEvent } from "react";

import { useI18n } from "../../i18n";
import { cn, randomUUID } from "../../lib/utils";
import { libraryEnvironment } from "../../state/library";
import { useAtomCommand } from "../../state/use-atom-command";
import { DetailsTabs } from "../DetailsAside";
import { Button } from "../ui/button";
import { DataGrid } from "../ui/data-grid";
import { SkeletonCards } from "../ui/skeleton";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { WorkspacePageContainer, WorkspacePageTitle } from "../WorkspacePageContainer";
import { participantName } from "../work/WorkParticipants";
import { WorkEmpty, WorkPage } from "../work/WorkPages";
import { LibraryItemMenu, LibraryNameDialog } from "./LibraryActions";
import { LibraryLightbox } from "./LibraryLightbox";
import { LibraryFileTile, LibraryFolderTile } from "./LibraryVisuals";
import {
  type LibrarySearch,
  type LibraryTab,
  matchesLibraryTab,
  sortLibraryItems,
} from "./library.logic";
import {
  useLibraryData,
  useLibraryFailure,
  useLibraryUpload,
  type LibraryData,
} from "./useLibrary";

const shortDate = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

/**
 * Otto: The Library, a simple Drive. All browses folders, with the path as
 * quiet 28px buttons at the top bar's left (Library › Chats › Launch crew); Documents, Images and Files list every file of
 * that type wherever it sits. Items are cards in the shared DataGrid: a 16:9
 * preview, then the title and who changed it when. New makes a document or a
 * folder or uploads files, and files dropped on the page upload here too.
 */
export function LibraryPage({ search }: { readonly search: LibrarySearch }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const data = useLibraryData();
  const { environmentId, loaded, folders, files } = data;
  const tab: LibraryTab = search.tab ?? "all";
  const folder = folders.find((candidate) => candidate.id === search.folder) ?? null;
  const folderId = folder?.id ?? null;
  const path = libraryFolderPath(folders, folderId).toReversed();
  const { upload, uploading } = useLibraryUpload();
  const fail = useLibraryFailure();
  const createFolder = useAtomCommand(libraryEnvironment.createFolder, { reportFailure: false });

  const createDocument = useAtomCommand(libraryEnvironment.createDocument, {
    reportFailure: false,
  });

  const [naming, setNaming] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const canAddFiles = folderId === null || !LIBRARY_SYSTEM_FOLDER_IDS.has(folderId);

  const canAddFolder = canAddFiles && path.length < LIBRARY_MAX_FOLDER_DEPTH;

  const { folders: shownFolders, files: shownFiles } =
    tab === "all"
      ? sortLibraryItems(
          folders.filter((candidate) => candidate.parentId === folderId),
          files.filter((file) => file.folderId === folderId),
        )
      : sortLibraryItems(
          [],
          files.filter((file) => matchesLibraryTab(file, tab)),
        );

  const preview = files.find((file) => file.id === search.preview) ?? null;

  const here: LibrarySearch = tab === "all" ? (folderId ? { folder: folderId } : {}) : { tab };

  const go = (search: LibrarySearch) => void navigate({ to: "/library", search });

  const openFile = (file: LibraryFile) =>
    file.type === "document"
      ? void navigate({ to: "/library/$fileId", params: { fileId: file.id } })
      : go({ ...here, preview: file.id });

  const newDocument = async () => {
    if (!environmentId) return;

    const result = await createDocument({
      environmentId,
      input: { folderId },
    });

    if (AsyncResult.isSuccess(result)) {
      void navigate({ to: "/library/$fileId", params: { fileId: result.value.fileId } });
    } else {
      fail(result, t("Could not create the document"));
    }
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);

    if (!environmentId || !canAddFiles) return;
    const dropped = [...event.dataTransfer.files];

    if (dropped.length > 0) void upload(environmentId, dropped, { folderId });
  };

  const empty = loaded && folders.length === 0 && files.length === 0;

  const newMenu = environmentId ? (
    <Menu>
      {empty ? (
        <MenuTrigger
          render={
            <Button>
              <RiAddLine />
              {t("New")}
            </Button>
          }
        />
      ) : (
        <Tooltip>
          <TooltipTrigger
            render={
              <MenuTrigger
                render={
                  <Button
                    size="icon-sm"
                    variant="ghost-muted"
                    aria-label={t("New")}
                    disabled={uploading}
                  >
                    <RiAddLine aria-hidden className="size-4" />
                  </Button>
                }
              />
            }
          />
          <TooltipPopup side="bottom">{t("New")}</TooltipPopup>
        </Tooltip>
      )}
      <MenuPopup align="end" className="min-w-44">
        <MenuItem disabled={!canAddFiles} onClick={() => void newDocument()}>
          <RiFileTextLine />
          {t("New document")}
        </MenuItem>
        <MenuItem disabled={!canAddFolder} onClick={() => setNaming(true)}>
          <RiFolderAddLine />
          {t("New folder")}
        </MenuItem>
        <MenuItem disabled={!canAddFiles} onClick={() => fileInput.current?.click()}>
          <RiUploadLine />
          {t("Upload files")}
        </MenuItem>
      </MenuPopup>
    </Menu>
  ) : null;

  const tabs = [
    { value: "all" as const, label: t("All"), icon: RiStackLine },
    { value: "documents" as const, label: t("Documents"), icon: RiFileTextLine },
    { value: "images" as const, label: t("Images"), icon: RiImageLine },
    { value: "files" as const, label: t("Files"), icon: RiFileLine },
  ];

  const folderPath =
    tab === "all" && path.length > 0 ? (
      <nav aria-label={t("Folder path")} className="flex min-w-0 items-center">
        <Button
          variant="ghost-muted"
          size="crumb"
          className="shrink-0"
          onClick={() => void navigate({ to: "/library" })}
        >
          <RiBookShelfLine aria-hidden className="size-4" />
          {t("Library")}
        </Button>
        {path.map((ancestor) => (
          <span key={ancestor.id} className="flex min-w-0 items-center">
            <RiArrowRightSLine aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            {ancestor.id === folderId ? (
              <span
                aria-current="page"
                className="flex h-7 min-w-0 items-center gap-1 px-1.5 text-13px font-medium text-foreground"
              >
                <RiFolderLine aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{ancestor.title}</span>
              </span>
            ) : (
              <Button
                variant="ghost-muted"
                size="crumb"
                className="min-w-0"
                onClick={() => void navigate({ to: "/library", search: { folder: ancestor.id } })}
              >
                <RiFolderLine aria-hidden className="size-4" />
                <span className="truncate">{ancestor.title}</span>
              </Button>
            )}
          </span>
        ))}
      </nav>
    ) : null;

  return (
    <WorkPage leading={folderPath} actions={empty ? null : newMenu}>
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          const chosen = [...(event.currentTarget.files ?? [])];
          event.currentTarget.value = "";

          if (environmentId && chosen.length > 0) void upload(environmentId, chosen, { folderId });
        }}
      />
      {empty ? (
        <WorkEmpty
          icon={<RiBookShelfLine />}
          title={t("No files")}
          description={t("Keep documents, images and files your team and bots make in one place.")}
          action={newMenu}
        />
      ) : (
        <WorkspacePageContainer
          className={cn(
            "min-h-full gap-6 pt-3 pb-16 sm:pt-4",
            dragging && "rounded-lg ring-2 ring-ring ring-inset",
          )}
          onDragOver={(event) => {
            if (!event.dataTransfer.types.includes("Files")) return;
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={(event) => {
            if (event.currentTarget === event.target) setDragging(false);
          }}
          onDrop={onDrop}
        >
          <div className="flex flex-col gap-3">
            <WorkspacePageTitle>{folder?.title ?? t("Library")}</WorkspacePageTitle>
            <div className="mt-2 mb-2">
              <DetailsTabs
                label={t("Library tabs")}
                size="page"
                tabs={tabs}
                value={tab}
                onValueChange={(value) =>
                  go(value === "all" ? (folderId ? { folder: folderId } : {}) : { tab: value })
                }
              />
            </div>
          </div>
          {!loaded ? (
            <SkeletonCards label={t("Loading files…")} />
          ) : shownFolders.length === 0 && shownFiles.length === 0 ? (
            <p className="px-4 text-13px text-muted-foreground">
              {tab === "all" ? t("This folder is empty.") : t("Nothing here yet.")}
            </p>
          ) : (
            <DataGrid
              items={[
                ...shownFolders.map((item) => ({ kind: "folder" as const, folder: item })),
                ...shownFiles.map((item) => ({ kind: "file" as const, file: item })),
              ]}
              getItemKey={(item) =>
                item.kind === "folder" ? `folder:${item.folder.id}` : `file:${item.file.id}`
              }
              renderItem={(item) =>
                environmentId ? (
                  <LibraryCard
                    environmentId={environmentId}
                    data={data}
                    item={item}
                    onOpen={() =>
                      item.kind === "folder" ? go({ folder: item.folder.id }) : openFile(item.file)
                    }
                  />
                ) : null
              }
            />
          )}
        </WorkspacePageContainer>
      )}
      {environmentId ? (
        <>
          <LibraryNameDialog
            open={naming}
            onOpenChange={setNaming}
            heading={t("New folder")}
            label={t("Folder name")}
            initialValue={t("Untitled folder")}
            submitLabel={t("Create folder")}
            onSubmit={(title) =>
              void createFolder({
                environmentId,
                input: { folderId: LibraryFolderId.make(randomUUID()), parentId: folderId, title },
              }).then((result) => {
                if (!AsyncResult.isSuccess(result)) fail(result, t("Could not create the folder"));
              })
            }
          />
          <LibraryLightbox
            environmentId={environmentId}
            data={data}
            file={preview}
            siblings={shownFiles.filter((file) => file.type !== "document")}
            onSelect={(file) => go({ ...here, preview: file.id })}
            onClose={() => go(here)}
          />
        </>
      ) : null}
    </WorkPage>
  );
}

export type LibraryCardItem =
  | { readonly kind: "folder"; readonly folder: LibraryFolder }
  | { readonly kind: "file"; readonly file: LibraryFile };

/** A Library item as a DataGrid card: a 16:9 preview, then its title and who changed it when. */
export function LibraryCard({
  environmentId,
  data,
  item,
  onOpen,
}: {
  readonly environmentId: NonNullable<LibraryData["environmentId"]>;
  readonly data: LibraryData;
  readonly item: LibraryCardItem;
  readonly onOpen: () => void;
}) {
  const { t } = useI18n();
  const entry = item.kind === "folder" ? item.folder : item.file;
  const changedBy = participantName(entry.updatedBy, data.participants.allBots);

  return (
    <div className="group relative flex flex-col gap-2.5">
      <button
        type="button"
        onClick={onOpen}
        aria-label={entry.title}
        className="flex flex-col gap-2.5 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="overflow-hidden rounded-lg border border-border transition-shadow group-hover:shadow-md">
          {item.kind === "folder" ? (
            <LibraryFolderTile />
          ) : (
            <LibraryFileTile environmentId={environmentId} file={item.file} />
          )}
        </div>
        <span className="flex min-w-0 flex-col gap-0.5 ps-4 pe-10">
          <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-foreground">
            <span className="truncate">{entry.title}</span>
            {entry.visibility === "user" ? (
              <RiLockLine
                aria-label={t("Only me")}
                className="size-3.5 shrink-0 text-muted-foreground"
              />
            ) : null}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {t("{name} · {date}", {
              name: changedBy,
              date: shortDate.format(new Date(entry.updatedAt)),
            })}
          </span>
        </span>
      </button>
      <div className="absolute right-2 bottom-1.5">
        <LibraryItemMenu
          environmentId={environmentId}
          data={data}
          target={
            item.kind === "folder"
              ? { kind: "folder", folder: item.folder }
              : { kind: "file", file: item.file }
          }
          revealInGroup
        />
      </div>
    </div>
  );
}
