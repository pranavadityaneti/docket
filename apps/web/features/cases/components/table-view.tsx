"use client";

import {
  SelectCheckbox,
  SelectionBar,
  useSelection,
  type CsvColumn,
} from "@/components/shared/bulk-select";
import { ExportDownloadMenu } from "@/components/shared/export-download-menu";
import { DeleteDialog, type DeleteLine } from "@/components/shared/delete-dialog";
import { NoticeBanner } from "@/components/shared/page-state";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import type { ApiFieldDef, ApiStage } from "@/features/workflows/api";
import { initials, plural } from "@/lib/format";
import { toneClass } from "@/lib/tones";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { cellValue, type Lead, type Stage } from "./types";

function CaseRowActions({
  lead,
  stages,
  caseLabel,
  onMoveStage,
  onDelete,
  onCopied,
}: {
  lead: Lead;
  stages: ApiStage[];
  caseLabel: string;
  onMoveStage: (leadId: string, toStageId: string, toStageName: Stage) => void;
  onDelete: (leadId: string) => void;
  onCopied: (reference: string) => void;
}) {
  const router = useRouter();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground"
            aria-label={`${caseLabel} actions`}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          />
        }
      >
        <Icon name="more_horiz" size={18} />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-48 rounded-[12px]"
        onClick={(event) => event.stopPropagation()}
      >
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => router.push(`/cases/${lead.id}`)}>
            Open
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(lead.reference);
                onCopied(lead.reference);
              } catch {
                onCopied("");
              }
            }}
          >
            Copy reference
          </DropdownMenuItem>
          {stages.length > 0 ? (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Move to stage</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-64 min-w-44 overflow-y-auto rounded-[12px]">
                {stages.map((stage) => {
                  const isCurrent = stage.name === lead.stage;
                  return (
                    <DropdownMenuItem
                      key={stage.id}
                      disabled={isCurrent}
                      onClick={() => {
                        if (isCurrent) return;
                        onMoveStage(lead.id, stage.id, stage.name as Stage);
                      }}
                    >
                      <span className="flex-1 truncate">{stage.name}</span>
                      {isCurrent ? (
                        <Icon name="check" size={14} className="text-primary" />
                      ) : null}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => onDelete(lead.id)}
          >
            Delete
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AllCasesView({
  leads,
  onRefresh,
  subjectLabel,
  caseLabel,
  fields,
  stages,
  onMoveStage,
}: {
  leads: Lead[];
  onRefresh: () => void;
  subjectLabel: string;
  caseLabel: string;
  fields: ApiFieldDef[];
  stages: ApiStage[];
  onMoveStage: (leadId: string, toStageId: string, toStageName: Stage) => void;
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

  const exportKind = plural(caseLabel).toLowerCase();
  const exportTitle = `${plural(caseLabel)} export`;

  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [deleteLines, setDeleteLines] = React.useState<DeleteLine[]>([]);
  const [previewing, setPreviewing] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  async function openDelete(ids: string[]) {
    if (ids.length === 0) return;
    setDeleteLines([]);
    setPreviewing(true);
    setDeleteOpen(true);
    setDeleteError(null);
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
    <Card className="gap-0 overflow-hidden py-0">
      <NoticeBanner>{notice}</NoticeBanner>
      <div className="flex flex-col gap-2 border-b p-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Icon
            name="search"
            size={18}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search ${plural(caseLabel).toLowerCase()}…`}
            className="pl-8"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ExportDownloadMenu
            rows={filtered}
            columns={csvColumns}
            kind={exportKind}
            title={exportTitle}
            disabled={filtered.length === 0}
          />
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={onRefresh}
          >
            <Icon name="refresh" size={16} /> Refresh
          </Button>
        </div>
      </div>

      <SelectionBar
        count={selection.count}
        noun={caseLabel.toLowerCase()}
        onClear={selection.clear}
      >
        <ExportDownloadMenu
          rows={filtered.filter((lead) => selection.isSelected(lead.id))}
          columns={csvColumns}
          kind={exportKind}
          title={exportTitle}
          size="sm"
          label="Download"
        />
        <Button
          size="sm"
          variant="destructive"
          className="gap-1.5"
          onClick={() =>
            void openDelete(
              filtered
                .filter((lead) => selection.isSelected(lead.id))
                .map((lead) => lead.id),
            )
          }
        >
          <Icon name="delete" size={14} /> Delete
        </Button>
      </SelectionBar>

      {filtered.length === 0 ? (
        <div className="p-10 text-center">
          <div className="text-sm font-medium">
            No {plural(caseLabel).toLowerCase()} match your search
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {query.trim()
              ? `Nothing found for “${query.trim()}”. Try a name, company or reference.`
              : `There are no ${plural(caseLabel).toLowerCase()} in this workflow yet.`}
          </p>
        </div>
      ) : (
        <>
          <ul className="divide-y md:hidden">
            {filtered.map((lead) => {
              const headline = fields[0];
              const headlineValue = headline
                ? cellValue(lead.data, headline)
                : "";
              const showHeadline =
                headline &&
                headlineValue !== "" &&
                headlineValue !== "-";
              return (
                <li key={lead.id}>
                  <div className="flex gap-3 px-3 py-3">
                    <div className="pt-1">
                      <SelectCheckbox
                        checked={selection.isSelected(lead.id)}
                        onChange={() => selection.toggle(lead.id)}
                        label={`Select ${lead.reference}`}
                      />
                    </div>
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => router.push(`/cases/${lead.id}`)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="min-w-0 truncate font-medium">
                          {lead.name}
                        </span>
                        <Badge
                          variant="outline"
                          className={`${toneClass(lead.stageTone)} shrink-0 whitespace-nowrap`}
                        >
                          {lead.stage}
                        </Badge>
                      </div>
                      <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                        {lead.reference}
                      </div>
                      {showHeadline ? (
                        <div className="mt-1 truncate text-xs text-muted-foreground">
                          {headlineValue}
                        </div>
                      ) : null}
                    </button>
                    <div className="shrink-0 self-start">
                      <CaseRowActions
                        lead={lead}
                        stages={stages}
                        caseLabel={caseLabel}
                        onMoveStage={onMoveStage}
                        onDelete={(id) => void openDelete([id])}
                        onCopied={(reference) =>
                          setNotice(
                            reference
                              ? `Copied ${reference}`
                              : "Couldn't copy reference.",
                          )
                        }
                      />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="hidden overflow-x-auto md:block">
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
                {filtered.map((lead) => (
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
                      <CaseRowActions
                        lead={lead}
                        stages={stages}
                        caseLabel={caseLabel}
                        onMoveStage={onMoveStage}
                        onDelete={(id) => void openDelete([id])}
                        onCopied={(reference) =>
                          setNotice(
                            reference
                              ? `Copied ${reference}`
                              : "Couldn't copy reference.",
                          )
                        }
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t p-3">
        <span className="text-sm text-muted-foreground">
          Showing {filtered.length} of {leads.length}
        </span>
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
        <div className="border-t bg-danger-muted px-4 py-2 text-sm text-danger">
          {deleteError}
        </div>
      ) : null}
    </Card>
  );
}
