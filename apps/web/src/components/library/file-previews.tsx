import { RiFileLine, RiFolderLine } from "@remixicon/react";
import { type ReactNode, useEffect, useState } from "react";

import { useI18n } from "../../i18n";
import ChatMarkdown from "../chat-markdown";
import { Card } from "../ui/card";
import { Spinner } from "../ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import {
  fetchPreviewBytes,
  PREVIEW_MAX_LINES,
  PREVIEW_MAX_ROWS,
  type PreviewSheet,
  type PreviewZipEntry,
  previewHtml,
  previewSheets,
  previewText,
  previewZipEntries,
} from "./file-preview.logic";
import { formatLibrarySize } from "./library.logic";

/**
 * Otto: The lightbox previews that read the file's bytes: Markdown as a document page, HTML
 * rendered in a sandboxed frame, CSV and Excel as tables, Word through docx-preview, text as source
 * and a zip as its entries. They show the spinner while loading and the caller's fallback when the
 * file is too big or won't parse.
 */
export function FetchedFilePreview({
  kind,
  url,
  fallback,
}: {
  readonly kind: "markdown" | "html" | "sheet" | "docx" | "text" | "zip";
  readonly url: string;
  readonly fallback: ReactNode;
}) {
  const { t } = useI18n();

  if (kind === "markdown") {
    return (
      <LoadedPreview url={url} load={previewText} fallback={fallback}>
        {({ text, capped }) => (
          <div className="flex size-full flex-col gap-3 overflow-y-auto">
            <Card className="mx-auto w-full max-w-3xl px-10 py-8 max-sm:px-5">
              <ChatMarkdown text={text} cwd={undefined} />
            </Card>
            {capped ? <LinesCappedNote /> : null}
          </div>
        )}
      </LoadedPreview>
    );
  }

  if (kind === "html") {
    return (
      <LoadedPreview url={url} load={previewHtml} fallback={fallback}>
        {(html) => (
          <iframe
            srcDoc={html}
            title={t("HTML preview")}
            sandbox="allow-scripts allow-popups"
            className="size-full rounded-md border border-border bg-on-solid"
          />
        )}
      </LoadedPreview>
    );
  }

  if (kind === "text") {
    return (
      <LoadedPreview url={url} load={previewText} fallback={fallback}>
        {({ text, capped }) => (
          <div className="flex size-full flex-col gap-3">
            <Card className="min-h-0 flex-1 overflow-auto">
              <pre className="w-fit min-w-full p-4 font-mono text-xs leading-5">{text}</pre>
            </Card>
            {capped ? <LinesCappedNote /> : null}
          </div>
        )}
      </LoadedPreview>
    );
  }

  if (kind === "sheet") {
    return (
      <LoadedPreview url={url} load={previewSheets} fallback={fallback}>
        {(sheets) => <SheetPreview sheets={sheets} />}
      </LoadedPreview>
    );
  }

  if (kind === "docx") {
    return (
      <LoadedPreview url={url} load={renderDocx} fallback={fallback}>
        {(page) => (
          <div
            className="size-full overflow-auto"
            ref={(node) => {
              node?.replaceChildren(page);
            }}
          />
        )}
      </LoadedPreview>
    );
  }

  return (
    <LoadedPreview url={url} load={previewZipEntries} fallback={fallback}>
      {(entries) => <ZipPreview entries={entries} />}
    </LoadedPreview>
  );
}

function LoadedPreview<T>({
  url,
  load,
  fallback,
  children,
}: {
  readonly url: string;
  readonly load: (bytes: ArrayBuffer) => T | Promise<T>;
  readonly fallback: ReactNode;
  readonly children: (value: T) => ReactNode;
}) {
  const [loaded, setLoaded] = useState<{ readonly value: T } | "failed" | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    fetchPreviewBytes(url, controller.signal)
      .then(load)
      .then(
        (value) => {
          if (!controller.signal.aborted) setLoaded({ value });
        },
        () => {
          if (!controller.signal.aborted) setLoaded("failed");
        },
      );

    return () => controller.abort();
  }, [url, load]);

  if (loaded === null) return <Spinner className="size-5" />;

  if (loaded === "failed") return fallback;

  return children(loaded.value);
}

