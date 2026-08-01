"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

/* ------------------------------------------------------------------ *
 * Selecting rows, and doing something with the selection.
 *
 * Shared so every list behaves the same way: the same checkbox, the same
 * "N selected" bar, the same CSV. A list where select-all means "this
 * page" on one screen and "everything" on another is a list people stop
 * trusting the moment they use it to delete something.
 * ------------------------------------------------------------------ */

/**
 * Selection over a set of ids.
 *
 * Selection is pruned to the ids currently on screen: filter a list down,
 * and rows you can no longer see stop being selected. Acting on invisible
 * rows is exactly how someone deletes something they never looked at.
 */
export function useSelection(visibleIds: string[]) {
  const [selected, setSelected] = React.useState<Set<string>>(new Set());

  // Narrowed at RENDER, not corrected afterwards in an effect: the selection
  // a caller can act on is always the intersection with what is on screen, so
  // there is never a moment where a hidden row counts as selected.
  const visible = React.useMemo(() => {
    const allowed = new Set(visibleIds);
    return new Set([...selected].filter((id) => allowed.has(id)));
  }, [selected, visibleIds]);

  const toggle = React.useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = React.useCallback(() => {
    setSelected((prev) => (prev.size === visibleIds.length ? new Set() : new Set(visibleIds)));
  }, [visibleIds]);

  const clear = React.useCallback(() => setSelected(new Set()), []);

  return {
    /** Only ever the rows currently on screen. */
    selected: visible,
    count: visible.size,
    isSelected: (id: string) => visible.has(id),
    allSelected: visibleIds.length > 0 && visible.size === visibleIds.length,
    someSelected: visible.size > 0 && visible.size < visibleIds.length,
    toggle,
    toggleAll,
    clear,
  };
}

export function SelectCheckbox({
  checked,
  indeterminate,
  onChange,
  label,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  label: string;
}) {
  const ref = React.useRef<HTMLInputElement>(null);
  // `indeterminate` is a DOM property with no HTML attribute, so it can only
  // be set imperatively — this is the one legitimate ref write in the file.
  React.useEffect(() => {
    if (ref.current) ref.current.indeterminate = Boolean(indeterminate) && !checked;
  }, [indeterminate, checked]);

  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={label}
      checked={checked}
      onChange={onChange}
      // Stops a checkbox inside a clickable row from also opening the row.
      onClick={(e) => e.stopPropagation()}
      className="h-4 w-4 cursor-pointer rounded border-input accent-primary"
    />
  );
}

/**
 * The bar that appears once something is selected. Actions are passed in
 * rather than baked here: what you may do with contacts is not what you may
 * do with cases.
 */
export function SelectionBar({
  count,
  noun,
  onClear,
  children,
}: {
  count: number;
  /** Singular noun for the row type — "contact", "case". */
  noun: string;
  onClear: () => void;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 border-b bg-muted/50 px-4 py-2.5">
      <span className="text-sm font-medium tabular-nums">
        {count} {noun}
        {count === 1 ? "" : "s"} selected
      </span>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {children}
        <Button size="sm" variant="ghost" className="h-8 gap-1" onClick={onClear}>
          <Icon name="close" size={14} /> Clear
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------- CSV ------------------------------- */

/**
 * One CSV cell.
 *
 * Quotes anything containing a delimiter, quote or newline, and doubles inner
 * quotes — the actual CSV rule, not "wrap it in quotes and hope". A leading
 * =, +, - or @ is prefixed with a single quote: spreadsheets treat those as
 * formulas, and a borrower's name is not a formula.
 */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export type CsvColumn<T> = { header: string; value: (row: T) => unknown };

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const lines = [columns.map((c) => csvCell(c.header)).join(",")];
  for (const row of rows) lines.push(columns.map((c) => csvCell(c.value(row))).join(","));
  // CRLF: what Excel expects, and harmless everywhere else.
  return lines.join("\r\n");
}

/** Trigger a download of `content` as `filename`. Client-side only. */
export function downloadCsv(filename: string, content: string) {
  // The BOM is what makes Excel read this as UTF-8 — without it, a name in
  // Devanagari or a rupee sign arrives as mojibake.
  const blob = new Blob(["﻿" + content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** `docket-contacts-2026-08-01.csv` */
export function csvFilename(kind: string): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `docket-${kind}-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.csv`;
}
