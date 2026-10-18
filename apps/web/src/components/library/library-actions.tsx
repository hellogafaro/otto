import { toast } from "sonner";
import {
  type EnvironmentId,
  type LibraryFile,
  type LibraryFolder,
  type LibraryFolderId,
  LIBRARY_CHATS_FOLDER_ID,
  LIBRARY_PROJECTS_FOLDER_ID,
  LIBRARY_SKILLS_FOLDER_ID,
  LIBRARY_SYSTEM_FOLDER_IDS,
  LIBRARY_MAX_FOLDER_DEPTH,
  type LibraryVisibility,
  libraryFolderPath,
  normalizeLibraryTitle,
} from "@otto/contracts";
import {
  RiBookShelfLine,
  RiDeleteBinLine,
  RiDownloadLine,
  RiEditLine,
  RiFolderLine,
  RiFolderTransferLine,
  RiGlobalLine,
  RiLink,
  RiLockLine,
  RiMoreLine,
} from "@remixicon/react";
import { useRouter } from "@tanstack/react-router";
import { AsyncResult } from "effect/unstable/reactivity";
import { useMemo, useState } from "react";

import { useI18n } from "../../i18n";
import { ensureLocalApi } from "../../local-api";
import { usePageActions, type PageAction } from "../../page-actions-registry";
import { cn } from "../../lib/utils";
import { CopyMenuItems, useCopyPageActions } from "../copy-menu-items";
import type { PickerOpenState } from "../details-aside";
import { libraryEnvironment } from "../../state/library";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { LibraryShareDialog } from "./library-share-dialog";
import { useLibraryDownload, type LibraryData } from "./use-library";

