import { describe, expect, it } from "vitest";
import {
  exportFilename,
  toExportJson,
  toExportPdfBlob,
} from "@/components/shared/table-export";

describe("table export helpers", () => {
  const columns = [
    { header: "Name", value: (r: { name: string; n: number }) => r.name },
    { header: "Count", value: (r: { name: string; n: number }) => r.n },
  ];

  it("builds dated filenames per extension", () => {
    expect(exportFilename("cases", "csv")).toMatch(
      /^docket-cases-\d{4}-\d{2}-\d{2}\.csv$/,
    );
    expect(exportFilename("contacts", "pdf")).toMatch(
      /^docket-contacts-\d{4}-\d{2}-\d{2}\.pdf$/,
    );
    expect(exportFilename("cases", "json")).toMatch(
      /^docket-cases-\d{4}-\d{2}-\d{2}\.json$/,
    );
  });

  it("serialises rows as header-keyed JSON", () => {
    const json = toExportJson([{ name: "Ada", n: 2 }], columns);
    expect(JSON.parse(json)).toEqual([{ Name: "Ada", Count: 2 }]);
  });

  it("builds a real PDF blob with a table", async () => {
    const blob = toExportPdfBlob(
      "Cases export",
      [{ name: "Ada", n: 2 }],
      columns,
    );
    expect(blob.type).toContain("pdf");
    expect(blob.size).toBeGreaterThan(100);
    const head = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
    expect(String.fromCharCode(...head)).toBe("%PDF-");
  });
});
