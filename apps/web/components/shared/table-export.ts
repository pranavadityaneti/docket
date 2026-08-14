"use client";

/**
 * Table downloads: CSV, JSON, PDF. Same column shape as CSV so Cases and
 * Contacts (and any future list) share one path.
 */
import {
  csvFilename,
  downloadCsv,
  toCsv,
  type CsvColumn,
} from "@/components/shared/bulk-select";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

export type ExportFormat = "csv" | "json" | "pdf";
export type ExportColumn<T> = CsvColumn<T>;

export const EXPORT_FORMATS: {
  id: ExportFormat;
  label: string;
  ext: string;
}[] = [
  { id: "csv", label: "CSV", ext: "csv" },
  { id: "pdf", label: "PDF", ext: "pdf" },
  { id: "json", label: "JSON", ext: "json" },
];

/** `docket-cases-2026-08-01.csv` — any extension. */
export function exportFilename(kind: string, ext: ExportFormat | string): string {
  const base = csvFilename(kind).replace(/\.csv$/, "");
  return `${base}.${ext}`;
}

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

/** Rows as header-keyed objects (pretty-printed). */
export function toExportJson<T>(rows: T[], columns: ExportColumn<T>[]): string {
  const data = rows.map((row) => {
    const obj: Record<string, unknown> = {};
    for (const col of columns) {
      const v = col.value(row);
      obj[col.header] = v === null || v === undefined ? null : v;
    }
    return obj;
  });
  return `${JSON.stringify(data, null, 2)}\n`;
}

export function toExportPdfBlob<T>(
  title: string,
  rows: T[],
  columns: ExportColumn<T>[],
): Blob {
  const headers = columns.map((c) => c.header);
  const body = rows.map((row) => columns.map((c) => cellText(c.value(row))));
  const wide = headers.length > 6;
  const doc = new jsPDF({
    orientation: wide ? "landscape" : "portrait",
    unit: "pt",
    format: "a4",
  });
  doc.setFontSize(12);
  doc.setTextColor(40, 40, 40);
  doc.text(title, 40, 40);
  autoTable(doc, {
    head: [headers],
    body,
    startY: 52,
    margin: { left: 40, right: 40 },
    styles: {
      fontSize: 8,
      cellPadding: 4,
      overflow: "linebreak",
      valign: "top",
    },
    headStyles: {
      fillColor: [155, 0, 8],
      textColor: 255,
      fontStyle: "bold",
    },
    alternateRowStyles: { fillColor: [250, 248, 246] },
  });
  return doc.output("blob");
}

export function downloadTableExport<T>(opts: {
  kind: string;
  format: ExportFormat;
  rows: T[];
  columns: ExportColumn<T>[];
  title?: string;
}) {
  const { kind, format, rows, columns, title } = opts;
  const label = title ?? kind;
  if (format === "csv") {
    downloadCsv(exportFilename(kind, "csv"), toCsv(rows, columns));
    return;
  }
  if (format === "json") {
    downloadBlob(
      exportFilename(kind, "json"),
      new Blob([toExportJson(rows, columns)], {
        type: "application/json;charset=utf-8",
      }),
    );
    return;
  }
  downloadBlob(
    exportFilename(kind, "pdf"),
    toExportPdfBlob(label, rows, columns),
  );
}
