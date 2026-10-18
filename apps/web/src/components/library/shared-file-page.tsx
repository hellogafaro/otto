import {
  LIBRARY_SHARED_ROUTE_PREFIX,
  LibrarySharedFile,
  libraryContentType,
  libraryDownloadName,
  splitFrontMatter,
} from "@otto/contracts";
import { RiDownloadLine } from "@remixicon/react";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { lazy, Suspense, useEffect, useState } from "react";

import { readPrimaryEnvironmentTarget } from "../../environments/primary";
import { useI18n } from "../../i18n";
import { RichTextEditor } from "../rich-text-editor";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { WorkspacePageContainer } from "../workspace-page-container";
import { fileLightboxKind } from "./file-lightbox";
import { formatLibrarySize } from "./library.logic";

const FetchedFilePreview = lazy(() =>
  import("./file-previews").then((module) => ({ default: module.FetchedFilePreview })),
);

const decodeSharedFile = Schema.decodeUnknownOption(LibrarySharedFile);

const sharedAtFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

type Shared =
  | { readonly status: "loading" }
  | { readonly status: "missing" }
  | { readonly status: "ready"; readonly file: LibrarySharedFile };

/**
 * Otto: A public link, open to anyone: a thin header (the Otto mark, the file's name, who shared
 * it and an icon Download) over the file itself. Images, video and audio sit in the center,
 * PDFs and HTML fill the page, and documents read in the app's own column.
 */
export function SharedFilePage({ shareId }: { readonly shareId: string }) {
  const { t } = useI18n();
  const [shared, setShared] = useState<Shared>({ status: "loading" });
  const base = `${readPrimaryEnvironmentTarget().target.httpBaseUrl.replace(/\/$/, "")}${LIBRARY_SHARED_ROUTE_PREFIX}/${encodeURIComponent(shareId)}`;
  const contentUrl = `${base}/content`;

  useEffect(() => {
    let active = true;

    void fetch(base)
      .then((response) => (response.ok ? response.json() : null))
      .then(decodeSharedFile)
      .then(Option.getOrNull)
      .catch(() => null)
      .then((file) => {
        if (active) setShared(file === null ? { status: "missing" } : { status: "ready", file });
      });

    return () => {
      active = false;
    };
  }, [base]);

  useEffect(() => {
    if (shared.status === "ready") document.title = libraryDownloadName(shared.file);
  }, [shared]);

  if (shared.status !== "ready") {
    return (
      <div className="flex h-dvh items-center justify-center bg-background p-6 text-center">
        {shared.status === "loading" ? (
          <Spinner className="size-5" />
        ) : (
          <div className="flex max-w-sm flex-col gap-1">
            <p className="text-base font-medium text-foreground">{t("No file here")}</p>
            <p className="text-13px text-muted-foreground">
              {t("This link doesn't exist or was removed.")}
            </p>
          </div>
        )}
      </div>
    );
  }

  const { file } = shared;
  const name = libraryDownloadName(file);
  const download = t("Download");

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex h-(--workspace-topbar-height) shrink-0 items-center gap-2 border-b border-border ps-4 pe-2">
        <span
          role="img"
          aria-label="Otto"
          className="otto-wordmark-symbol inline-block shrink-0 bg-current text-base"
        />
        <h1 className="ms-1 min-w-0 truncate text-13px font-medium">{name}</h1>
        <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground max-sm:hidden">
          {[file.sharedBy, file.workspace, sharedAtFormatter.format(new Date(file.sharedAt))]
            .filter((part) => part !== null)
            .join(" · ")}
        </p>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={download}
                className="ms-auto"
                onClick={() => window.location.assign(`${contentUrl}?download=1`)}
              >
                <RiDownloadLine />
              </Button>
            }
          />
          <TooltipPopup side="bottom">{download}</TooltipPopup>
        </Tooltip>
      </header>
      <main className="min-h-0 flex-1 overflow-auto">
        <SharedFilePreview file={file} name={name} url={contentUrl} />
      </main>
    </div>
  );
}

function SharedFilePreview({
  file,
  name,
  url,
}: {
  readonly file: LibrarySharedFile;
  readonly name: string;
  readonly url: string;
}) {
  const contentType = libraryContentType(file);
  const { kind, icon: Icon } = fileLightboxKind(name, contentType);
  const centered = "flex size-full items-center justify-center p-6";

  if (contentType.startsWith("text/html")) {
    return (
      <iframe
        src={url}
        title={name}
        sandbox="allow-scripts allow-popups"
        className="block size-full border-0 bg-on-solid"
      />
    );
  }

  if (kind === "pdf") {
    return (
      <object data={url} type="application/pdf" aria-label={name} className="block size-full" />
    );
  }

  if (kind === "markdown") return <SharedDocument url={url} />;

  if (kind === "image") {
    return (
      <div className={centered}>
        <img src={url} alt={name} className="max-h-full max-w-full object-contain" />
      </div>
    );
  }

  if (kind === "video") {
    return (
      <div className={centered}>
        <video src={url} controls aria-label={name} className="max-h-full max-w-full" />
      </div>
    );
  }

  if (contentType.startsWith("audio/")) {
    return (
      <div className={centered}>
        <audio src={url} controls aria-label={name} className="w-full max-w-md" />
      </div>
    );
  }

  const fallback = (
    <div className="flex flex-col items-center gap-2 text-center">
      <Icon aria-hidden className="size-10 text-muted-foreground" />
      <p className="text-13px font-medium">{name}</p>
      <p className="text-xs text-muted-foreground">{formatLibrarySize(file.sizeBytes)}</p>
    </div>
  );

  if (kind === "file") return <div className={centered}>{fallback}</div>;

  return (
    <div className={centered}>
      <Suspense fallback={<Spinner className="size-5" />}>
        <FetchedFilePreview kind={kind} url={url} fallback={fallback} />
      </Suspense>
    </div>
  );
}

/** A shared document reads like a Library document in the app, without a way to edit it. */
function SharedDocument({ url }: { readonly url: string }) {
  const { t } = useI18n();
  const [markdown, setMarkdown] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    void fetch(url)
      .then((response) => (response.ok ? response.text() : ""))
      .catch(() => "")
      .then((text) => {
        if (active) setMarkdown(splitFrontMatter(text).body);
      });

    return () => {
      active = false;
    };
  }, [url]);

  if (markdown === null) {
    return (
      <div className="flex size-full items-center justify-center">
        <Spinner className="size-5" />
      </div>
    );
  }

  return (
    <WorkspacePageContainer width="narrow" className="pt-3 pb-16 sm:pt-4">
      <RichTextEditor
        className="px-4"
        value={markdown}
        editable={false}
        placeholder={t("This document is empty.")}
        ariaLabel={t("Document")}
      />
    </WorkspacePageContainer>
  );
}
