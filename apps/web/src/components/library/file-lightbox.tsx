import {
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiCloseLine,
  RiDownloadLine,
  RiFileCodeLine,
  RiFileExcel2Line,
  RiFileLine,
  RiFilePdf2Line,
  RiFileTextLine,
  RiFileVideoLine,
  RiFileWord2Line,
  RiFileZipLine,
  RiHtml5Line,
  RiImageLine,
  RiListCheck,
  RiMarkdownLine,
} from "@remixicon/react";
import * as Schema from "effect/Schema";
import { lazy, type ReactNode, Suspense, useEffect } from "react";

import { useLocalStorage } from "../../hooks/use-local-storage";
import { useI18n } from "../../i18n";
import { DetailsTabs } from "../details-aside";
import { AppIcon } from "../ui/app-icon";
import { Button } from "../ui/button";
import { Lightbox, LightboxClose, LightboxPopup, LightboxTitle } from "../ui/lightbox";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const FetchedFilePreview = lazy(() =>
  import("./file-previews").then((module) => ({ default: module.FetchedFilePreview })),
);

/** The file a lightbox shows: every kind but `file` previews, a `file` offers its download. */
export interface FileLightboxFile {
  readonly title: string;
  readonly kind: FileLightboxKind;
  readonly url: string | null;
  readonly icon: typeof RiCloseLine;
}

export type FileLightboxKind =
  | "image"
  | "pdf"
  | "video"
  | "markdown"
  | "html"
  | "sheet"
  | "docx"
  | "text"
  | "zip"
  | "file";

const FILE_KINDS: ReadonlyArray<{
  readonly kind: Exclude<FileLightboxKind, "file">;
  readonly icon: typeof RiCloseLine;
  readonly extensions: ReadonlyArray<string>;
  /** Exact types, or a family when it ends in a slash. */
  readonly mimeTypes: ReadonlyArray<string>;
}> = [
  {
    kind: "image",
    icon: RiImageLine,
    extensions: ["png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "bmp"],
    mimeTypes: ["image/"],
  },
  { kind: "pdf", icon: RiFilePdf2Line, extensions: ["pdf"], mimeTypes: ["application/pdf"] },
  { kind: "video", icon: RiFileVideoLine, extensions: ["mp4", "webm"], mimeTypes: ["video/"] },
  {
    kind: "markdown",
    icon: RiMarkdownLine,
    extensions: ["md", "markdown"],
    mimeTypes: ["text/markdown"],
  },
  { kind: "html", icon: RiHtml5Line, extensions: ["html", "htm"], mimeTypes: ["text/html"] },
  {
    kind: "sheet",
    icon: RiFileExcel2Line,
    extensions: ["csv", "xlsx", "xls"],
    mimeTypes: [
      "text/csv",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
    ],
  },
  {
    kind: "docx",
    icon: RiFileWord2Line,
    extensions: ["docx"],
    mimeTypes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  },
  {
    kind: "zip",
    icon: RiFileZipLine,
    extensions: ["zip"],
    mimeTypes: ["application/zip", "application/x-zip-compressed"],
  },
  {
    kind: "text",
    icon: RiFileCodeLine,
    extensions: [
      "json",
      "yaml",
      "yml",
      "toml",
      "xml",
      "css",
      "js",
      "jsx",
      "ts",
      "tsx",
      "py",
      "sh",
      "sql",
    ],
    mimeTypes: ["application/json", "application/xml", "application/yaml"],
  },
  { kind: "text", icon: RiFileTextLine, extensions: ["txt", "log"], mimeTypes: ["text/"] },
];

/**
 * Otto: How a file opens in the lightbox and which icon stands for it, for chat attachments
 * and Library files alike: the name's extension decides first, then the MIME type.
 */
export function fileLightboxKind(
  name: string,
  mimeType = "",
): Pick<FileLightboxFile, "kind" | "icon"> {
  const extension = name.includes(".") ? (name.split(".").at(-1)?.toLowerCase() ?? "") : "";
  const type = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";

  const match =
    FILE_KINDS.find((candidate) => candidate.extensions.includes(extension)) ??
    FILE_KINDS.find((candidate) =>
      candidate.mimeTypes.some((mime) =>
        mime.endsWith("/") ? type.startsWith(mime) : type === mime,
      ),
    );

  return match ? { kind: match.kind, icon: match.icon } : { kind: "file", icon: RiFileLine };
}

/**
 * Otto: A file opened full screen, for Library files and chat attachments alike: the top bar
 * holds Close and the title on the left and the arrows, Download or the caller's menu, and the
 * details toggle on the right; the preview fills the rest beside an optional Details sidebar.
 */
export function FileLightbox({
  file,
  onClose,
  ...body
}: {
  /** Null keeps the lightbox closed. */
  readonly file: FileLightboxFile | null;
  readonly onClose: () => void;
} & Omit<FileLightboxBodyProps, "file">) {
  return (
    <Lightbox open={file !== null} onOpenChange={(open) => !open && onClose()}>
      {file ? (
        <LightboxPopup aria-label={file.title}>
          <FileLightboxBody file={file} {...body} />
        </LightboxPopup>
      ) : null}
    </Lightbox>
  );
}

interface FileLightboxBodyProps {
  readonly file: FileLightboxFile;
  /** Steps to the file before or after this one; absent at either end. */
  readonly onPrevious?: (() => void) | undefined;
  readonly onNext?: (() => void) | undefined;
  /** Whether there are other files to step through, which shows the arrows. */
  readonly hasSiblings: boolean;
  readonly onDownload: () => void;
  /** Replaces the Download button in the top bar, like the Library's item menu. */
  readonly menu?: ReactNode;
  readonly details?: ReactNode;
}

function FileLightboxBody({
  file,
  onPrevious,
  onNext,
  hasSiblings,
  onDownload,
  menu,
  details,
}: FileLightboxBodyProps) {
  const { t } = useI18n();

  const [detailsOpen, setDetailsOpen] = useLocalStorage(
    "otto:library-preview-details-open",
    true,
    Schema.Boolean,
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("input, textarea, [role=listbox]")
      ) {
        return;
      }

      if (event.key === "ArrowLeft") onPrevious?.();

      if (event.key === "ArrowRight") onNext?.();
    };

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onNext, onPrevious]);

  const action = (
    label: string,
    icon: typeof RiCloseLine,
    onClick: () => void,
    disabled = false,
  ) => (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
          >
            <AppIcon icon={icon} />
          </Button>
        }
      />
      <TooltipPopup side="bottom">{label}</TooltipPopup>
    </Tooltip>
  );

  const showDetails = details !== undefined && detailsOpen;

  const detailsToggle =
    details === undefined
      ? null
      : action(
          detailsOpen ? t("Hide details") : t("Show details"),
          detailsOpen ? RiCloseLine : RiListCheck,
          () => setDetailsOpen(!detailsOpen),
        );

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col bg-secondary/40">
        <header className="flex h-(--workspace-topbar-height) shrink-0 items-center gap-2 px-3">
          <LightboxClose render={<Button size="icon-sm" variant="ghost" aria-label={t("Close")} />}>
            <AppIcon icon={RiCloseLine} />
          </LightboxClose>
          <LightboxTitle className="min-w-0 flex-1 truncate">{file.title}</LightboxTitle>
          {hasSiblings ? (
            <>
              {action(t("Previous"), RiArrowLeftSLine, () => onPrevious?.(), !onPrevious)}
              {action(t("Next"), RiArrowRightSLine, () => onNext?.(), !onNext)}
            </>
          ) : null}
          {menu ?? action(t("Download"), RiDownloadLine, onDownload)}
          {showDetails ? null : detailsToggle}
        </header>
        <div className="flex min-h-0 flex-1 items-center justify-center p-6 pt-0">
          <FilePreview file={file} onDownload={onDownload} />
        </div>
      </div>
      {showDetails ? (
        <aside
          aria-label={t("File details")}
          className="flex w-80 shrink-0 flex-col overflow-y-auto border-l border-border bg-background max-sm:hidden"
        >
          <div className="flex h-(--workspace-topbar-height) shrink-0 items-center justify-between ps-3 pe-3">
            <DetailsTabs label={t("File details")} />
            {detailsToggle}
          </div>
          <div className="flex flex-col gap-4 px-5 pt-1 pb-6">{details}</div>
        </aside>
      ) : null}
    </div>
  );
}

