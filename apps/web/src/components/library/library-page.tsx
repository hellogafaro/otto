import { toast } from "sonner";
import {
  BotId,
  LIBRARY_LIST_SORTS,
  LIBRARY_LIST_TYPES,
  LIBRARY_MAX_FOLDER_DEPTH,
  LIBRARY_SYSTEM_FOLDER_IDS,
  type LibraryFile,
  type LibraryFolder,
  LibraryFolderId,
  type LibraryListSort,
  type LibraryListType,
  type LibraryListView,
  libraryFolderPath,
  type WorkParticipant,
  workParticipantKey,
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
  RiShapesLine,
  RiStackLine,
  RiUploadLine,
  RiUserLine,
} from "@remixicon/react";
import { useNavigate } from "@tanstack/react-router";
import { AsyncResult } from "effect/unstable/reactivity";
import { useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";

import { useCreateRequest } from "../../create-request-store";
import { useI18n } from "../../i18n";
import { usePageActions, type PageAction } from "../../page-actions-registry";
import { cn, randomUUID } from "../../lib/utils";
import { libraryEnvironment } from "../../state/library";
import { useAtomCommand } from "../../state/use-atom-command";
import { DetailsTabs } from "../details-aside";
import { type ListFilter, ListFilterBar, ListFilterMenu, ListSortMenu } from "../list-toolbar";
import { Button } from "../ui/button";
import { DataGrid } from "../ui/data-grid";
import { SkeletonCards } from "../ui/skeleton";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { WorkspacePageContainer, PageTitle } from "../workspace-page-container";
import { ParticipantAvatar, participantName } from "../work/work-participants";
import { NoMatches, WorkEmpty, WorkPage, withField } from "../work/work-pages";
import { LibraryItemMenu, LibraryNameDialog } from "./library-actions";
import { LibraryLightbox } from "./library-lightbox";
import { LibraryFileTile, LibraryFolderTile } from "./library-visuals";
import {
  encodeLibrarySearch,
  LIBRARY_TAB_TYPES,
  type LibrarySearch,
  type LibraryTab,
} from "./library.logic";
import {
  useLibraryData,
  useLibraryFile,
  useLibraryFolder,
  useLibraryPages,
  useLibraryUpload,
  type LibraryData,
} from "./use-library";

const shortDate = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

/** Each sort's natural order, the one a fresh list uses. */
const LIBRARY_SORT_ORDER: Record<LibraryListSort, "asc" | "desc"> = {
  updated: "desc",
  created: "desc",
  title: "asc",
};

/**
 * Otto: The Library, a simple Drive. All browses folders, with the path as
 * quiet 28px buttons at the top bar's left (Library › Chats › Launch crew); Documents, Images and Files list every file of
 * that type wherever it sits. Items are cards in the shared DataGrid: a 16:9
 * preview, then the title and who changed it when. The cards are a bounded
 * server list: Filter and Sort sit before New in the top bar and live in the
 * URL, and the grid loads the next page as the reader nears its end. New makes
 * a document or a folder or uploads files, and files dropped on the page upload
 * here too.
 */
export function LibraryPage({ search }: { readonly search: LibrarySearch }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const data = useLibraryData();
  const { environmentId, loaded, folders, participants } = data;
  const tab: LibraryTab = search.tab ?? "all";
  const opened = useLibraryFolder(environmentId, search.folder ?? null);
  const folder = opened.folder;
  // Otto: While the folder is read, its level loads alongside; an unknown folder shows the top.
  const folderId = folder?.id ?? (opened.loading ? opened.id : null);
  const sort = search.sort ?? "updated";

  const view: LibraryListView = {
    ...(tab === "all"
      ? {
          ...(folderId ? { folder: folderId } : {}),
          ...(search.type ? { type: search.type } : {}),
        }
      : { everywhere: true, type: [LIBRARY_TAB_TYPES[tab]] }),
    ...(search.creator ? { creator: search.creator } : {}),
    ...(search.sort ? { sort: search.sort } : {}),
    ...(search.order ? { order: search.order } : {}),
  };

  const list = useLibraryPages(environmentId, view);
  const items = list.items;
  const filtered = (tab === "all" && search.type !== undefined) || search.creator !== undefined;
  // Otto: The unfiltered top level tells whether the Library is empty; an empty tab or filter asks.
  const whole = tab === "all" && folderId === null && !filtered;
  const asks = !whole && folderId === null && list.status === "ready" && items.length === 0;
  const anything = useLibraryPages(asks ? environmentId : null, { limit: 1 });
  const path = libraryFolderPath(folders, folderId).toReversed();
  const { upload, uploading } = useLibraryUpload();
  const createFolder = useAtomCommand(libraryEnvironment.createFolder, { reportFailure: false });

  const createDocument = useAtomCommand(libraryEnvironment.createDocument, {
    reportFailure: false,
  });

  const [naming, setNaming] = useState(false);
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const canAddFiles = folderId === null || !LIBRARY_SYSTEM_FOLDER_IDS.has(folderId);

  const canAddFolder = canAddFiles && path.length < LIBRARY_MAX_FOLDER_DEPTH;

  const preview = useLibraryFile(environmentId, search.preview ?? null).file;

  const place: LibrarySearch = tab === "all" ? (folderId ? { folder: folderId } : {}) : { tab };

  const { folder: _folder, tab: _tab, preview: _preview, ...listSearch } = search;
  const here: LibrarySearch = { ...place, ...listSearch };

  const go = (next: LibrarySearch) =>
    void navigate({ to: "/library", search: encodeLibrarySearch(next) });

  const setView = (next: LibrarySearch) =>
    void navigate({ to: "/library", search: encodeLibrarySearch(next), replace: true });

  const typeLabels: Record<LibraryListType, { readonly label: string; readonly icon: ReactNode }> =
    {
      folder: { label: t("Folder"), icon: <RiFolderLine aria-hidden /> },
      document: { label: t("Document"), icon: <RiFileTextLine aria-hidden /> },
      image: { label: t("Image"), icon: <RiImageLine aria-hidden /> },
      file: { label: t("File"), icon: <RiFileLine aria-hidden /> },
    };

  const creators: readonly WorkParticipant[] = [
    ...participants.people,
    ...participants.bots.map(
      (bot): WorkParticipant => ({ kind: "bot", botId: BotId.make(bot.id) }),
    ),
  ];

  const filters: ListFilter[] = [
    ...(tab === "all"
      ? [
          {
            id: "type",
            label: t("Type"),
            icon: <RiShapesLine aria-hidden />,
            multiple: true,
            options: LIBRARY_LIST_TYPES.map((type) => ({ value: type, ...typeLabels[type] })),
            selected: search.type ?? [],
            ...((search.type?.length ?? 0) > 1
              ? { selectedLabel: t("{count} types", { count: search.type?.length ?? 0 }) }
              : {}),
            onChange: (selected: readonly string[]) =>
              setView(
                withField(
                  here,
                  "type",
                  selected.length > 0
                    ? LIBRARY_LIST_TYPES.filter((type) => selected.includes(type))
                    : undefined,
                ),
              ),
          },
        ]
      : []),
    {
      id: "creator",
      label: t("Created by"),
      icon: <RiUserLine aria-hidden />,
      multiple: false,
      options: creators.map((participant) => ({
        value: workParticipantKey(participant),
        label: participantName(participant, participants.allBots),
        icon: (
          <ParticipantAvatar
            participant={participant}
            bots={participants.allBots}
            className="size-4"
          />
        ),
      })),
      selected: search.creator ? [search.creator] : [],
      onChange: ([creator]) =>
        setView(
          withField(
            here,
            "creator",
            creators.map(workParticipantKey).find((candidate) => candidate === creator),
          ),
        ),
    },
  ];

  const sortLabels: Record<LibraryListSort, string> = {
    updated: t("Last updated"),
    created: t("Created"),
    title: t("Title"),
  };

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
      toast.error(t("Document couldn't be created"));
    }
  };

  useCreateRequest("document", environmentId !== null && canAddFiles, () => void newDocument());
  useCreateRequest("folder", environmentId !== null && canAddFolder, () => setNaming(true));

  // Otto: New opens the New menu in place, the way clicking it does.
  const pageActions = useMemo((): PageAction[] => {
    if (!environmentId) return [];

    return [
      {
        id: "new",
        title: t("New…"),
        icon: RiAddLine,
        searchTerms: ["new", "create", "add", "document", "folder"],
        shortcutCommand: "item.new",
        run: () => setNewMenuOpen(true),
      },
      {
        id: "upload",
        title: t("Upload files"),
        icon: RiUploadLine,
        searchTerms: ["upload", "add files", "import"],
        disabled: !canAddFiles,
        run: () => fileInput.current?.click(),
      },
    ];
  }, [canAddFiles, environmentId, t]);

  usePageActions(t("Library"), pageActions);

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);

    if (!environmentId || !canAddFiles) return;
    const dropped = [...event.dataTransfer.files];

    if (dropped.length > 0) void upload(environmentId, dropped, { folderId });
  };

  const empty =
    loaded &&
    (whole
      ? list.status === "ready" && items.length === 0
      : asks && anything.status === "ready" && anything.items.length === 0);

  const newMenu = environmentId ? (
    <Menu open={newMenuOpen} onOpenChange={setNewMenuOpen}>
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

  const listActions =
    items.length > 0 || filtered ? (
      <>
        <ListFilterMenu filters={filters} />
        <ListSortMenu
          sort={{
            options: LIBRARY_LIST_SORTS.map((value) => ({ value, label: sortLabels[value] })),
            value: sort,
            order: search.order ?? LIBRARY_SORT_ORDER[sort],
            onChange: (nextSort, order) =>
              setView({
                ...withField(here, "sort", nextSort === "updated" ? undefined : nextSort),
                ...(order === LIBRARY_SORT_ORDER[nextSort] ? {} : { order }),
              }),
          }}
        />
      </>
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
    <WorkPage
      leading={folderPath}
      actions={
        empty ? null : (
          <>
            {listActions}
            {newMenu}
          </>
        )
      }
    >
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
            <PageTitle>{folder?.title ?? t("Library")}</PageTitle>
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
            <ListFilterBar
              filters={filters}
              onClear={() =>
                setView({
                  ...place,
                  ...(search.sort === undefined ? {} : { sort: search.sort }),
                  ...(search.order === undefined ? {} : { order: search.order }),
                })
              }
            />
          </div>
          {!loaded || (list.status === "loading" && items.length === 0) ? (
            <SkeletonCards label={t("Loading files…")} />
          ) : list.status === "error" && items.length === 0 ? (
            <p className="text-13px text-muted-foreground">
              {t("The Library couldn't be loaded.")}
            </p>
          ) : items.length === 0 && filtered ? (
            <NoMatches to="/library" search={encodeLibrarySearch(place)} />
          ) : items.length === 0 ? (
            <p className="text-13px text-muted-foreground">
              {tab === "all" ? t("This folder is empty.") : t("Nothing here yet.")}
            </p>
          ) : (
            <DataGrid
              items={items}
              paging={{
                hasMore: list.hasMore,
                loading: list.status !== "ready",
                onLoadMore: list.loadMore,
              }}
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
                if (!AsyncResult.isSuccess(result)) toast.error(t("Folder couldn't be created"));
              })
            }
          />
          <LibraryLightbox
            environmentId={environmentId}
            data={data}
            file={preview}
            siblings={items.flatMap((item) =>
              item.kind === "file" && item.file.type !== "document" ? [item.file] : [],
            )}
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
        <span className="flex min-w-0 flex-col gap-0.5 pe-10">
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
