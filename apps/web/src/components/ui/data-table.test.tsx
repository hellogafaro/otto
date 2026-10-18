import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { DataTable } from "./data-table";

const rows = [
  { id: "a", title: "Draft launch checklist" },
  { id: "b", title: "Review analytics events" },
];

describe("DataTable row highlight", () => {
  it("marks every row with its key and washes only the held row", () => {
    const html = renderToStaticMarkup(
      <DataTable
        rows={rows}
        columns={[{ id: "title", type: "title", cell: (row) => row.title }]}
        getRowKey={(row) => row.id}
        getRowLabel={(row) => row.title}
        onRowClick={() => undefined}
        highlightedKey="b"
      />,
    );

    expect(html).toContain('data-row-key="a"');
    expect(html).toContain('data-row-key="b"');
    const held = /[\s"]bg-foreground\/\[0\.035\]/g;

    expect(html.match(held)).toHaveLength(1);
    expect(html.search(held)).toBeGreaterThan(html.indexOf('data-row-key="b"'));
  });
});
