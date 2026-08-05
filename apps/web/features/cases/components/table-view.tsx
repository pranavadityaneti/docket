"use client";

import {
  csvFilename,
  downloadCsv,
  SelectCheckbox,
  SelectionBar,
  toCsv,
  useSelection,
  type CsvColumn,
} from "@/components/shared/bulk-select";
import { DeleteDialog, type DeleteLine } from "@/components/shared/delete-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AuthRequiredError } from "@/lib/http";
import { deleteCases, previewDeleteCases } from "@/features/cases/api";
import type { ApiFieldDef } from "@/features/workflows/api";
import { initials, plural } from "@/lib/format";
import { toneClass } from "@/lib/tones";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { cellValue, type Lead } from "./types";

export function AllCasesView({
  leads,
  onRefresh,
  subjectLabel,
  caseLabel,
  fields,
}: {
  leads: Lead[];
  onRefresh: () => void;
  subjectLabel: string;
  caseLabel: string;
  fields: ApiFieldDef[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlQuery = searchParams.get("q") ?? "";
  const [query, setQuery] = React.useState(urlQuery);
  const [seededFrom, setSeededFrom] = React.useState(urlQuery);
  if (urlQuery !== seededFrom) {
    setSeededFrom(urlQuery);
    setQuery(urlQuery);
  }
  const filtered = leads.filter((lead) => {
    const queryValue = query.trim().toLowerCase();
    if (!queryValue) return true;
    return `${lead.name} ${lead.company} ${lead.reference}`
      .toLowerCase()
      .includes(queryValue);
  });

  const visibleIds = React.useMemo(
    () => filtered.map((lead) => lead.id),
    [filtered],
  );
  const selection = useSelection(visibleIds);
  const csvColumns: CsvColumn<Lead>[] = React.useMemo(
    () => [
      { header: subjectLabel, value: (lead) => lead.name },
      { header: "Organisation", value: (lead) => lead.company },
      { header: "Reference", value: (lead) => lead.reference },
      { header: "Stage", value: (lead) => lead.stage },
      { header: "Source", value: (lead) => lead.source },
      { header: "Last activity", value: (lead) => lead.activity },
      ...fields.map((field) => ({
        header: field.label,
        value: (lead: Lead) => {
          const raw = lead.data?.[field.field_key];
          return raw === null || raw === undefined ? "" : raw;
        },
      })),
    ],
    [fields, subjectLabel],
  );

  function exportCsv(rows: Lead[]) {
    downloadCsv(
      csvFilename(plural(caseLabel).toLowerCase()),
      toCsv(rows, csvColumns),
    );
  }

  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [deleteLines, setDeleteLines] = React.useState<DeleteLine[]>([]);
  const [previewing, setPreviewing] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);

  async function openDelete() {
    const ids = filtered
      .filter((lead) => selection.isSelected(lead.id))
      .map((lead) => lead.id);
    if (ids.length === 0) return;
    setDeleteLines([]);
    setPreviewing(true);
    setDeleteOpen(true);
    try {
      const preview = await previewDeleteCases(ids);
      setDeleteLines(
        preview.cases.map((caseItem) => ({
          id: caseItem.id,
          label: `${caseItem.subjectName ?? "Unnamed"} · ${caseItem.reference}`,
          detail:
            caseItem.documentCount === 0
              ? "no documents"
              : `${caseItem.documentCount} document${
                  caseItem.documentCount === 1 ? "" : "s"
                }`,
        })),
      );
    } catch (error) {
      if (error instanceof AuthRequiredError) return;
      setDeleteError(
        error instanceof Error ? error.message : "Couldn't check those cases.",
      );
      setDeleteOpen(false);
    } finally {
      setPreviewing(false);
    }
  }

  async function confirmDelete() {
    await deleteCases(
      deleteLines.filter((line) => !line.blocked).map((line) => line.id),
    );
    selection.clear();
    onRefresh();
  }

  return (
    <Card className="gap-0 overflow-hidden rounded-[12px] py-0">
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        <div className="relative min-w-0 flex-1">
          <Icon
            name="search"
            size={18}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search ${plural(caseLabel).toLowerCase()} by name, company or reference…`}
            className="pl-8"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={filtered.length === 0}
          onClick={() => exportCsv(filtered)}
        >
          <Icon name="download" size={16} /> Download
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={onRefresh}
        >
          <Icon name="refresh" size={16} /> Refresh
        </Button>
      </div>

      <SelectionBar
        count={selection.count}
        noun={caseLabel.toLowerCase()}
        onClear={selection.clear}
      >
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={() =>
            exportCsv(
              filtered.filter((lead) => selection.isSelected(lead.id)),
            )
          }
        >
          <Icon name="download" size={14} /> Download CSV
        </Button>
        <Button
          size="sm"
          variant="destructive"
          className="gap-1.5"
          onClick={() => void openDelete()}
        >
          <Icon name="delete" size={14} /> Delete
        </Button>
      </SelectionBar>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 pl-4">
                <SelectCheckbox
                  checked={selection.allSelected}
                  indeterminate={selection.someSelected}
                  onChange={selection.toggleAll}
                  label={`Select all ${plural(caseLabel).toLowerCase()} shown`}
                />
              </TableHead>
              <TableHead>{subjectLabel}</TableHead>
              {fields.map((field) => (
                <TableHead key={field.field_key}>{field.label}</TableHead>
              ))}
              <TableHead>Source</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead className="pr-4 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6 + fields.length}
                  className="py-12 text-center"
                >
                  <div className="text-sm font-medium">
                    No {plural(caseLabel).toLowerCase()} match your search
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {query.trim()
                      ? `Nothing found for “${query.trim()}”. Try a name, company or reference.`
                      : `There are no ${plural(caseLabel).toLowerCase()} in this workflow yet.`}
                  </p>
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((lead) => (
                <TableRow
                  key={lead.id}
                  role="link"
                  tabIndex={0}
                  aria-label={`Open case ${lead.reference}`}
                  className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => router.push(`/cases/${lead.id}`)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      router.push(`/cases/${lead.id}`);
                    }
                  }}
                >
                  <TableCell className="w-10 pl-4">
                    <SelectCheckbox
                      checked={selection.isSelected(lead.id)}
                      onChange={() => selection.toggle(lead.id)}
                      label={`Select ${lead.reference}`}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{lead.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {lead.company} · {lead.reference}
                    </div>
                  </TableCell>
                  {fields.map((field) => (
                    <TableCell
                      key={field.field_key}
                      className={
                        field.field_type === "integer"
                          ? "whitespace-nowrap tabular-nums"
                          : "whitespace-nowrap text-muted-foreground"
                      }
                    >
                      {cellValue(lead.data, field)}
                    </TableCell>
                  ))}
                  <TableCell>
                    <Badge
                      variant="outline"
                      className="border-border bg-muted font-normal text-muted-foreground"
                    >
                      {lead.source}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2 whitespace-nowrap">
                      <Avatar className="size-6">
                        <AvatarFallback className="bg-secondary text-[10px]">
                          {initials(lead.owner)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-sm">{lead.owner}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={`${toneClass(lead.stageTone)} whitespace-nowrap`}
                    >
                      {lead.stage}
                    </Badge>
                  </TableCell>
                  <TableCell className="pr-4 text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-muted-foreground"
                      aria-label="Case actions"
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                    >
                      <Icon name="more_horiz" size={18} />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between border-t p-3">
        <span className="text-sm text-muted-foreground">
          Showing {filtered.length} of {leads.length}
        </span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled>
            Previous
          </Button>
          <Button variant="outline" size="sm" disabled>
            Next
          </Button>
        </div>
      </div>

      <DeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete ${
          deleteLines.length === 1
            ? caseLabel.toLowerCase()
            : plural(caseLabel).toLowerCase()
        }?`}
        loading={previewing}
        lines={deleteLines}
        consequences={
          <>
            The{" "}
            {deleteLines.length === 1
              ? caseLabel.toLowerCase()
              : plural(caseLabel).toLowerCase()}{" "}
            and every document on {deleteLines.length === 1 ? "it" : "them"}{" "}
            will be hidden from every screen, and any reply the{" "}
            {subjectLabel.toLowerCase()} sends will no longer be matched.
            Nothing is destroyed - the files, messages and history are kept, and
            we can restore {deleteLines.length === 1 ? "it" : "them"} for you.
          </>
        }
        onConfirm={confirmDelete}
      />

      {deleteError ? (
        <div className="border-t bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-950 dark:text-red-300">
          {deleteError}
        </div>
      ) : null}
    </Card>
  );
}
