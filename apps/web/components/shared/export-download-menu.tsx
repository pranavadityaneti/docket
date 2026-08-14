"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import {
  downloadTableExport,
  EXPORT_FORMATS,
  type ExportColumn,
  type ExportFormat,
} from "@/components/shared/table-export";

/**
 * Download CTA that asks for CSV / PDF / JSON before writing a file.
 */
export function ExportDownloadMenu<T>({
  rows,
  columns,
  kind,
  title,
  disabled,
  size = "sm",
  label = "Download",
}: {
  rows: T[];
  columns: ExportColumn<T>[];
  kind: string;
  title?: string;
  disabled?: boolean;
  size?: "sm" | "xs" | "default";
  label?: string;
}) {
  function onPick(format: ExportFormat) {
    if (rows.length === 0) return;
    downloadTableExport({ kind, format, rows, columns, title });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled || rows.length === 0}
        render={
          <Button
            variant="outline"
            size={size}
            className="gap-1.5"
            disabled={disabled || rows.length === 0}
          />
        }
      >
        <Icon name="download" size={size === "xs" ? 14 : 16} />
        {label}
        <Icon name="expand_more" size={14} className="opacity-70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Download as</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {EXPORT_FORMATS.map((fmt) => (
            <DropdownMenuItem
              key={fmt.id}
              onClick={() => onPick(fmt.id)}
            >
              <span className="flex-1">{fmt.label}</span>
              <span className="text-xs text-muted-foreground">.{fmt.ext}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
