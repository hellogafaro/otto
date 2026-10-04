import {
  RiAddLine,
  RiBox3Line,
  RiFileLine,
  RiFolder3Fill,
  RiFolder3Line,
  RiFolderAddLine,
  RiPriceTag3Line,
  RiQuillPenLine,
  RiSearchLine,
  RiUploadLine,
} from "@remixicon/react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@workspace/ui/components/breadcrumb";
import { Button } from "@workspace/ui/components/button";
import { ContextMenuContent } from "@workspace/ui/components/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { useReducer, useRef, useState } from "react";
import { useCommandPalette } from "@/components/command-palette";
import { EmptyPage } from "@/components/empty-page";
import { FileGallery } from "@/components/files";
import {
  FilterBar,
  type FilterDef,
  FilterMenu,
  labelLooks,
  NoResults,
} from "@/components/filters";
import { useAskAgent } from "@/components/floating-chat";
import { GalleryItem } from "@/components/gallery";
import { IconAction } from "@/components/icon-action";
import { ItemMenuItems } from "@/components/item-menu";
import { Page } from "@/components/page";
import {
  chatWithLooks,
  ownerLooks,
  projectLooks,
  resourceIcons,
  resourceKindOf,
  resourceTypes,
} from "@/components/task-meta";
import { Topbar } from "@/components/topbar";
import {
  currentUserId,
  type Folder,
  folders,
  type Resource,
  type ResourceKind,
  resources,
} from "@/mock/tasks";

// Where you are in Files lives in the URL: the open folder (none is the top),
// the filters, and the open file, so a viewer can be linked to.
export type FilesSearch = {
  folder?: string;
  type?: ResourceKind;
  project?: string;
  label?: string;
  madeBy?: string;
  open?: string;
};

type FilterKey = "type" | "project" | "label" | "madeBy";

export function validateFilesSearch(
  search: Record<string, unknown>,
): FilesSearch {
  const text = (key: string) =>
    typeof search[key] === "string" ? (search[key] as string) : undefined;
  const folder = text("folder");
  const type = text("type");
  return {
    folder: folders.some(({ id }) => id === folder) ? folder : undefined,
    type: type && type in resourceTypes ? (type as ResourceKind) : undefined,
    project: text("project"),
    label: text("label"),
    madeBy: text("madeBy"),
    open: text("open"),
  };
}

// Who made a file: the agent that made it, else the person who keeps it.
const makerOf = (file: Resource) =>
  file.agentId ?? file.ownerId ?? currentUserId;

// The folder and every folder inside it, to any depth.
function subtree(folderId: string | undefined): (string | undefined)[] {
  return [
    folderId,
    ...folders
      .filter(({ parentId }) => parentId === folderId)
      .flatMap(({ id }) => subtree(id)),
  ];
}

// A folder and the folders above it, top first.
function pathOf(folderId: string | undefined): Folder[] {
  const folder = folders.find(({ id }) => id === folderId);
  return folder ? [...pathOf(folder.parentId), folder] : [];
}

function filtersOf(): FilterDef<FilterKey>[] {
  return [
    {
      key: "type",
      label: "Type",
      icon: RiFileLine,
      options: Object.fromEntries(
        (Object.keys(resourceTypes) as ResourceKind[]).map((kind) => [
          kind,
          { label: resourceTypes[kind], icon: resourceIcons[kind] },
        ]),
      ),
    },
    {
      key: "project",
      label: "Project",
      icon: RiBox3Line,
      options: projectLooks,
    },
    {
      key: "label",
      label: "Label",
      icon: RiPriceTag3Line,
      options: labelLooks(resources.flatMap(({ labels = [] }) => labels)),
    },
    {
      key: "madeBy",
      label: "Made by",
      icon: RiQuillPenLine,
      people: true,
      options: {
        me: { ...ownerLooks[currentUserId], label: "Me" },
        ...chatWithLooks,
      },
    },
  ];
}

