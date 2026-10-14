import type { EnvironmentId, LibraryFile, LibraryFileType } from "@otto/contracts";
import {
  RiFileLine,
  RiFilePdf2Line,
  RiFileTextLine,
  RiFolderLine,
  RiImageLine,
} from "@remixicon/react";

import { cn } from "../../lib/utils";
import { useLibraryFileUrl } from "./useLibrary";

export const LIBRARY_TYPE_ICONS = {
  document: RiFileTextLine,
  image: RiImageLine,
  pdf: RiFilePdf2Line,
  file: RiFileLine,
} satisfies Record<LibraryFileType, typeof RiFileLine>;

/** A 16:9 tile with one muted icon, for folders and files without a picture. */
function IconTile({
  icon: Icon,
  className,
}: {
  readonly icon: typeof RiFileLine;
  readonly className?: string;
}) {
  return (
    <div
      aria-hidden
      className={cn(
        "flex aspect-video w-full items-center justify-center bg-secondary/60 text-muted-foreground",
        className,
      )}
    >
      <Icon className="size-8" />
    </div>
  );
}

export function LibraryFolderTile() {
  return <IconTile icon={RiFolderLine} />;
}

/** An image shows itself, cropped to the tile; every other file shows its type's icon. */
export function LibraryFileTile({
  environmentId,
  file,
}: {
  readonly environmentId: EnvironmentId;
  readonly file: LibraryFile;
}) {
  if (file.type !== "image") return <IconTile icon={LIBRARY_TYPE_ICONS[file.type]} />;

  return <LibraryImageTile environmentId={environmentId} file={file} />;
}

function LibraryImageTile({
  environmentId,
  file,
}: {
  readonly environmentId: EnvironmentId;
  readonly file: LibraryFile;
}) {
  const url = useLibraryFileUrl(environmentId, file.id);

  if (url === null) return <IconTile icon={RiImageLine} />;

  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      draggable={false}
      className="block aspect-video w-full bg-secondary/60 object-cover"
    />
  );
}

/** A 20px square for list rows: the image itself, or the type's icon. */
export function LibraryFileThumb({
  environmentId,
  file,
}: {
  readonly environmentId: EnvironmentId;
  readonly file: LibraryFile;
}) {
  const Icon = LIBRARY_TYPE_ICONS[file.type];

  if (file.type !== "image") {
    return <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />;
  }

  return <LibraryRowImage environmentId={environmentId} file={file} />;
}

function LibraryRowImage({
  environmentId,
  file,
}: {
  readonly environmentId: EnvironmentId;
  readonly file: LibraryFile;
}) {
  const url = useLibraryFileUrl(environmentId, file.id);

  if (url === null)
    return <RiImageLine aria-hidden className="size-4 shrink-0 text-muted-foreground" />;

  return <img src={url} alt="" className="size-5 shrink-0 rounded-sm object-cover" />;
}