/** One short line of text: a new folder's name or anything's new title. */
export function LibraryNameDialog({
  open,
  onOpenChange,
  heading,
  label,
  initialValue,
  submitLabel,
  onSubmit,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly heading: string;
  readonly label: string;
  readonly initialValue: string;
  readonly submitLabel: string;
  readonly onSubmit: (title: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-md" bottomStickOnMobile={false}>
        {open ? (
          <LibraryNameForm
            heading={heading}
            label={label}
            initialValue={initialValue}
            submitLabel={submitLabel}
            onCancel={() => onOpenChange(false)}
            onSubmit={(title) => {
              onOpenChange(false);
              onSubmit(title);
            }}
          />
        ) : null}
      </DialogPopup>
    </Dialog>
  );
}

function LibraryNameForm({
  heading,
  label,
  initialValue,
  submitLabel,
  onCancel,
  onSubmit,
}: {
  readonly heading: string;
  readonly label: string;
  readonly initialValue: string;
  readonly submitLabel: string;
  readonly onCancel: () => void;
  readonly onSubmit: (title: string) => void;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState(initialValue);

  return (
    <form
      className="flex min-h-0 flex-col"
      onSubmit={(event) => {
        event.preventDefault();

        if (value.trim().length > 0) onSubmit(normalizeLibraryTitle(value));
      }}
    >
      <DialogHeader>
        <DialogTitle>{heading}</DialogTitle>
      </DialogHeader>
      <DialogPanel>
        <Input
          autoFocus
          aria-label={label}
          maxLength={200}
          value={value}
          onChange={(event) => setValue(event.currentTarget.value)}
          onFocus={(event) => event.currentTarget.select()}
        />
      </DialogPanel>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t("Cancel")}
        </Button>
        <Button type="submit" disabled={value.trim().length === 0}>
          {submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}

type FolderOption = {
  readonly id: LibraryFolderId | null;
  readonly title: string;
  readonly depth: number;
  /** Chats only holds chat folders, so it shows as a parent but can't be picked. */
  readonly selectable: boolean;
};

/**
 * Where an item can move: the top of the Library and every folder it may go in, as an
 * indented tree. A folder never lists itself or what's inside it, and the Chats folder
 * only holds chat folders.
 */
function moveTargets(
  folders: ReadonlyArray<LibraryFolder>,
  item: { readonly kind: "folder"; readonly folder: LibraryFolder } | { readonly kind: "file" },
  topLabel: string,
): FolderOption[] {
  const options: FolderOption[] = [{ id: null, title: topLabel, depth: 0, selectable: true }];

  const height = (folderId: LibraryFolderId): number =>
    1 +
    Math.max(
      0,
      ...folders.flatMap((folder) => (folder.parentId === folderId ? [height(folder.id)] : [])),
    );

  const visit = (parentId: LibraryFolderId | null, depth: number) => {
    for (const folder of folders
      .filter((candidate) => candidate.parentId === parentId)
      .toSorted((left, right) => left.title.localeCompare(right.title))) {
      if (item.kind === "folder" && folder.id === item.folder.id) continue;

      if (
        folder.id === LIBRARY_CHATS_FOLDER_ID ||
        folder.id === LIBRARY_PROJECTS_FOLDER_ID ||
        (folder.id === LIBRARY_SKILLS_FOLDER_ID && item.kind === "file")
      ) {
        options.push({ id: folder.id, title: folder.title, depth, selectable: false });
      } else {
        const fits =
          item.kind === "file" ||
          libraryFolderPath(folders, folder.id).length + height(item.folder.id) <=
            LIBRARY_MAX_FOLDER_DEPTH;

        if (fits) options.push({ id: folder.id, title: folder.title, depth, selectable: true });
      }

      visit(folder.id, depth + 1);
    }
  };

  visit(null, 1);

  return options;
}

export function LibraryMoveDialog({
  open,
  onOpenChange,
  folders,
  item,
  current,
  onMove,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly folders: ReadonlyArray<LibraryFolder>;
  readonly item:
    | { readonly kind: "folder"; readonly folder: LibraryFolder }
    | { readonly kind: "file" };
  readonly current: LibraryFolderId | null;
  readonly onMove: (folderId: LibraryFolderId | null) => void;
}) {
  const { t } = useI18n();
  const [target, setTarget] = useState<LibraryFolderId | null>(current);
  const options = moveTargets(folders, item, t("Library"));

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setTarget(current);
        onOpenChange(next);
      }}
    >
      <DialogPopup
        className="flex max-h-(--spacing-dvh-2rem) max-w-md flex-col overflow-hidden"
        bottomStickOnMobile={false}
      >
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            onOpenChange(false);

            if (target !== current) onMove(target);
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("Move to")}</DialogTitle>
          </DialogHeader>
          <DialogPanel>
            <div role="listbox" aria-label={t("Folders")} className="flex flex-col">
              {options.map((option) => (
                <button
                  key={option.id ?? "top"}
                  type="button"
                  role="option"
                  aria-selected={option.id === target}
                  aria-disabled={!option.selectable}
                  onClick={() => option.selectable && setTarget(option.id)}
                  className={cn(
                    "flex h-8 items-center rounded-md px-2 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    !option.selectable
                      ? "cursor-default text-muted-foreground"
                      : option.id === target
                        ? "bg-secondary text-foreground"
                        : "hover:bg-secondary/60",
                  )}
                >
                  {Array.from({ length: option.depth }, (_, level) => (
                    <span
                      key={level}
                      aria-hidden
                      className="relative w-4 shrink-0 self-stretch before:absolute before:inset-y-0 before:left-1/2 before:w-px before:bg-border"
                    />
                  ))}
                  {option.id === null ? (
                    <RiBookShelfLine
                      aria-hidden
                      className="me-2 size-4 shrink-0 text-muted-foreground"
                    />
                  ) : (
                    <RiFolderLine
                      aria-hidden
                      className="me-2 size-4 shrink-0 text-muted-foreground"
                    />
                  )}
                  <span className="truncate">{option.title}</span>
                </button>
              ))}
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t("Cancel")}
            </Button>
            <Button type="submit" disabled={target === current}>
              {t("Move")}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

