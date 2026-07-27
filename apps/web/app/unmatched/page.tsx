"use client";

import * as React from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  listUnmatched,
  assignUnmatched,
  discardUnmatched,
  listWorkflows,
  listCases,
  getChecklist,
  AuthRequiredError,
  type ApiUnmatchedDocument,
  type ApiWorkflow,
  type ApiCase,
  type ApiChecklistItem,
} from "@/lib/api";

/* ------------------------------------------------------------------ *
 * Needs attention — inbound documents that matched no case.
 *
 * The intake never guesses: anything it cannot place with certainty
 * lands here, bytes already safe, for a ten-second human decision.
 * Assigning files the document onto a case (optionally straight onto a
 * checklist slot); discarding records why and keeps the file for audit.
 * ------------------------------------------------------------------ */

const FIELD_CLASS =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

const CHANNEL_LABEL: Record<string, string> = { whatsapp: "WhatsApp", email: "Email" };

function when(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function size(bytes: number | null) {
  if (bytes == null) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** A case option with its workflow's name, so one list can span workflows. */
type CaseOption = ApiCase & { workflowName: string; workflowSlug: string };

function AssignDialog({
  doc,
  caseOptions,
  loadingCases,
  onCancel,
  onConfirm,
}: {
  doc: ApiUnmatchedDocument | null;
  caseOptions: CaseOption[];
  loadingCases: boolean;
  onCancel: () => void;
  onConfirm: (caseId: string, requirementId?: string) => Promise<void>;
}) {
  const [caseId, setCaseId] = React.useState("");
  const [requirementId, setRequirementId] = React.useState("");
  const [items, setItems] = React.useState<ApiChecklistItem[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Reset per document.
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCaseId("");
    setRequirementId("");
    setItems(null);
    setError(null);
  }, [doc?.id]);

  // The slot list belongs to the chosen case's checklist. Loaded on choice,
  // filtered to items that can actually take a file — offering a full slot
  // would only bounce off the API's own check.
  React.useEffect(() => {
    if (!caseId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setItems(null);
      return;
    }
    let cancelled = false;
    getChecklist(caseId)
      .then((cl) => {
        if (!cancelled) setItems(cl.items.filter((i) => i.canUpload));
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [caseId]);

  if (!doc) return null;
  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign to a case</DialogTitle>
          <DialogDescription>
            Where does <span className="font-medium">{doc.fileName}</span> belong?
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5 text-sm">
            Case
            <select
              className={FIELD_CLASS}
              value={caseId}
              onChange={(e) => {
                setCaseId(e.target.value);
                setRequirementId("");
              }}
              disabled={loadingCases}
            >
              <option value="">
                {loadingCases ? "Loading cases…" : "Choose a case…"}
              </option>
              {caseOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.subjectName ?? "Unnamed"} · {c.reference} ({c.workflowName})
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5 text-sm">
            Checklist item <span className="text-muted-foreground">(optional)</span>
            <select
              className={FIELD_CLASS}
              value={requirementId}
              onChange={(e) => setRequirementId(e.target.value)}
              disabled={!caseId || items === null}
            >
              <option value="">
                {!caseId
                  ? "Choose a case first"
                  : items === null
                    ? "Loading checklist…"
                    : "No specific item — place it later"}
              </option>
              {(items ?? []).map((i) => (
                <option key={i.requirementId} value={i.requirementId}>
                  {i.label}
                </option>
              ))}
            </select>
          </label>

          {error ? <p className="text-sm text-red-600">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            disabled={!caseId || busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onConfirm(caseId, requirementId || undefined);
              } catch (e) {
                if (e instanceof AuthRequiredError) return;
                setError(e instanceof Error ? e.message : "Couldn't assign the document.");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Assigning…" : "Assign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DiscardDialog({
  doc,
  onCancel,
  onConfirm,
}: {
  doc: ApiUnmatchedDocument | null;
  onCancel: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReason("");
    setError(null);
  }, [doc?.id]);

  if (!doc) return null;
  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Discard this file?</DialogTitle>
          <DialogDescription>
            <span className="font-medium">{doc.fileName}</span> will leave this queue. The file
            itself is kept for audit — nothing is deleted.
          </DialogDescription>
        </DialogHeader>
        <label className="flex flex-col gap-1.5 text-sm">
          Reason <span className="text-muted-foreground">(recommended)</span>
          <input
            className={FIELD_CLASS}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. spam, not for any client"
            maxLength={500}
          />
        </label>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onConfirm(reason.trim());
              } catch (e) {
                if (e instanceof AuthRequiredError) return;
                setError(e instanceof Error ? e.message : "Couldn't discard the document.");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Discarding…" : "Discard"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function UnmatchedPage() {
  const [rows, setRows] = React.useState<ApiUnmatchedDocument[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [hasData, setHasData] = React.useState(false);
  const [assigning, setAssigning] = React.useState<ApiUnmatchedDocument | null>(null);
  const [discarding, setDiscarding] = React.useState<ApiUnmatchedDocument | null>(null);
  const [caseOptions, setCaseOptions] = React.useState<CaseOption[]>([]);
  const [loadingCases, setLoadingCases] = React.useState(false);

  const refresh = React.useCallback(async () => {
    try {
      const list = await listUnmatched();
      setRows(list);
      setError(null);
      setActionError(null);
    } catch (e) {
      if (e instanceof AuthRequiredError) return;
      const msg = e instanceof Error ? e.message : "Couldn't load the queue.";
      setHasData((had) => {
        if (had) setActionError(msg);
        else setError(msg);
        return had;
      });
      return;
    } finally {
      setLoading(false);
    }
    setHasData(true);
  }, []);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  // Cases for the assign dialog span every workflow — fetched once, on the
  // first assign click, not on page load (the queue is often empty).
  const ensureCaseOptions = React.useCallback(async () => {
    if (caseOptions.length > 0 || loadingCases) return;
    setLoadingCases(true);
    try {
      const workflows: ApiWorkflow[] = await listWorkflows();
      const perWorkflow = await Promise.all(
        workflows.map(async (w) => {
          const cs = await listCases(w.slug);
          return cs.map((c) => ({ ...c, workflowName: w.name, workflowSlug: w.slug }));
        }),
      );
      setCaseOptions(perWorkflow.flat());
    } catch (e) {
      if (!(e instanceof AuthRequiredError)) {
        setActionError(e instanceof Error ? e.message : "Couldn't load cases.");
      }
    } finally {
      setLoadingCases(false);
    }
  }, [caseOptions.length, loadingCases]);

  async function confirmAssign(caseId: string, requirementId?: string) {
    const doc = assigning;
    if (!doc) return;
    const result = await assignUnmatched(doc.id, { caseId, requirementId });
    setAssigning(null);
    await refresh();
    setActionError(null);
    // A quiet confirmation with a way to go see it.
    setNotice({ text: `Filed ${doc.fileName} onto the case.`, caseId: result.caseId });
  }

  async function confirmDiscard(reason: string) {
    const doc = discarding;
    if (!doc) return;
    await discardUnmatched(doc.id, reason || undefined);
    setDiscarding(null);
    await refresh();
  }

  const [notice, setNotice] = React.useState<{ text: string; caseId: string } | null>(null);

  if (loading) {
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (error && !hasData) {
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        <Card className="flex flex-col items-center gap-3 border-dashed py-16 text-center">
          <div className="text-sm font-medium">Couldn&rsquo;t load the queue</div>
          <p className="max-w-md text-sm text-muted-foreground">{error}</p>
          <Button onClick={refresh}>Try again</Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Needs attention</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Documents that arrived by email or WhatsApp but matched no case. Route them — the
          intake never guesses.
        </p>
      </div>

      {actionError ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {actionError}
        </div>
      ) : null}

      {notice ? (
        <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/50 px-3 py-2 text-sm">
          <span>{notice.text}</span>
          <span className="flex items-center gap-3">
            <Link className="text-primary hover:underline" href={`/cases/${notice.caseId}`}>
              Open case
            </Link>
            <button
              aria-label="Dismiss"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => setNotice(null)}
            >
              <Icon name="close" size={16} />
            </button>
          </span>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 border-dashed py-16 text-center">
          <div className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Icon name="mark_email_read" size={22} />
          </div>
          <div>
            <div className="text-sm font-medium">Nothing needs attention</div>
            <p className="mt-1 text-sm text-muted-foreground">
              Every inbound document has found its case.
            </p>
          </div>
        </Card>
      ) : (
        <Card className="gap-0 overflow-hidden py-0">
          <div className="flex items-center justify-between border-b p-4">
            <div>
              <div className="font-medium">Unrouted documents</div>
              <p className="text-sm text-muted-foreground">
                Newest first. Assign files it onto a case; discard records why it was set aside.
              </p>
            </div>
            <span className="text-sm tabular-nums text-muted-foreground">
              {rows.length} file{rows.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="flex flex-col gap-1.5 p-4">
            {rows.map((d) => (
              <div
                key={d.id}
                className="flex flex-wrap items-center gap-2 rounded-md border bg-background px-3 py-2"
              >
                <Icon
                  name={d.channel === "whatsapp" ? "chat" : "mail"}
                  size={16}
                  className="shrink-0 text-muted-foreground"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{d.fileName}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {[
                      d.sender ? `from ${d.sender}` : null,
                      CHANNEL_LABEL[d.channel] ?? d.channel,
                      d.context ? `“${d.context}”` : null,
                      size(d.sizeBytes),
                      when(d.receivedAt),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
                <Badge variant="outline">Unrouted</Badge>
                <Button
                  size="sm"
                  className="gap-1.5"
                  onClick={async () => {
                    setAssigning(d);
                    await ensureCaseOptions();
                  }}
                >
                  <Icon name="assignment_turned_in" size={16} /> Assign
                </Button>
                <Button variant="outline" size="sm" onClick={() => setDiscarding(d)}>
                  Discard
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      <AssignDialog
        doc={assigning}
        caseOptions={caseOptions}
        loadingCases={loadingCases}
        onCancel={() => setAssigning(null)}
        onConfirm={confirmAssign}
      />
      <DiscardDialog
        doc={discarding}
        onCancel={() => setDiscarding(null)}
        onConfirm={confirmDiscard}
      />
    </div>
  );
}
