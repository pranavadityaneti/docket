"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  getOverview,
  listWorkflows,
  AuthRequiredError,
  type ApiOverview,
  type ApiAttentionItem,
} from "@/lib/api";

/* ------------------------------------------------------------------ *
 * Overview — what needs a human right now.
 *
 * Every number here is counted from rows on each load. The previous
 * version was entirely invented: "342 leads in flight", "68% docs
 * auto-cleared", "42 calls made", six fictional borrowers with
 * fictional reasons — on a workspace holding four cases and no
 * documents. It was the landing page, so it was the first thing anyone
 * saw and the last thing they could trust.
 *
 * Nothing is shown that cannot be derived. There are no call or email
 * counts because no call or email has ever been made, no
 * "auto-cleared" percentage because no AI has cleared anything, and no
 * trend arrows because there is no history to compare against. Each of
 * those returns when the thing it measures exists.
 * ------------------------------------------------------------------ */

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function plural(label: string): string {
  if (/[^aeiou]y$/i.test(label)) return label.slice(0, -1) + "ies";
  if (/(s|x|z|ch|sh)$/i.test(label)) return label + "es";
  return label + "s";
}

/** A case needing a human, and the reason it does. */
function AttentionRow({ item, onOpen }: { item: ApiAttentionItem; onOpen: () => void }) {
  // Waiting on us outranks waiting on them: a document sitting unreviewed is
  // work we are holding up ourselves.
  const urgent = item.awaitingReview > 0;

  return (
    <div
      role="link"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="flex cursor-pointer items-center gap-3 px-5 py-3 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`Open case ${item.reference}`}
    >
      <span
        className={`size-2 shrink-0 rounded-full ${urgent ? "bg-amber-500" : "bg-muted-foreground/40"}`}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">
          {item.subjectName ?? "Unnamed"}
          {item.subjectOrganisation ? (
            <span className="font-normal text-muted-foreground"> · {item.subjectOrganisation}</span>
          ) : null}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {[
            item.awaitingReview > 0
              ? `${item.awaitingReview} waiting on your review`
              : null,
            item.outstanding > 0 ? `${item.outstanding} still to collect` : null,
            item.reference,
          ]
            .filter(Boolean)
            .join(" · ")}
        </div>
      </div>
      {item.stageName ? (
        <Badge variant="outline" className="hidden shrink-0 whitespace-nowrap font-normal sm:inline-flex">
          {item.stageName}
        </Badge>
      ) : null}
      <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
        {relativeTime(item.updatedAt)}
      </span>
      <Icon name="chevron_right" size={18} className="shrink-0 text-muted-foreground" />
    </div>
  );
}

function StatCard({
  label,
  value,
  note,
  icon,
  tone,
}: {
  label: string;
  value: number;
  note: string;
  icon: string;
  tone: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{label}</span>
          <div className={`flex size-8 items-center justify-center rounded-md ${tone}`}>
            <Icon name={icon} size={18} />
          </div>
        </div>
        <div className="mt-3 text-3xl font-semibold tracking-tight tabular-nums">{value}</div>
        <p className="mt-1 text-xs text-muted-foreground">{note}</p>
      </CardContent>
    </Card>
  );
}

