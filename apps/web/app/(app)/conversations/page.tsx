"use client";

import { ListPager } from "@/components/shared/list-pager";
import { ErrorBanner } from "@/components/shared/page-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { listConversations } from "@/features/conversations/api";
import { useAsyncResource } from "@/hooks/use-async-resource";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import Link from "next/link";
import * as React from "react";

/* ------------------------------------------------------------------ *
 * Conversations - the workspace inbox.
 *
 * One row per case that has any message, newest first, so "who has
 * written to us?" is answerable without opening cases one by one. The
 * thread itself lives on the case, where it belongs beside that case's
 * documents; this screen is for choosing which one to open.
 * ------------------------------------------------------------------ */

const PAGE_SIZE = 50;

const CHANNEL_META: Record<string, { label: string; icon: string }> = {
  email: { label: "Email", icon: "mail" },
  whatsapp: { label: "WhatsApp", icon: "chat" },
};

type ChannelFilter = "all" | "email" | "whatsapp";

function ChannelSegment({
  value,
  onChange,
}: {
  value: ChannelFilter;
  onChange: (v: ChannelFilter) => void;
}) {
  const options: { id: ChannelFilter; label: string; icon?: string }[] = [
    { id: "all", label: "All" },
    { id: "email", label: "Email", icon: "mail" },
    { id: "whatsapp", label: "WhatsApp", icon: "chat" },
  ];
  return (
    <div
      role="tablist"
      aria-label="Filter by channel"
      className="inline-flex h-9 items-center rounded-[8px] border border-border/80 bg-muted/60 p-0.5"
    >
      {options.map((opt) => {
        const active = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.id)}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-[6px] px-2.5 text-xs font-medium transition-colors",
              active
                ? "bg-background text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {opt.icon ? <Icon name={opt.icon} size={14} /> : null}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export default function ConversationsPage() {
  const [offset, setOffset] = React.useState(0);
  const [query, setQuery] = React.useState("");
  const [channel, setChannel] = React.useState<"all" | "email" | "whatsapp">("all");
  const loader = React.useCallback(
    () => listConversations({ limit: PAGE_SIZE, offset }),
    [offset],
  );
  const {
    data: page,
    error,
    loading,
    refreshing,
    reload,
  } = useAsyncResource(loader, [offset], {
    fallbackError: "Couldn't load conversations.",
  });
  const busy = loading || refreshing;
  const rows = page?.items ?? null;
  const total = page?.total ?? 0;

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return (rows ?? []).filter((t) => {
      if (channel !== "all" && t.channel !== channel) return false;
      if (!q) return true;
      return [t.subjectName, t.subjectOrganisation, t.reference, t.preview]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [rows, query, channel]);

  return (
    <div className="flex w-full flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
            Inbox
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-balance">Conversations</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Every case with a message, newest first. Open one to read the whole thread.
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={reload} disabled={busy}>
          <Icon name="refresh" size={15} className={busy ? "animate-spin" : undefined} />
          Refresh
        </Button>
      </div>

      <ErrorBanner>{error}</ErrorBanner>

      <Card className="gap-0 overflow-hidden py-0">
        <div className="flex flex-col gap-2 border-b p-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="relative min-w-0 flex-1 sm:max-w-sm">
            <Icon
              name="search"
              size={18}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, reference or message…"
              className="pl-8"
            />
          </div>
          <ChannelSegment
            value={channel}
            onChange={(next) => {
              setChannel(next);
              setOffset(0);
            }}
          />
        </div>

        {loading && rows === null && !error ? (
          <div className="flex flex-col gap-2 p-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center">
            <div className="text-sm font-medium">
              {(rows ?? []).length === 0 ? "No conversations yet" : "Nothing matches"}
            </div>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              {(rows ?? []).length === 0
                ? "Messages appear here as soon as a subject replies, or a document request goes out."
                : "Try a different search or channel."}
            </p>
          </div>
        ) : (
          <div className="flex flex-col">
            {filtered.map((t) => {
              const meta = CHANNEL_META[t.channel] ?? { label: t.channel, icon: "forum" };
              return (
                <Link
                  key={t.caseId}
                  href={`/cases/${t.caseId}?tab=conversations`}
                  className="flex items-start gap-3 border-b p-4 last:border-b-0 hover:bg-muted/40"
                >
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
                    <Icon name={meta.icon} size={17} className="text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium">{t.subjectName ?? "Unnamed"}</span>
                      {t.subjectOrganisation ? (
                        <span className="truncate text-sm text-muted-foreground">
                          {t.subjectOrganisation}
                        </span>
                      ) : null}
                      <code className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                        {t.reference}
                      </code>
                    </div>
                    <div className="mt-0.5 truncate text-sm text-muted-foreground">
                      {t.direction === "outbound" ? (
                        <span className="text-muted-foreground/80">You: </span>
                      ) : null}
                      {t.preview}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="whitespace-nowrap text-xs text-muted-foreground">
                      {relativeTime(t.at)}
                    </span>
                    {t.direction === "inbound" ? (
                      <Badge
                        variant="outline"
                        className="border-sky-border bg-sky-muted text-sky-muted-foreground"
                      >
                        Their turn
                      </Badge>
                    ) : null}
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        <ListPager
          total={total}
          limit={PAGE_SIZE}
          offset={offset}
          onPage={(next) => {
            setQuery("");
            setOffset(next);
          }}
          noun="conversations"
        />
      </Card>
    </div>
  );
}
