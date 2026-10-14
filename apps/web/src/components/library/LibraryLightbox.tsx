import type { EnvironmentId, LibraryFile } from "@otto/contracts";
import {
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiCloseLine,
  RiDownloadLine,
  RiListCheck,
} from "@remixicon/react";
import * as Schema from "effect/Schema";
import { useEffect } from "react";

import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useI18n } from "../../i18n";
import { DetailsTabs } from "../DetailsAside";
import { AppIcon } from "../ui/app-icon";
import { Button } from "../ui/button";
import { Lightbox, LightboxClose, LightboxPopup, LightboxTitle } from "../ui/lightbox";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { LibraryItemMenu } from "./LibraryActions";
import { LibraryFileDetails } from "./LibraryDetails";
import { LIBRARY_TYPE_ICONS } from "./LibraryVisuals";
import { useLibraryDownload, useLibraryFileUrl, type LibraryData } from "./useLibrary";

/**
 * Otto: A file opened full screen: the top bar holds Close and the title on the
 * left and the arrows, Download, the item menu and the details toggle on the
 * right; the preview fills the rest beside the same Details sidebar as a task.
 * Images and PDFs preview; any other file offers its download instead.
 */
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
  return (
    <Lightbox open={file !== null} onOpenChange={(open) => !open && onClose()}>
      {file ? (
        <LightboxPopup aria-label={file.title}>
          <LightboxBody
            environmentId={environmentId}
            data={data}
            file={file}
            siblings={siblings}
            onSelect={onSelect}
            onClose={onClose}
          />
        </LightboxPopup>
      ) : null}
    </Lightbox>
  );
}

function LightboxBody({
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
  const { t } = useI18n();
  const download = useLibraryDownload();

  const [detailsOpen, setDetailsOpen] = useLocalStorage(
    "otto:library-preview-details-open",
    true,
    Schema.Boolean,
  );

  const index = siblings.findIndex((candidate) => candidate.id === file.id);
  const previous = index > 0 ? siblings[index - 1] : undefined;
  const next = index >= 0 ? siblings[index + 1] : undefined;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("input, textarea, [role=listbox]")
      ) {
        return;
      }

      if (event.key === "ArrowLeft" && previous) onSelect(previous);

      if (event.key === "ArrowRight" && next) onSelect(next);
    };

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [next, onSelect, previous]);

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

  const detailsToggle = action(
    detailsOpen ? t("Hide details") : t("Show details"),
    RiListCheck,
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
          {siblings.length > 1 ? (
            <>
              {action(
                t("Previous"),
                RiArrowLeftSLine,
                () => previous && onSelect(previous),
                !previous,
              )}
              {action(t("Next"), RiArrowRightSLine, () => next && onSelect(next), !next)}
            </>
          ) : null}
          <LibraryItemMenu
            environmentId={environmentId}
            data={data}
            target={{ kind: "file", file }}
            onDeleted={onClose}
          />
          {detailsOpen ? null : detailsToggle}
        </header>
        <div className="flex min-h-0 flex-1 items-center justify-center p-6 pt-0">
          <LibraryPreview
            environmentId={environmentId}
            file={file}
            onDownload={() => void download(environmentId, file.id)}
          />
        </div>
      </div>
      {detailsOpen ? (
        <aside
          aria-label={t("File details")}
          className="flex w-80 shrink-0 flex-col overflow-y-auto border-l border-border bg-background max-sm:hidden"
        >
          <div className="flex h-(--workspace-topbar-height) shrink-0 items-center justify-between ps-3 pe-3">
            <DetailsTabs label={t("File details")} />
            {detailsToggle}
          </div>
          <div className="flex flex-col gap-4 px-5 pt-1 pb-6">
            <LibraryFileDetails
              environmentId={environmentId}
              data={data}
              file={file}
              onNavigate={onClose}
            />
          </div>
        </aside>
      ) : null}
    </div>
  );
}

function LibraryPreview({
  environmentId,
  file,
  onDownload,
}: {
  readonly environmentId: EnvironmentId;
  readonly file: LibraryFile;
  readonly onDownload: () => void;
}) {
  const { t } = useI18n();
  const url = useLibraryFileUrl(environmentId, file.id);
  const Icon = LIBRARY_TYPE_ICONS[file.type];

  if (file.type === "image" && url) {
    return (
      <img
        key={file.id}
        src={url}
        alt={file.title}
        className="max-h-full max-w-full rounded-md object-contain shadow-sm"
      />
    );
  }

  if (file.type === "pdf" && url) {
    return (
      <object
        key={file.id}
        data={url}
        type="application/pdf"
        aria-label={file.title}
        className="size-full rounded-md border border-border bg-background"
      />
    );
  }

  if (file.type === "image" || file.type === "pdf") return null;

  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <Icon aria-hidden className="size-10 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{t("This file can't be previewed.")}</p>
      <Button variant="outline" onClick={onDownload}>
        <RiDownloadLine />
        {t("Download")}
      </Button>
    </div>
  );
}
