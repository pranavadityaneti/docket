"use client";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { LoadErrorState, PageSkeleton } from "@/components/shared/page-state";
import { getOverview } from "@/features/overview/api";
import type { ApiAttentionItem, ApiOverview } from "@/features/overview/api";
import { listWorkflows } from "@/features/workflows/api";
import { plural, relativeTime } from "@/lib/format";
import { useAsyncResource } from "@/hooks/use-async-resource";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

/* ------------------------------------------------------------------ *
 * Overview - what needs a human right now.
 *
 * Digest layout on purpose: constrained width, tight rows, no rubber-band
 * banners. Tables stay full-bleed elsewhere; this page is a briefing.
 * ------------------------------------------------------------------ */

function StatusDot({
  label,
  tone,
}: {
  label: string;
  tone: "neutral" | "amber" | "red" | "green";
}) {
  const dot =
    tone === "amber"
      ? "bg-warning"
      : tone === "red"
        ? "bg-danger"
        : tone === "green"
          ? "bg-success"
          : "bg-muted-foreground/40";
  const text =
    tone === "amber"
      ? "text-warning"
      : tone === "red"
        ? "text-danger"
        : tone === "green"
          ? "text-success-muted-foreground"
          : "text-muted-foreground";
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", text)}>
      <span className={cn("size-1.5 shrink-0 rounded-full", dot)} />
      {label}
    </span>
  );
}

function AttentionRow({ item, onOpen }: { item: ApiAttentionItem; onOpen: () => void }) {
  const urgent = item.awaitingReview > 0;
  const statusLabel = urgent
    ? `${item.awaitingReview} to review`
    : item.outstanding > 0
      ? `${item.outstanding} to collect`
      : "Needs attention";

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
      className="group flex cursor-pointer items-start gap-3 px-4 py-3.5 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`Open case ${item.reference}`}
    >
      <div className="flex size-9 shrink-0 items-center justify-center rounded-[8px] bg-muted text-muted-foreground">
        <Icon name="description" size={18} />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="truncate text-sm font-semibold tracking-tight">
          {item.subjectName ?? "Unnamed"}
          {item.subjectOrganisation ? (
            <span className="font-normal text-muted-foreground">
              {" "}
              · {item.subjectOrganisation}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <StatusDot
            label={statusLabel}
            tone={urgent ? "red" : item.outstanding > 0 ? "amber" : "neutral"}
          />
          {item.stageName ? (
            <span className="text-xs text-muted-foreground">{item.stageName}</span>
          ) : null}
          <span className="text-xs tabular-nums text-muted-foreground">
            {relativeTime(item.updatedAt)}
          </span>
        </div>
        <div className="truncate text-xs text-muted-foreground">{item.reference}</div>
      </div>
      <Icon
        name="chevron_right"
        size={18}
        className="mt-1 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5"
      />
    </div>
  );
}

function StatChip({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[12px] border border-border/80 bg-card px-3.5 py-2.5">
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-xl font-semibold tracking-tight tabular-nums">{value}</div>
    </div>
  );
}

type OverviewBundle = { overview: ApiOverview; caseLabel: string };

export default function HomePage() {
  const router = useRouter();
  const { data, error, loading, reload } = useAsyncResource<OverviewBundle>(
    async () => {
      const [overview, workflows] = await Promise.all([getOverview(), listWorkflows()]);
      return { overview, caseLabel: workflows[0]?.caseLabel ?? "Case" };
    },
    [],
    { fallbackError: "Couldn't load your overview." },
  );

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <PageSkeleton rows={3} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <LoadErrorState
          title="Couldn't load your overview"
          error={error}
          onRetry={reload}
        />
      </div>
    );
  }

  const { overview, caseLabel } = data;
  const { totals, attention, intake } = overview;
  const nothingToDo = attention.length === 0;
  const arrivedByChannel = Object.keys(intake).filter((c) => c !== "upload");
  const onlyManualUploads = totals.cases > 0 && arrivedByChannel.length === 0;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div className="animate-fade-up flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-balance">
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
                    to review
                  </>
                ) : null}
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="gap-1.5" onClick={reload}>
            <Icon name="refresh" size={18} /> Refresh
          </Button>
          <Link href="/cases?new=1" className={cn(buttonVariants(), "gap-1.5")}>
            <Icon name="add" size={18} /> New {caseLabel.toLowerCase()}
          </Link>
        </div>
      </div>

      <div className="animate-fade-up-delay-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatChip label={plural(caseLabel)} value={totals.cases} />
        <StatChip label="Waiting on you" value={totals.documentsAwaitingReview} />
        <StatChip label="Still to collect" value={totals.documentsOutstanding} />
        <StatChip label="Complete" value={totals.casesComplete} />
      </div>

      {onlyManualUploads ? (
        <Link
          href="/channels"
          className="animate-fade-up-delay-1 inline-flex max-w-lg items-start gap-2 rounded-[12px] bg-pastel-lilac px-3.5 py-3 text-pastel-lilac-fg transition-opacity hover:opacity-90"
        >
          <Icon name="hub" size={18} className="mt-0.5 shrink-0" />
          <span className="text-sm">
            <span className="font-semibold">No intake channel connected.</span>{" "}
            <span className="opacity-85">
              WhatsApp and email let people send documents without logging in.
            </span>
          </span>
        </Link>
      ) : null}

      <Card className="animate-fade-up-delay-2 gap-0 overflow-hidden rounded-[12px] border-0 py-0">
        <CardHeader className="px-4 py-4">
          <CardTitle className="text-base font-semibold">Needs you now</CardTitle>
          <CardDescription>
            Review first, then whatever has sat longest.
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
        <CardContent className="p-0">
          {attention.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
              <div className="flex size-10 items-center justify-center rounded-[12px] bg-pastel-mint text-pastel-mint-fg">
                <Icon name="task_alt" size={20} />
              </div>
              <div className="text-sm font-semibold">Nothing is waiting on you</div>
              <p className="max-w-sm text-sm text-muted-foreground">
                {totals.cases === 0
                  ? `Create a ${caseLabel.toLowerCase()} and its document checklist appears here.`
                  : "Every document that has arrived has been reviewed."}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border/60 border-t border-border/60">
              {attention.map((item) => (
                <AttentionRow
                  key={item.caseId}
                  item={item}
                  onOpen={() => router.push(`/cases/${item.caseId}`)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