function FilePreview({
  file,
  onDownload,
}: {
  readonly file: FileLightboxFile;
  readonly onDownload: () => void;
}) {
  const { t } = useI18n();
  const Icon = file.icon;

  if (file.kind === "image" && file.url) {
    return (
      <img
        key={file.url}
        src={file.url}
        alt={file.title}
        className="max-h-full max-w-full rounded-md object-contain shadow-sm"
      />
    );
  }

  if (file.kind === "video" && file.url) {
    return (
      <video
        key={file.url}
        src={file.url}
        controls
        autoPlay
        aria-label={file.title}
        className="max-h-full max-w-full rounded-md shadow-sm"
      />
    );
  }

  if (file.kind === "pdf" && file.url) {
    return (
      <object
        key={file.url}
        data={file.url}
        type="application/pdf"
        aria-label={file.title}
        className="size-full rounded-md border border-border bg-background"
      />
    );
  }

  const fallback = (
    <div className="flex flex-col items-center gap-3 text-center">
      <Icon aria-hidden className="size-10 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{t("This file can't be previewed.")}</p>
      <Button variant="outline" onClick={onDownload}>
        <RiDownloadLine />
        {t("Download")}
      </Button>
    </div>
  );

  if (
    file.url &&
    (file.kind === "markdown" ||
      file.kind === "html" ||
      file.kind === "sheet" ||
      file.kind === "docx" ||
      file.kind === "text" ||
      file.kind === "zip")
  ) {
    return (
      <Suspense fallback={<Spinner className="size-5" />}>
        <FetchedFilePreview key={file.url} kind={file.kind} url={file.url} fallback={fallback} />
      </Suspense>
    );
  }

  return file.kind === "file" ? fallback : null;
}