export default function HomePage() {
  const router = useRouter();
  const [data, setData] = React.useState<ApiOverview | null>(null);
  const [caseLabel, setCaseLabel] = React.useState("Case");
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    try {
      const [overview, workflows] = await Promise.all([getOverview(), listWorkflows()]);
      setData(overview);
      if (workflows[0]) setCaseLabel(workflows[0].caseLabel);
      setError(null);
    } catch (e) {
      if (e instanceof AuthRequiredError) return;
      setError(e instanceof Error ? e.message : "Couldn't load your overview.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  if (loading) {
    return (
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <Skeleton className="h-9 w-80" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-7xl">
        <Card className="flex flex-col items-center gap-3 border-dashed py-16 text-center">
          <Icon name="error" size={26} className="text-muted-foreground" />
          <div>
            <div className="font-medium">Couldn&rsquo;t load your overview</div>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{error}</p>
          </div>
          <Button onClick={refresh}>Try again</Button>
        </Card>
      </div>
    );
  }

  const { totals, attention, intake } = data;
  const nothingToDo = attention.length === 0;
  // Everything so far arrived by hand. Read from the data rather than asserted,
  // so it stops being said the moment a document arrives another way.
  const arrivedByChannel = Object.keys(intake).filter((c) => c !== "upload");
  const onlyManualUploads = totals.cases > 0 && arrivedByChannel.length === 0;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      {/* Greeting */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {nothingToDo ? "Nothing needs you right now" : "Here’s what needs you today"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {nothingToDo ? (
              totals.cases === 0 ? (
                <>No {plural(caseLabel).toLowerCase()} yet.</>
              ) : (
                <>
                  All {totals.cases} {plural(caseLabel).toLowerCase()} are either complete or waiting
                  on someone else.
                </>
              )
            ) : (
              <>
                <span className="font-medium text-foreground">
                  {totals.casesNeedingAttention}
                </span>{" "}
                of {totals.cases} {plural(caseLabel).toLowerCase()} need attention
                {totals.documentsAwaitingReview > 0 ? (
                  <>
                    {" "}
                    ·{" "}
                    <span className="font-medium text-foreground">
                      {totals.documentsAwaitingReview}
                    </span>{" "}
                    document{totals.documentsAwaitingReview === 1 ? "" : "s"} waiting on your review
                  </>
                ) : null}
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="gap-1.5" onClick={refresh}>
            <Icon name="refresh" size={18} /> Refresh
          </Button>
          <Link href="/cases?new=1" className={cn(buttonVariants(), "gap-1.5")}>
            <Icon name="add" size={18} /> New {caseLabel.toLowerCase()}
          </Link>
        </div>
      </div>

      {/* Needs you now — real cases, ordered by what is actually blocking */}
      <Card className="gap-0 overflow-hidden py-0">
        <CardHeader className="border-b py-4">
          <CardTitle className="text-base">Needs you now</CardTitle>
          <CardDescription>
            Documents waiting on a decision first, then whatever has sat longest.
          </CardDescription>
          {attention.length > 0 ? (
            <CardAction>
              <Link
                href="/cases"
                className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
              >
                All {plural(caseLabel).toLowerCase()} <Icon name="arrow_outward" size={15} />
              </Link>
            </CardAction>
          ) : null}
        </CardHeader>
        <CardContent className="divide-y p-0">
          {attention.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-14 text-center">
              <Icon name="task_alt" size={26} className="text-emerald-600" />
              <div className="text-sm font-medium">Nothing is waiting on you</div>
              <p className="max-w-sm text-sm text-muted-foreground">
                {totals.cases === 0
                  ? `Create a ${caseLabel.toLowerCase()} and its document checklist appears here.`
                  : "Every document that has arrived has been reviewed."}
              </p>
            </div>
          ) : (
            attention.map((item) => (
              <AttentionRow
                key={item.caseId}
                item={item}
                onOpen={() => router.push(`/cases/${item.caseId}`)}
              />
            ))
          )}
        </CardContent>
      </Card>

      {/* Counts. Four things we can actually count. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={plural(caseLabel)}
          value={totals.cases}
          note="in this workspace"
          icon="folder_shared"
          tone="bg-primary/10 text-primary"
        />
        <StatCard
          label="Waiting on you"
          value={totals.documentsAwaitingReview}
          note="documents to review"
          icon="inbox"
          tone="bg-amber-50 text-amber-600"
        />
        <StatCard
          label="Still to collect"
          value={totals.documentsOutstanding}
          note="required documents"
          icon="pending_actions"
          tone="bg-muted text-muted-foreground"
        />
        <StatCard
          label="Complete"
          value={totals.casesComplete}
          note="nothing outstanding"
          icon="task_alt"
          tone="bg-emerald-50 text-emerald-600"
        />
      </div>

      {/* The USP is not connected yet, and the screen says so rather than
          implying documents are flowing in. */}
      {onlyManualUploads ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-wrap items-center gap-3 pt-6">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <Icon name="hub" size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">No intake channel connected</div>
              <p className="text-sm text-muted-foreground">
                Every document so far was uploaded here by hand. Connecting a WhatsApp number
                and mailbox is what lets people send documents without logging in.
              </p>
            </div>
            <Button variant="outline" disabled className="shrink-0 gap-1.5">
              <Icon name="hub" size={16} /> Set up channels
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
