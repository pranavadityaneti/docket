"use client";

import * as React from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { Skeleton } from "@/components/ui/skeleton";
import {
  listConversations,
  AuthRequiredError,
  type ApiConversationThread,
} from "@/lib/api";

/* ------------------------------------------------------------------ *
 * Conversations — the workspace inbox.
 *
 * One row per case that has any message, newest first, so "who has
 * written to us?" is answerable without opening cases one by one. The
 * thread itself lives on the case, where it belongs beside that case's
 * documents; this screen is for choosing which one to open.
 * ------------------------------------------------------------------ */

const CHANNEL_META: Record<string, { label: string; icon: string }> = {
  email: { label: "Email", icon: "mail" },
  whatsapp: { label: "WhatsApp", icon: "chat" },
};

function ago(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function ConversationsPage() {
  const [rows, setRows] = React.useState<ApiConversationThread[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const [channel, setChannel] = React.useState<"all" | "email" | "whatsapp">("all");
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    setBusy(true);
    try {
      setRows(await listConversations());
      setError(null);
    } catch (e) {
      if (e instanceof AuthRequiredError) return;
      setError(e instanceof Error ? e.message : "Couldn't load conversations.");
    } finally {
      setBusy(false);
    }
  }, []);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

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
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Conversations</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Every case with a message, newest first. Open one to read the whole thread.
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void load()} disabled={busy}>
          <Icon name="refresh" size={15} className={busy ? "animate-spin" : undefined} />
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
              placeholder="Search by name, reference or message…"
              className="pl-8"
            />
          </div>
          <div className="flex gap-1">
            {(["all", "email", "whatsapp"] as const).map((c) => (
              <Button
                key={c}
                size="sm"
                variant={channel === c ? "default" : "outline"}
                className="h-8 px-2.5 text-xs"
                onClick={() => setChannel(c)}
              >
                {c === "all" ? "All" : CHANNEL_META[c].label}
              </Button>
            ))}
          </div>
        </div>

        {rows === null && !error ? (
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
                  href={`/cases/${t.caseId}`}
                  className="flex items-start gap-3 border-b p-4 last:border-b-0 hover:bg-muted/40"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
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
                    {/* Whose turn it is, at a glance: their words read plainly,
                        ours are prefixed so the two never look alike. */}
                    <div className="mt-0.5 truncate text-sm text-muted-foreground">
                      {t.direction === "outbound" ? (
                        <span className="text-muted-foreground/80">You: </span>
                      ) : null}
                      {t.preview}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="whitespace-nowrap text-xs text-muted-foreground">
                      {ago(t.at)}
                    </span>
                    {t.direction === "inbound" ? (
                      <Badge
                        variant="outline"
                        className="border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-300"
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
      </Card>
    </div>
  );
}
