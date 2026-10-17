import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

/** Otto: Bigger files skip the preview and offer Download, since a preview holds the bytes in memory. */
export const PREVIEW_MAX_BYTES = 25 * 1024 * 1024;

export const PREVIEW_MAX_ROWS = 1000;

export const PREVIEW_MAX_COLUMNS = 50;

export const PREVIEW_MAX_LINES = 10_000;

/** A row keeps its sheet row number and each cell its column letter, so both have stable keys. */
export interface PreviewSheetRow {
  readonly number: number;
  readonly cells: ReadonlyArray<{ readonly column: string; readonly value: string }>;
}

export interface PreviewSheet {
  readonly name: string;
  readonly rows: ReadonlyArray<PreviewSheetRow>;
  /** Whether rows or columns past the caps were left out. */
  readonly capped: boolean;
}

export interface PreviewZipEntry {
  readonly path: string;
  readonly folder: boolean;
  readonly sizeBytes: number | null;
}

export async function fetchPreviewBytes(url: string, signal: AbortSignal): Promise<ArrayBuffer> {
  const response = await fetch(url, { signal });

  if (!response.ok) throw new Error(`The file couldn't be fetched (${response.status}).`);

  if (Number(response.headers.get("content-length") ?? 0) > PREVIEW_MAX_BYTES) {
    throw new Error("The file is too large to preview.");
  }

  const bytes = await response.arrayBuffer();

  if (bytes.byteLength > PREVIEW_MAX_BYTES) throw new Error("The file is too large to preview.");

  return bytes;
}

export function previewText(bytes: ArrayBuffer) {
  const text = new TextDecoder().decode(bytes);
  const lines = text.split("\n");

  if (lines.length <= PREVIEW_MAX_LINES) return { text, capped: false };

  return { text: lines.slice(0, PREVIEW_MAX_LINES).join("\n"), capped: true };
}

/** Excel workbooks parse as they are; anything else is CSV text, read verbatim as UTF-8. */
export async function previewSheets(bytes: ArrayBuffer): Promise<ReadonlyArray<PreviewSheet>> {
  const XLSX = await import("xlsx");
  const head = new Uint8Array(bytes, 0, Math.min(2, bytes.byteLength));
  const zip = head[0] === 0x50 && head[1] === 0x4b;
  const compound = head[0] === 0xd0 && head[1] === 0xcf;
  const sheetRows = PREVIEW_MAX_ROWS + 1;

  const workbook =
    zip || compound
      ? XLSX.read(bytes, { type: "array", sheetRows })
      : XLSX.read(new TextDecoder().decode(bytes), { type: "string", raw: true, sheetRows });

  return workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];

    const rows = sheet
      ? XLSX.utils.sheet_to_json<ReadonlyArray<unknown>>(sheet, {
          header: 1,
          raw: false,
          defval: "",
          blankrows: false,
        })
      : [];

    return {
      name,
      rows: rows.slice(0, PREVIEW_MAX_ROWS).map((row, index) => ({
        number: index + 1,
        cells: row.slice(0, PREVIEW_MAX_COLUMNS).map((cell, column) => ({
          column: XLSX.utils.encode_col(column),
          value: String(cell ?? ""),
        })),
      })),
      capped:
        rows.length > PREVIEW_MAX_ROWS || rows.some((row) => row.length > PREVIEW_MAX_COLUMNS),
    };
  });
}

/** JSZip keeps a loaded entry's size on its private `_data`. */
const decodeZipEntrySize = Schema.decodeUnknownOption(
  Schema.Struct({ _data: Schema.Struct({ uncompressedSize: Schema.Number }) }),
);

/** A zip's entries in path order, so each folder's files follow it. */
export async function previewZipEntries(
  bytes: ArrayBuffer,
): Promise<ReadonlyArray<PreviewZipEntry>> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(bytes);

  return Object.values(zip.files)
    .map((entry) => ({
      path: entry.name,
      folder: entry.dir,
      sizeBytes: entry.dir
        ? null
        : Option.getOrNull(
            Option.map(decodeZipEntrySize(entry), (decoded) => decoded._data.uncompressedSize),
          ),
    }))
    .toSorted((left, right) => left.path.localeCompare(right.path));
}