// Files like a drive: folders, nested to any depth, then files, in one
// gallery; the top bar's breadcrumb is the way back up. Filters (type,
// project, label, made by) search everything in the open folder and the
// folders inside it, as one flat list. + uploads files or makes a folder
// here; new files land in the open folder (local only until file storage
// exists).
export function FilesPage({ search }: { search: FilesSearch }) {
  const navigate = useNavigate({ from: "/files" });
  const openPalette = useCommandPalette();
  // Adding changes the mock in memory; this redraws.
  const [, redraw] = useReducer((count: number) => count + 1, 0);
  const [naming, setNaming] = useState(false);
  // The folder being renamed in place, if any.
  const [renaming, setRenaming] = useState<string>();
  const picker = useRef<HTMLInputElement>(null);
  const filters = filtersOf();
  const filtered = filters.some(({ key }) => search[key]);
  const path = pathOf(search.folder);
  const folder = path.at(-1);

  const matches = (file: Resource) =>
    (!search.type || file.kind === search.type) &&
    (!search.project || file.projectId === search.project) &&
    (!search.label || (file.labels?.includes(search.label) ?? false)) &&
    (!search.madeBy ||
      makerOf(file) ===
        (search.madeBy === "me" ? currentUserId : search.madeBy));
  const inside = subtree(search.folder);
  const shown = filtered
    ? resources.filter(
        (file) => inside.includes(file.folderId) && matches(file),
      )
    : resources.filter((file) => file.folderId === search.folder);
  const subfolders = filtered
    ? []
    : folders.filter(({ parentId }) => parentId === search.folder);

  const change = (key: FilterKey, value: string | undefined) =>
    navigate({ search: (prev) => ({ ...prev, [key]: value }) });
  const clear = () => navigate({ search: { folder: search.folder } });

  const add = (files: FileList) => {
    resources.unshift(
      ...[...files].map((file): Resource => {
        // Shown read-only in the viewer; an image also fills its tile.
        const url = URL.createObjectURL(file);
        return {
          id: crypto.randomUUID(),
          title: file.name,
          kind: resourceKindOf(file.type),
          url,
          preview: file.type.startsWith("image/") ? url : undefined,
          folderId: search.folder,
          createdAt: new Date().toISOString(),
        };
      }),
    );
    redraw();
  };
  const renameFolder = (id: string, title: string) => {
    setRenaming(undefined);
    const target = folders.find((candidate) => candidate.id === id);
    if (target && title.trim()) target.title = title.trim();
  };
  // Mock only: a folder goes with everything inside it.
  const deleteFolder = (id: string) => {
    const gone = subtree(id);
    for (let i = folders.length - 1; i >= 0; i--)
      if (gone.includes(folders[i].id)) folders.splice(i, 1);
    for (let i = resources.length - 1; i >= 0; i--)
      if (gone.includes(resources[i].folderId)) resources.splice(i, 1);
    redraw();
  };
  const deleteFile = (id: string) => {
    resources.splice(
      resources.findIndex((file) => file.id === id),
      1,
    );
    redraw();
  };
  const createFolder = (title: string) => {
    setNaming(false);
    if (!title.trim()) return;
    folders.push({
      id: crypto.randomUUID(),
      title: title.trim(),
      parentId: search.folder,
    });
  };

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

  if (resources.length === 0 && folders.length === 0) {
    return (
      <EmptyPage
        icon={RiFolder3Line}
        title="No files"
        description="Files you upload and agents make collect here."
        ask={{
          about: "your files",
          action: "New file",
          start: "Make a file with ",
        }}
      >
        {/* Uploading is a person's own action, beside asking for one. */}
        <Button
          size="sm"
          variant="outline"
          onClick={() => picker.current?.click()}
        >
          Upload file
        </Button>
        {input}
      </EmptyPage>
    );
  }

  const empty = shown.length === 0 && subfolders.length === 0 && !naming;
  return (
    <>
      {folder && (
        // Inside a folder, the path is a breadcrumb: each step goes back up.
        <Topbar>
          <Breadcrumb>
            <BreadcrumbList>
              {[undefined, ...path.slice(0, -1)].map((step) => (
                <FolderCrumb key={step?.id ?? "top"} folder={step} />
              ))}
              <BreadcrumbItem>
                <Button variant="ghost" size="sm" aria-current="page">
                  <RiFolder3Line data-icon="inline-start" />
                  <span className="truncate">{folder.title}</span>
                </Button>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </Topbar>
      )}
      <Page
        title={folder?.title ?? "Files"}
        width="wide"
        actions={
          <>
            <FilterMenu filters={filters} values={search} onChange={change} />
            <IconAction
              label="Search"
              icon={RiSearchLine}
              onClick={() => openPalette("files")}
            />
            <AddMenu
              onUpload={() => picker.current?.click()}
              onFolder={() => setNaming(true)}
            />
            {input}
          </>
        }
      >
        <FilterBar
          filters={filters}
          values={search}
          onChange={change}
          onClear={clear}
        />
        {filtered && shown.length === 0 ? (
          <NoResults what="files" onClear={clear} />
        ) : empty ? (
          <p className="text-sm text-muted-foreground">
            This folder is empty. Upload a file or make a folder with +.
          </p>
        ) : (
          <FileGallery
            resources={shown}
            openId={search.open}
            onOpen={(id) =>
              navigate({
                search: (prev) => ({ ...prev, open: id }),
                replace: true,
              })
            }
            onDelete={deleteFile}
            leading={
              <>
                {subfolders.map((sub) =>
                  renaming === sub.id ? (
                    <FolderName
                      key={sub.id}
                      initial={sub.title}
                      onDone={(title) => renameFolder(sub.id, title)}
                    />
                  ) : (
                    <FolderItem
                      key={sub.id}
                      folder={sub}
                      onRename={() => setRenaming(sub.id)}
                      onDelete={() => deleteFolder(sub.id)}
                    />
                  ),
                )}
                {naming && <FolderName onDone={createFolder} />}
              </>
            }
          />
        )}
      </Page>
    </>
  );
}

