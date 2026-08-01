"use client";

import * as React from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listContacts, AuthRequiredError, type ApiContact } from "@/lib/api";

/* ------------------------------------------------------------------ *
 * Contacts — the parties documents are collected FROM, across all of
 * their cases.
 *
 * The case count is the point. A borrower who has been here before has
 * documents already on file, and a reusable one (PAN, incorporation
 * certificate) should be answered once rather than re-collected — this
 * is the screen where "have we dealt with them before?" is answerable.
 * ------------------------------------------------------------------ */

function when(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export default function ContactsPage() {
  const [rows, setRows] = React.useState<ApiContact[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const [refreshing, setRefreshing] = React.useState(false);

  const load = React.useCallback(async () => {
    setRefreshing(true);
    try {
      setRows(await listContacts());
      setError(null);
    } catch (e) {
      if (e instanceof AuthRequiredError) return;
      setError(e instanceof Error ? e.message : "Couldn't load contacts.");
    } finally {
      setRefreshing(false);
    }
  }, []);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !rows) return rows ?? [];
    return rows.filter((c) =>
      [c.name, c.organisation, c.email, c.phone]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [rows, query]);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Contacts</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Everyone this workspace collects documents from, and how many cases they have.
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void load()} disabled={refreshing}>
          <Icon name="refresh" size={15} className={refreshing ? "animate-spin" : undefined} />
          Refresh
        </Button>
      </div>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      ) : null}

      <Card className="gap-0 overflow-hidden py-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b p-4">
          <div className="relative min-w-0 flex-1 sm:max-w-sm">
            <Icon
              name="search"
              size={16}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, organisation, email or phone…"
              className="pl-8"
            />
          </div>
          {rows ? (
            <span className="text-sm tabular-nums text-muted-foreground">
              {filtered.length} of {rows.length}
            </span>
          ) : null}
        </div>

        {rows === null ? (
          <div className="flex flex-col gap-2 p-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center">
            <div className="text-sm font-medium">
              {rows.length === 0 ? "No contacts yet" : "Nothing matches that search"}
            </div>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              {rows.length === 0
                ? "A contact is created with the first case opened for them."
                : "Try a different name, email or phone number."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead className="text-right">Cases</TableHead>
                  <TableHead>Most recent</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                          {initials(c.name)}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate font-medium">{c.name}</div>
                          {c.organisation ? (
                            <div className="truncate text-xs text-muted-foreground">
                              {c.organisation}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </TableCell>
                    {/* Routing keys — how anything this contact sends finds its
                        case. An absent one is worth seeing, not hiding. */}
                    <TableCell className="text-sm">
                      {c.email ?? <span className="text-muted-foreground">— none</span>}
                    </TableCell>
                    <TableCell className="text-sm">
                      {c.phone ?? <span className="text-muted-foreground">— none</span>}
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant="outline" className="tabular-nums">
                        {c.caseCount}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {when(c.lastCaseAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}