/** The team or only you, as a quiet property row; read-only text for anyone but the creator. */
export function LibraryVisibilitySelect({
  value,
  editable,
  onChange,
  picker,
}: {
  readonly value: LibraryVisibility;
  readonly editable: boolean;
  readonly onChange: (visibility: LibraryVisibility) => void;
  readonly picker?: PickerOpenState;
}) {
  const { t } = useI18n();

  const labels = { organization: t("Team"), user: t("Only me") } satisfies Record<
    LibraryVisibility,
    string
  >;

  const icon = (visibility: LibraryVisibility) =>
    visibility === "user" ? (
      <RiLockLine aria-hidden className="size-3.5" />
    ) : (
      <RiGlobalLine aria-hidden className="size-3.5" />
    );

  if (!editable) {
    return (
      <span className="flex items-center gap-1.5 px-2.5 text-sm text-secondary-label">
        {icon(value)}
        {labels[value]}
      </span>
    );
  }

  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (next === "user" || next === "organization") onChange(next);
      }}
      open={picker?.open}
      onOpenChange={picker?.onOpenChange}
    >
      <SelectTrigger
        size="sm"
        variant="ghost"
        className="w-auto min-w-0"
        aria-label={t("Visibility")}
      >
        <SelectValue>
          <span className="flex items-center gap-1.5">
            {icon(value)}
            {labels[value]}
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectPopup alignItemWithTrigger={false} finalFocus={picker?.finalFocus}>
        {(["organization", "user"] as const).map((visibility) => (
          <SelectItem key={visibility} hideIndicator value={visibility}>
            <span className="flex items-center gap-2">
              {icon(visibility)}
              {labels[visibility]}
            </span>
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

type MenuTarget =
  | { readonly kind: "folder"; readonly folder: LibraryFolder }
  | { readonly kind: "file"; readonly file: LibraryFile };

/**
 * A system holder folder has no actions; a chat's or project's folder can only be renamed; the
 * rest is its creator's to change.
 */
function libraryItemRights(data: LibraryData, target: MenuTarget) {
  const isHolder = target.kind === "folder" && LIBRARY_SYSTEM_FOLDER_IDS.has(target.folder.id);

  const isFixedFolder =
    target.kind === "folder" &&
    (target.folder.threadId !== undefined || target.folder.projectId !== undefined);

  const editable =
    !isHolder && data.canEdit(target.kind === "folder" ? target.folder : target.file);

  return { isHolder, isFixedFolder, editable };
}

/** Copy link and Copy ID: a document's page, another file's preview in its folder, or the folder. */
function useLibraryItemCopy(target: MenuTarget) {
  const router = useRouter();

  const path =
    target.kind === "file" && target.file.type === "document"
      ? `/library/${target.file.id}`
      : router.buildLocation({
          to: "/library",
          search:
            target.kind === "folder"
              ? { folder: target.folder.id }
              : {
                  ...(target.file.folderId ? { folder: target.file.folderId } : {}),
                  preview: target.file.id,
                },
        }).href;

  return useCopyPageActions(path, target.kind === "folder" ? target.folder.id : target.file.id);
}

/**
 * Otto: The item keys of the Library card J and K hold: Rename and Delete for what its creator
 * may change, then Copy link and Copy ID, joined to the page's own actions while it is held.
 */
export function LibraryRowActions({
  environmentId,
  data,
  target,
  pageActions,
}: {
  readonly environmentId: EnvironmentId;
  readonly data: LibraryData;
  readonly target: MenuTarget;
  readonly pageActions: ReadonlyArray<PageAction>;
}) {
  const { t } = useI18n();
  const actions = useLibraryItemActions(environmentId, data, target);
  const { isHolder, isFixedFolder, editable } = libraryItemRights(data, target);
  const copy = useLibraryItemCopy(target);
  const { setRenaming, remove } = actions;

  const pageAndItem = useMemo(
    (): PageAction[] =>
      isHolder
        ? [...pageActions]
        : [
            ...pageActions,
            ...(editable
              ? [
                  {
                    id: "rename",
                    title: t("Rename"),
                    icon: RiEditLine,
                    searchTerms: ["rename", "title", "name"],
                    shortcutCommand: "item.rename",
                    run: () => setRenaming(true),
                  } satisfies PageAction,
                ]
              : []),
            copy.link,
            copy.id,
            ...(editable && !isFixedFolder
              ? [
                  {
                    id: "delete",
                    title: t("Delete"),
                    icon: RiDeleteBinLine,
                    searchTerms: ["delete", "remove"],
                    shortcutCommand: "item.delete",
                    run: remove,
                  } satisfies PageAction,
                ]
              : []),
          ],
    [copy, editable, isFixedFolder, isHolder, pageActions, remove, setRenaming, t],
  );

  usePageActions(target.kind === "folder" ? target.folder.title : target.file.title, pageAndItem);

  return actions.dialogs;
}

/**
 * The ⋯ menu on a Library item: download for files, for its creator rename, move and
 * visibility, then Copy link and Copy ID, then delete for its creator. A chat's folder can only
 * be renamed; deleting asks first. The link opens a document's page, another file's preview in
 * its folder, or the folder itself.
 */
export function LibraryItemMenu({
  environmentId,
  data,
  target,
  revealInGroup = false,
  onDeleted,
}: {
  readonly environmentId: EnvironmentId;
  readonly data: LibraryData;
  readonly target: MenuTarget;
  /** Hidden until the surrounding `group` is hovered or focused. */
  readonly revealInGroup?: boolean;
  readonly onDeleted?: () => void;
}) {
  const { t } = useI18n();
  const actions = useLibraryItemActions(environmentId, data, target, onDeleted);
  const download = useLibraryDownload();
  const item = target.kind === "folder" ? target.folder : target.file;
  const { isHolder, isFixedFolder, editable } = libraryItemRights(data, target);
  const [sharing, setSharing] = useState(false);
  const copy = useLibraryItemCopy(target);

  if (isHolder) return null;

  return (
    <>
      <Menu>
        <MenuTrigger
          render={
            <Button
              size="icon-xs"
              variant="ghost-muted"
              aria-label={t("Actions for {name}", { name: item.title })}
              {...(revealInGroup ? { presentation: "reveal-in-group" as const } : {})}
              onClick={(event) => event.stopPropagation()}
            />
          }
        >
          <RiMoreLine />
        </MenuTrigger>
        <MenuPopup align="end" className="min-w-44">
          {target.kind === "file" ? (
            <MenuItem onClick={() => void download(environmentId, target.file.id)}>
              <RiDownloadLine />
              {t("Download")}
            </MenuItem>
          ) : null}
          {target.kind === "file" && editable ? (
            <MenuItem onClick={() => setSharing(true)}>
              <RiLink />
              {t("Share public link")}
            </MenuItem>
          ) : null}
          {editable ? (
            <>
              <MenuItem onClick={() => actions.setRenaming(true)}>
                <RiEditLine />
                {t("Rename")}
              </MenuItem>
              {isFixedFolder ? null : (
                <>
                  <MenuItem onClick={() => actions.setMoving(true)}>
                    <RiFolderTransferLine />
                    {t("Move to…")}
                  </MenuItem>
                  <MenuItem
                    onClick={() =>
                      actions.setVisibility(item.visibility === "user" ? "organization" : "user")
                    }
                  >
                    {item.visibility === "user" ? <RiGlobalLine /> : <RiLockLine />}
                    {item.visibility === "user" ? t("Share with team") : t("Make private")}
                  </MenuItem>
                </>
              )}
            </>
          ) : null}
          {target.kind === "file" || editable ? <MenuSeparator /> : null}
          <CopyMenuItems actions={copy} />
          {editable && !isFixedFolder ? (
            <>
              <MenuSeparator />
              <MenuItem variant="destructive" onClick={() => void actions.remove()}>
                <RiDeleteBinLine />
                {t("Delete")}
              </MenuItem>
            </>
          ) : null}
        </MenuPopup>
      </Menu>
      {actions.dialogs}
      {target.kind === "file" ? (
        <LibraryShareDialog
          open={sharing}
          onOpenChange={setSharing}
          environmentId={environmentId}
          file={target.file}
        />
      ) : null}
    </>
  );
}

/** Rename, move, visibility and delete for one item, with their dialogs. */
export function useLibraryItemActions(
  environmentId: EnvironmentId,
  data: LibraryData,
  target: MenuTarget,
  onDeleted?: () => void,
) {
  const { t } = useI18n();
  const updateFolder = useAtomCommand(libraryEnvironment.updateFolder, { reportFailure: false });
  const deleteFolder = useAtomCommand(libraryEnvironment.deleteFolder, { reportFailure: false });
  const updateFile = useAtomCommand(libraryEnvironment.updateFile, { reportFailure: false });
  const deleteFile = useAtomCommand(libraryEnvironment.deleteFile, { reportFailure: false });
  const [renaming, setRenaming] = useState(false);
  const [moving, setMoving] = useState(false);
  const item = target.kind === "folder" ? target.folder : target.file;

  const update = async (fields: {
    readonly title?: string;
    readonly visibility?: LibraryVisibility;
    readonly parent?: LibraryFolderId | null;
  }) => {
    const result =
      target.kind === "folder"
        ? await updateFolder({
            environmentId,
            input: {
              folderId: target.folder.id,
              ...(fields.title !== undefined ? { title: fields.title } : {}),
              ...(fields.visibility !== undefined ? { visibility: fields.visibility } : {}),
              ...(fields.parent !== undefined ? { parentId: fields.parent } : {}),
            },
          })
        : await updateFile({
            environmentId,
            input: {
              fileId: target.file.id,
              ...(fields.title !== undefined ? { title: fields.title } : {}),
              ...(fields.visibility !== undefined ? { visibility: fields.visibility } : {}),
              ...(fields.parent !== undefined ? { folderId: fields.parent } : {}),
            },
          });

    if (!AsyncResult.isSuccess(result)) toast.error(t("Change couldn't be saved"));
  };

  const remove = async () => {
    const confirmed = await ensureLocalApi().dialogs.confirm(
      target.kind === "folder"
        ? t('Delete the folder "{name}"?', { name: item.title })
        : t('Delete "{name}"? This can\'t be undone.', { name: item.title }),
      { variant: "destructive", confirmLabel: t("Delete") },
    );

    if (!confirmed) return;

    const result =
      target.kind === "folder"
        ? await deleteFolder({ environmentId, input: { folderId: target.folder.id } })
        : await deleteFile({ environmentId, input: { fileId: target.file.id } });

    if (AsyncResult.isSuccess(result)) onDeleted?.();
    else toast.error(t("{name} couldn't be deleted", { name: item.title }));
  };

  return {
    setRenaming,
    setMoving,
    setVisibility: (visibility: LibraryVisibility) => void update({ visibility }),
    remove,
    dialogs: (
      <>
        <LibraryNameDialog
          open={renaming}
          onOpenChange={setRenaming}
          heading={target.kind === "folder" ? t("Rename folder") : t("Rename file")}
          label={t("Name")}
          initialValue={item.title}
          submitLabel={t("Save")}
          onSubmit={(title) => {
            if (title !== item.title) void update({ title });
          }}
        />
        <LibraryMoveDialog
          open={moving}
          onOpenChange={setMoving}
          folders={data.folders}
          item={
            target.kind === "folder" ? { kind: "folder", folder: target.folder } : { kind: "file" }
          }
          current={target.kind === "folder" ? target.folder.parentId : target.file.folderId}
          onMove={(parent) => void update({ parent })}
        />
      </>
    ),
  };
}