// A step up the path: a 32px ghost button, like every crumb.
function FolderCrumb({ folder }: { folder?: Folder }) {
  return (
    <>
      <BreadcrumbItem>
        <BreadcrumbLink
          render={
            <Button
              variant="ghost"
              size="sm"
              nativeButton={false}
              render={
                <Link
                  to="/files"
                  search={folder ? { folder: folder.id } : {}}
                />
              }
            />
          }
        >
          <RiFolder3Line data-icon="inline-start" />
          {folder?.title ?? "Files"}
        </BreadcrumbLink>
      </BreadcrumbItem>
      <BreadcrumbSeparator />
    </>
  );
}

// + is one menu: upload files here, or make a folder here.
function AddMenu({
  onUpload,
  onFolder,
}: {
  onUpload: () => void;
  onFolder: () => void;
}) {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" size="icon-sm" aria-label="Add" />
              }
            />
          }
        >
          <RiAddLine />
        </TooltipTrigger>
        <TooltipContent>Add</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={onUpload}>
            <RiUploadLine />
            Upload file
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onFolder}>
            <RiFolderAddLine />
            New folder
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// How many things a folder holds directly: its folders and its files.
const itemsIn = (folderId: string) =>
  folders.filter(({ parentId }) => parentId === folderId).length +
  resources.filter((file) => file.folderId === folderId).length;

// A folder's tile, the files' shape: a big folder and what it holds. Its
// right-click menu is the shared item menu: open, ask an agent about it,
// download it whole, rename in place, copy its link, delete (with everything
// in it).
function FolderItem({
  folder,
  onRename,
  onDelete,
}: {
  folder: Folder;
  onRename: () => void;
  onDelete: () => void;
}) {
  const navigate = useNavigate();
  const ask = useAskAgent();
  return (
    <GalleryItem
      render={<Link to="/files" search={{ folder: folder.id }} />}
      className="flex aspect-[4/5] flex-col items-center justify-center gap-2 bg-muted"
      tile={<FolderTile count={itemsIn(folder.id)} />}
      icon={RiFolder3Line}
      title={folder.title}
      menu={
        <ContextMenuContent className="w-48">
          <ItemMenuItems
            type="folder"
            name={folder.title}
            onOpen={() =>
              navigate({ to: "/files", search: { folder: folder.id } })
            }
            onAsk={() => ask(`In the ${folder.title} folder, `)}
            // Not wired yet: the whole folder as one download.
            onDownload={() => {}}
            onRename={onRename}
            link={`/files?folder=${folder.id}`}
            onDelete={onDelete}
          />
        </ContextMenuContent>
      }
    />
  );
}

function FolderTile({ count }: { count?: number }) {
  return (
    <>
      <RiFolder3Fill className="size-10 text-muted-foreground/60" />
      {count !== undefined && (
        <span className="text-xs text-muted-foreground tabular-nums">
          {count === 0 ? "Empty" : `${count} ${count === 1 ? "item" : "items"}`}
        </span>
      )}
    </>
  );
}

// A folder's tile named in place, new or renamed: Enter keeps the name,
// Escape or an empty name drops the change.
function FolderName({
  initial = "",
  onDone,
}: {
  initial?: string;
  onDone: (title: string) => void;
}) {
  const [title, setTitle] = useState(initial);
  return (
    <li className="flex flex-col gap-2">
      <div className="flex aspect-[4/5] flex-col items-center justify-center gap-2 rounded-md bg-muted ring-1 ring-ring/50">
        <FolderTile />
      </div>
      <div className="flex items-center gap-2 text-sm font-medium">
        <RiFolder3Line className="shrink-0 text-muted-foreground" />
        <input
          // biome-ignore lint/a11y/noAutofocus: naming starts right away.
          autoFocus
          aria-label="Folder name"
          placeholder="Folder name"
          value={title}
          className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onDone(title);
            if (event.key === "Escape") onDone("");
          }}
          onFocus={(event) => event.target.select()}
          onBlur={() => onDone(title)}
        />
      </div>
    </li>
  );
}