async function renderDocx(bytes: ArrayBuffer) {
  const { renderAsync } = await import("docx-preview");
  const page = document.createElement("div");

  await renderAsync(bytes, page, undefined, {
    inWrapper: true,
    breakPages: true,
    ignoreLastRenderedPageBreak: true,
  });

  page.querySelector<HTMLElement>(".docx-wrapper")?.style.setProperty("background", "transparent");

  return page;
}

function LinesCappedNote() {
  const { t, formatNumber } = useI18n();

  return (
    <p className="shrink-0 text-center text-xs text-muted-foreground">
      {t("Showing the first {count} lines.", { count: formatNumber(PREVIEW_MAX_LINES) })}
    </p>
  );
}

function SheetPreview({ sheets }: { readonly sheets: ReadonlyArray<PreviewSheet> }) {
  const { t, formatNumber } = useI18n();
  const [index, setIndex] = useState(0);
  const sheet = sheets[index] ?? sheets[0];
  const [header, ...body] = sheet?.rows ?? [];
  const rows = formatNumber(sheet?.rows.length ?? 0);
  const columns = formatNumber(header?.cells.length ?? 0);

  return (
    <div className="flex size-full flex-col gap-3">
      {sheets.length > 1 ? (
        <ToggleGroup
          aria-label={t("Sheets")}
          variant="segmented"
          className="shrink-0 self-center"
          value={[String(index)]}
          onValueChange={(next) => {
            if (next[0] !== undefined) setIndex(Number(next[0]));
          }}
        >
          {sheets.map((candidate, candidateIndex) => (
            <Toggle key={candidate.name} value={String(candidateIndex)}>
              {candidate.name}
            </Toggle>
          ))}
        </ToggleGroup>
      ) : null}
      <Card className="min-h-0 flex-1 overflow-y-auto p-2">
        {header ? (
          <Table>
            <TableHeader>
              <TableRow>
                {header.cells.map((cell) => (
                  <TableHead key={cell.column}>{cell.value}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {body.map((row) => (
                <TableRow key={row.number}>
                  {row.cells.map((cell) => (
                    <TableCell key={cell.column}>{cell.value}</TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="p-4 text-center text-sm text-muted-foreground">
            {t("This sheet is empty.")}
          </p>
        )}
      </Card>
      {sheet?.capped ? (
        <p className="shrink-0 text-center text-xs text-muted-foreground">
          {t("Showing the first {rows} rows and {columns} columns.", { rows, columns })}
        </p>
      ) : null}
    </div>
  );
}

function ZipPreview({ entries }: { readonly entries: ReadonlyArray<PreviewZipEntry> }) {
  const { t, plural, formatNumber } = useI18n();
  const files = entries.filter((entry) => !entry.folder).length;

  return (
    <div className="flex size-full flex-col gap-3">
      <p className="shrink-0 text-center text-xs text-muted-foreground">
        {plural(files, { one: "{count} file", other: "{count} files" })}
      </p>
      <Card className="min-h-0 flex-1 overflow-y-auto p-2">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("Name")}</TableHead>
              <TableHead className="text-right">{t("Size")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.slice(0, PREVIEW_MAX_ROWS).map((entry) => {
              const Icon = entry.folder ? RiFolderLine : RiFileLine;

              return (
                <TableRow key={entry.path}>
                  <TableCell>
                    <span className="flex items-center gap-2">
                      <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                      {entry.path}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {entry.sizeBytes === null ? null : formatLibrarySize(entry.sizeBytes)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
      {entries.length > PREVIEW_MAX_ROWS ? (
        <p className="shrink-0 text-center text-xs text-muted-foreground">
          {t("Showing the first {count} entries.", { count: formatNumber(PREVIEW_MAX_ROWS) })}
        </p>
      ) : null}
    </div>
  );
}
