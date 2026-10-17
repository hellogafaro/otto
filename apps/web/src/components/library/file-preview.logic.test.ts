import JSZip from "jszip";
import * as XLSX from "xlsx";
import { describe, expect, it } from "vite-plus/test";

import {
  type PreviewSheet,
  PREVIEW_MAX_COLUMNS,
  PREVIEW_MAX_LINES,
  PREVIEW_MAX_ROWS,
  previewSheets,
  previewText,
  previewZipEntries,
} from "./file-preview.logic";

const bytesOf = (text: string) => new TextEncoder().encode(text).buffer;

const values = (sheet: PreviewSheet | undefined) =>
  sheet?.rows.map((row) => row.cells.map((cell) => cell.value));

describe("file previews", () => {
  it("reads a CSV verbatim as UTF-8 rows", async () => {
    const [sheet] = await previewSheets(bytesOf("Name,Code,City\nZoë,007,Málaga\n李雷,1/2,北京\n"));

    expect(values(sheet)).toEqual([
      ["Name", "Code", "City"],
      ["Zoë", "007", "Málaga"],
      ["李雷", "1/2", "北京"],
    ]);
    expect(sheet?.capped).toBe(false);
  });

  it("caps a large CSV at the first rows and columns", async () => {
    const line = Array.from({ length: PREVIEW_MAX_COLUMNS + 5 }, (_, index) => index).join(",");
    const csv = Array.from({ length: PREVIEW_MAX_ROWS + 20 }, () => line).join("\n");
    const [sheet] = await previewSheets(bytesOf(csv));

    expect(sheet?.rows).toHaveLength(PREVIEW_MAX_ROWS);
    expect(sheet?.rows[0]?.cells).toHaveLength(PREVIEW_MAX_COLUMNS);
    expect(sheet?.rows[0]?.cells.at(-1)?.column).toBe("AX");
    expect(sheet?.capped).toBe(true);
  });

  it("reads every sheet of an Excel workbook", async () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["Month", "Revenue"],
        ["Jan", 1200],
      ]),
      "Q1",
    );
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Notes"]]), "Notes");
    const bytes: ArrayBuffer = XLSX.write(workbook, { type: "array", bookType: "xlsx" });

    const sheets = await previewSheets(bytes);

    expect(sheets.map((sheet) => sheet.name)).toEqual(["Q1", "Notes"]);
    expect(values(sheets[0])).toEqual([
      ["Month", "Revenue"],
      ["Jan", "1200"],
    ]);
  });

  it("lists a zip's entries in path order with their sizes", async () => {
    const zip = new JSZip();
    zip.file("readme.txt", "hello");
    zip.folder("docs")?.file("guide.md", "# Guide\n");
    const bytes = await zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });

    expect(await previewZipEntries(bytes)).toEqual([
      { path: "docs/", folder: true, sizeBytes: null },
      { path: "docs/guide.md", folder: false, sizeBytes: 8 },
      { path: "readme.txt", folder: false, sizeBytes: 5 },
    ]);
  });

  it("caps long text at the first lines", () => {
    const text = Array.from({ length: PREVIEW_MAX_LINES + 3 }, (_, index) => `line ${index}`);

    expect(previewText(bytesOf("short\ntext")).capped).toBe(false);
    expect(previewText(bytesOf(text.join("\n"))).text.split("\n")).toHaveLength(PREVIEW_MAX_LINES);
  });
});
