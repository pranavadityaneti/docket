"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Skeleton } from "@/components/ui/skeleton";
import { ListPager } from "@/components/shared/list-pager";
import { ErrorBanner, NoticeBanner } from "@/components/shared/page-state";
import { useAsyncResource } from "@/hooks/use-async-resource";
import { AuthRequiredError } from "@/lib/http";
import { listFollowUps } from "@/features/follow-ups/api";
import type { ApiFollowUp } from "@/features/follow-ups/api";
import { requestDocuments } from "@/features/case-detail/api";
import { formatDate } from "@/lib/format";
import Link from "next/link";
import * as React from "react";

/* ------------------------------------------------------------------ *
 * Follow-ups - who owes documents, and when we last asked.
 *
 * Ordered the way a person would work it: never-asked first, then
 * longest-waiting. Reminders go out on their own (every 3 days, three
 * times), so this screen exists for the cases the scheduler cannot help
 * with - nobody has ever asked, the subject is unreachable, reminders
 * are paused, or the automatic three are spent and a human must step in.
 * ------------------------------------------------------------------ */

const PAGE_SIZE = 50;

/** The one thing worth knowing about a row, in priority order. */
function statusOf(f: ApiFollowUp): { label: string; tone: string; hint: string } {
  if (f.unreachable) {
    return {
      label: "Unreachable",
      tone: "border-danger-border bg-danger-muted text-danger-muted-foreground",
      hint: "No email or phone on file - nothing can be sent.",
    };
  }
  if (f.paused) {
    return {
      label: "Paused",
      tone: "border-border bg-muted text-muted-foreground",
      hint: "Automatic reminders are off for this case.",
    };
  }
  if (f.requestsSent === 0) {
    return {
      label: "Never asked",
      tone: "border-warning-border bg-warning-muted text-warning-muted-foreground",
      hint: "No document request has gone out yet.",
    };
  }
  if (f.remindersSent >= 3) {
    return {
      label: "Reminders spent",
      tone: "border-warning-border bg-warning-muted text-warning-muted-foreground",
      hint: "All three automatic reminders have been sent. A person needs to step in.",
    };
  }
  if (f.reminderDue) {
    return {
      label: "Reminder due",
      tone: "border-sky-border bg-sky-muted text-sky-muted-foreground",
      hint: "The scheduler will send one on its next run.",
    };
  }
  return {
    label: "Waiting",
    tone: "border-border bg-muted text-muted-foreground",
    hint: "Recently asked - the next reminder is not due yet.",
  };
}

export default function FollowUpsPage() {
  const [offset, setOffset] = React.useState(0);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const loader = React.useCallback(
    () => listFollowUps({ limit: PAGE_SIZE, offset }),
    [offset],
  );
  const {
    data: page,
    error,
    loading,
    refreshing,
    reload,
  } = useAsyncResource(loader, [offset], {
    fallbackError: "Couldn't load follow-ups.",
  });
  const rows = page?.items ?? null;
  const total = page?.total ?? 0;

  /** Send a request now, from here, without opening the case. */
  async function askNow(f: ApiFollowUp) {
    setBusyId(f.caseId);
    setNotice(null);
    setActionError(null);
    try {
      const r = await requestDocuments(f.caseId);
      const ok = r.sent.filter((s) => s.ok).map((s) => s.channel);
      setNotice(
        ok.length > 0
          ? `Request sent to ${f.subjectName ?? "the subject"} via ${ok.join(" and ")}.`
          : `Nothing was sent${r.skipped ? ` - ${r.skipped}` : ""}.`,
      );
      reload();
    } catch (e) {
      if (e instanceof AuthRequiredError) return;
      setActionError(e instanceof Error ? e.message : "Couldn't send the request.");
    } finally {
      setBusyId(null);
    }
  }

  const neverAsked = (rows ?? []).filter((f) => f.requestsSent === 0).length;

  return (
    <div className="flex w-full flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
            Nudges
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-balance">Follow-ups</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Cases still owing documents - the ones waiting longest first.
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={reload} disabled={loading || refreshing}>
          <Icon name="refresh" size={15} className={refreshing ? "animate-spin" : undefined} />
          Refresh
        </Button>
      </div>

      <ErrorBanner>{actionError ?? error}</ErrorBanner>
      <NoticeBanner>{notice}</NoticeBanner>

      {rows !== null && rows.length > 0 ? (
        <div className="flex items-start gap-1.5 border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          <Icon name="campaign" size={15} className="mt-0.5 shrink-0" />
          <span>
            Reminders send themselves every 3 days, up to 3 times, and stop when a case is
            complete.{" "}
            {neverAsked > 0
              ? `${neverAsked} on this page ${neverAsked === 1 ? "has" : "have"} never been asked at all.`
              : "This list is what the scheduler cannot finish on its own."}
          </span>
        </div>
      ) : null}

      {loading && rows === null && !error ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : rows && total === 0 ? (
        <Card className="flex flex-col items-center gap-2 border-dashed py-16 text-center">
          <Icon name="check_circle" size={22} className="text-success" />
          <div className="text-sm font-medium">Nothing outstanding</div>
          <p className="max-w-md px-4 text-sm text-muted-foreground">
            Every case has all of its required documents. There is nobody to chase.
          </p>
        </Card>
      ) : (
        <Card className="gap-0 overflow-hidden py-0">
          {(rows ?? []).map((f) => {
            const s = statusOf(f);
            return (
              <div key={f.caseId} className="flex flex-wrap items-start gap-3 border-b p-4 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/cases/${f.caseId}`} className="truncate font-medium hover:underline">
                      {f.subjectName ?? "Unnamed"}
                    </Link>
                    {f.subjectOrganisation ? (
                      <span className="truncate text-sm text-muted-foreground">
                        {f.subjectOrganisation}
                      </span>
                    ) : null}
                    <code className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                      {f.reference}
                    </code>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                    <span>
                      <strong className="text-foreground tabular-nums">{f.outstanding}</strong>{" "}
                      still to collect
                    </span>
                    <span>
                      Last asked: {formatDate(f.lastRequestAt, "never")}
                      {f.daysSinceLastRequest !== null ? ` (${f.daysSinceLastRequest}d)` : ""}
                    </span>
                    <span className="tabular-nums">
                      {f.requestsSent} sent · {f.remindersSent} reminder
                      {f.remindersSent === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">{s.hint}</div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <Badge variant="outline" className={`${s.tone} whitespace-nowrap font-normal`}>
                    {s.label}
                  </Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    disabled={busyId === f.caseId || f.unreachable}
                    onClick={() => void askNow(f)}
                  >
                    <Icon name="send" size={14} />
                    {busyId === f.caseId ? "Sending…" : "Ask now"}
                  </Button>
                </div>
              </div>
            );
          })}
          <ListPager
            total={total}
            limit={PAGE_SIZE}
            offset={offset}
            onPage={setOffset}
            noun="follow-ups"
          />
        </Card>
      )}
    </div>
  );
}
