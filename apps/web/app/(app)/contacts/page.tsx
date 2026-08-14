"use client";

import {
  SelectCheckbox,
  SelectionBar,
  useSelection,
  type CsvColumn,
} from "@/components/shared/bulk-select";
import { DeleteDialog, type DeleteLine } from "@/components/shared/delete-dialog";
import { ExportDownloadMenu } from "@/components/shared/export-download-menu";
import { ListPager } from "@/components/shared/list-pager";
import { ErrorBanner } from "@/components/shared/page-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ApiContact } from "@/features/contacts/api";
import { deleteContacts, listContacts, previewDeleteContacts } from "@/features/contacts/api";
import { useAsyncResource } from "@/hooks/use-async-resource";
import { formatDate, initials } from "@/lib/format";
import { AuthRequiredError } from "@/lib/http";
import * as React from "react";

const PAGE_SIZE = 50;

export default function ContactsPage() {
  const [offset, setOffset] = React.useState(0);
  const [query, setQuery] = React.useState("");
  const [actionError, setActionError] = React.useState<string | null>(null);

  const loader = React.useCallback(
    () => listContacts({ limit: PAGE_SIZE, offset }),
    [offset],
  );
  const { data: page, error, loading, reload } = useAsyncResource(
    loader,
    [offset],
    { fallbackError: "Couldn't load contacts." },
  );

  const rows = page?.items ?? null;
  const total = page?.total ?? 0;

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !rows) return rows ?? [];
    return rows.filter((c) =>
      [c.name, c.organisation, c.email, c.phone]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [rows, query]);

  const visibleIds = React.useMemo(() => filtered.map((c) => c.id), [filtered]);
  const sel = useSelection(visibleIds);

  const csvColumns: CsvColumn<ApiContact>[] = [
    { header: "Name", value: (c) => c.name },
    { header: "Organisation", value: (c) => c.organisation },
    { header: "Email", value: (c) => c.email },
    { header: "Phone", value: (c) => c.phone },
    { header: "Cases", value: (c) => c.caseCount },
    { header: "Most recent case", value: (c) => (c.lastCaseAt ? formatDate(c.lastCaseAt) : "") },
  ];

  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [deleteLines, setDeleteLines] = React.useState<DeleteLine[]>([]);
  const [previewing, setPreviewing] = React.useState(false);

  async function openDelete() {
    const ids = filtered.filter((c) => sel.isSelected(c.id)).map((c) => c.id);
    if (ids.length === 0) return;
    setDeleteLines([]);
    setPreviewing(true);
    setDeleteOpen(true);
    try {
      const preview = await previewDeleteContacts(ids);
      setDeleteLines(
        preview.map((p) => ({
          id: p.id,
          label: p.name,
          detail: p.caseCount === 0 ? "no cases" : undefined,
          blocked:
            p.caseCount > 0
              ? `Still has ${p.caseCount} case${p.caseCount === 1 ? "" : "s"} - delete or reassign those first`
              : undefined,
        })),
      );
    } catch (e) {
      if (e instanceof AuthRequiredError) return;
      setActionError(e instanceof Error ? e.message : "Couldn't check those contacts.");
      setDeleteOpen(false);
    } finally {
      setPreviewing(false);
    }
  }

  async function confirmDelete() {
    const ids = deleteLines.filter((l) => !l.blocked).map((l) => l.id);
    try {
      const result = await deleteContacts(ids);
      sel.clear();
      setDeleteOpen(false);
      if (result.refused.length > 0) {
        setActionError(
          `${result.refused.length} contact${result.refused.length === 1 ? "" : "s"} could not be deleted.`,
        );
      }
      reload();
    } catch (e) {
      if (e instanceof AuthRequiredError) return;
      setActionError(e instanceof Error ? e.message : "Couldn't delete those contacts.");
      setDeleteOpen(false);
    }
  }

  return (
    <div className="flex w-full flex-col gap-5">
      <div className="space-y-1">
        <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
          Directory
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-balance">Contacts</h1>
        <p className="text-sm text-muted-foreground">
          People and organisations documents are collected from, across every case.
        </p>
      </div>

      {error ? <ErrorBanner>{error}</ErrorBanner> : null}
      {actionError ? (
        <ErrorBanner>
          <div className="flex items-center justify-between gap-2">
            <span>{actionError}</span>
            <button type="button" onClick={() => setActionError(null)} aria-label="Dismiss">
              <Icon name="close" size={16} />
            </button>
          </div>
        </ErrorBanner>
      ) : null}

      <Card className="gap-0 overflow-hidden py-0">
        <div className="flex flex-col gap-2 border-b p-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="relative min-w-0 flex-1">
            <Icon
              name="search"
              size={18}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, org, email or phone..."
              className="pl-8"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ExportDownloadMenu
              rows={filtered}
              columns={csvColumns}
              kind="contacts"
              title="Contacts export"
              disabled={filtered.length === 0}
            />
          </div>
        </div>

        <SelectionBar count={sel.count} noun="contact" onClear={sel.clear}>
          <ExportDownloadMenu
            rows={filtered.filter((c) => sel.isSelected(c.id))}
            columns={csvColumns}
            kind="contacts"
            title="Contacts export"
            label="Download"
          />
          <Button
            size="sm"
            variant="destructive"
            className="gap-1.5"
            onClick={() => void openDelete()}
          >
            <Icon name="delete" size={14} /> Delete
          </Button>
        </SelectionBar>

        {loading && !rows ? (
          <div className="flex flex-col gap-2 p-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="w-full" />
            ))}
          </div>
        ) : !rows ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            Couldn&rsquo;t load contacts.
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center">
            <div className="text-sm font-medium">
              {rows.length === 0 ? "No contacts yet" : "Nothing matches that search"}
            </div>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              {rows.length === 0
                ? "A contact is created with the first case opened for them."
                : "Try a different name, email or phone number on this page."}
            </p>
          </div>
        ) : (
          <>
            <ul className="divide-y md:hidden">
              {filtered.map((c) => (
                <li key={c.id} className="flex gap-3 px-3 py-3">
                  <div className="pt-1">
                    <SelectCheckbox
                      checked={sel.isSelected(c.id)}
                      onChange={() => sel.toggle(c.id)}
                      label={`Select ${c.name}`}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2.5">
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                        {initials(c.name)}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate font-medium leading-5">{c.name}</div>
                        {c.organisation ? (
                          <div className="truncate text-xs leading-4 text-muted-foreground">
                            {c.organisation}
                          </div>
                        ) : null}
                      </div>
                    </div>
                    <div className="mt-2 space-y-0.5 text-sm text-muted-foreground">
                      <div className="truncate">{c.email ?? "No email"}</div>
                      <div className="truncate">{c.phone ?? "No phone"}</div>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="outline" className="tabular-nums">
                        {c.caseCount} case{c.caseCount === 1 ? "" : "s"}
                      </Badge>
                      <span>Recent {formatDate(c.lastCaseAt)}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10 pl-4">
                      <SelectCheckbox
                        checked={sel.allSelected}
                        indeterminate={sel.someSelected}
                        onChange={sel.toggleAll}
                        label="Select all contacts shown"
                      />
                    </TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead className="text-right">Cases</TableHead>
                    <TableHead className="pr-4">Most recent</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((c) => (
                    <TableRow key={c.id} className="h-[58px] [&_td]:py-0">
                      <TableCell className="w-10 pl-4">
                        <SelectCheckbox
                          checked={sel.isSelected(c.id)}
                          onChange={() => sel.toggle(c.id)}
                          label={`Select ${c.name}`}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex h-full items-center gap-2.5">
                          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                            {initials(c.name)}
                          </div>
                          <div className="min-w-0">
                            <div className="truncate font-medium leading-5">{c.name}</div>
                            {c.organisation ? (
                              <div className="truncate text-xs leading-4 text-muted-foreground">
                                {c.organisation}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {c.email ?? <span className="text-muted-foreground">- none</span>}
                      </TableCell>
                      <TableCell className="text-sm">
                        {c.phone ?? <span className="text-muted-foreground">- none</span>}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant="outline" className="tabular-nums">
                          {c.caseCount}
                        </Badge>
                      </TableCell>
                      <TableCell className="pr-4 text-sm text-muted-foreground">
                        {formatDate(c.lastCaseAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}

        <ListPager
          total={total}
          limit={PAGE_SIZE}
          offset={offset}
          onPage={(next) => {
            setQuery("");
            setOffset(next);
          }}
          noun="contacts"
        />
      </Card>

      <DeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete ${deleteLines.length === 1 ? "contact" : "contacts"}?`}
        loading={previewing}
        lines={deleteLines}
        consequences={
          <>
            The contact is hidden from every list. Their past cases and documents are{" "}
            <strong>not</strong> deleted, and nothing they have already sent is lost - but any
            future email or WhatsApp from them will no longer be matched to them automatically.
          </>
        }
        onConfirm={confirmDelete}
      />
    </div>
  );
}
