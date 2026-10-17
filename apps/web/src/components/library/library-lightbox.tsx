import type { EnvironmentId, LibraryFile } from "@otto/contracts";

import { FileLightbox } from "./file-lightbox";
import { LibraryItemMenu } from "./library-actions";
import { LibraryFileDetails } from "./library-details";
import { LIBRARY_TYPE_ICONS } from "./library-visuals";
import { useLibraryDownload, useLibraryFileUrl, type LibraryData } from "./use-library";

/** A Library file in the shared file lightbox, with its item menu and Details sidebar. */
export function LibraryLightbox({
  environmentId,
  data,
  file,
  siblings,
  onSelect,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly data: LibraryData;
  readonly file: LibraryFile | null;
  /** The files the arrows step through, in the order shown behind the lightbox. */
  readonly siblings: ReadonlyArray<LibraryFile>;
  readonly onSelect: (file: LibraryFile) => void;
  readonly onClose: () => void;
}) {
  if (!file)
    return <FileLightbox file={null} hasSiblings={false} onDownload={onClose} onClose={onClose} />;

  return (
    <OpenLibraryLightbox
      environmentId={environmentId}
      data={data}
      file={file}
      siblings={siblings}
      onSelect={onSelect}
      onClose={onClose}
    />
  );
}

function OpenLibraryLightbox({
  environmentId,
  data,
  file,
  siblings,
  onSelect,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly data: LibraryData;
  readonly file: LibraryFile;
  readonly siblings: ReadonlyArray<LibraryFile>;
  readonly onSelect: (file: LibraryFile) => void;
  readonly onClose: () => void;
}) {
  const download = useLibraryDownload();
  const url = useLibraryFileUrl(environmentId, file.id);
  const index = siblings.findIndex((candidate) => candidate.id === file.id);
  const previous = index > 0 ? siblings[index - 1] : undefined;
  const next = index >= 0 ? siblings[index + 1] : undefined;

  return (
    <FileLightbox
      file={{
        title: file.title,
        kind:
          file.type === "image" || file.type === "pdf"
            ? file.type
            : file.extension === "mp4" || file.extension === "webm"
              ? "video"
              : "file",
        url,
        icon: LIBRARY_TYPE_ICONS[file.type],
      }}
      hasSiblings={siblings.length > 1}
      onPrevious={previous ? () => onSelect(previous) : undefined}
      onNext={next ? () => onSelect(next) : undefined}
      onDownload={() => void download(environmentId, file.id)}
      onClose={onClose}
      menu={
        <LibraryItemMenu
          environmentId={environmentId}
          data={data}
          target={{ kind: "file", file }}
          onDeleted={onClose}
        />
      }
      details={
        <LibraryFileDetails
          environmentId={environmentId}
          data={data}
          file={file}
          onNavigate={onClose}
        />
      }
    />
  );
}
