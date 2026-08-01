"use client";

import * as React from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Skeleton } from "@/components/ui/skeleton";
import { listChannels, pollChannel, AuthRequiredError, type ApiChannel } from "@/lib/api";

/* ------------------------------------------------------------------ *
 * Channels — the tenant's own mailbox and WhatsApp number.
 *
 * This is the product's premise made visible: subjects write to THEIR
 * lender's address, never to Docket's, which is what makes the platform
 * white-label rather than a portal with a logo on it. The screen answers
 * the two operational questions — is it connected, and is it working —
 * and shows the last error plainly, because a mailbox that silently
 * stopped polling is a borrower's documents silently not arriving.
 *
 * Credentials are never shown: the API returns safe columns only, and the
 * mailbox password exists server-side as ciphertext.
 * ------------------------------------------------------------------ */

const KIND_META: Record<string, { label: string; icon: string }> = {
  email: { label: "Email", icon: "mail" },
  whatsapp: { label: "WhatsApp", icon: "chat" },
};

function ago(iso: string | null): string {
  if (!iso) return "never";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "never";
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function ChannelsPage() {
  const [rows, setRows] = React.useState<ApiChannel[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      setRows(await listChannels());
      setError(null);
    } catch (e) {
      if (e instanceof AuthRequiredError) return;
      setError(e instanceof Error ? e.message : "Couldn't load channels.");
    }
  }, []);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  /** Fetch now rather than waiting up to a minute for the cron. */
  async function checkNow(c: ApiChannel) {
    setBusyId(c.id);
    setNotice(null);
    setError(null);
    try {
      await pollChannel(c.id);
      await load();
      setNotice(`Checked ${c.address} just now.`);
    } catch (e) {
      if (e instanceof AuthRequiredError) return;
      setError(e instanceof Error ? e.message : "Couldn't check that channel.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Channels</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          The addresses your subjects send documents to — under your brand, not ours.
        </p>
      </div>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="rounded-md border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          {notice}
        </div>
      ) : null}

      {rows === null && !error ? (
        <Skeleton className="h-32 w-full" />
      ) : rows && rows.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 border-dashed py-16 text-center">
          <Icon name="hub" size={22} className="text-muted-foreground" />
          <div className="text-sm font-medium">No channels connected</div>
          <p className="max-w-md px-4 text-sm text-muted-foreground">
            Documents can still be uploaded here by staff, but nobody can send them in yet.
            Connecting a mailbox is done by the Docket team.
          </p>
        </Card>
      ) : (
        (rows ?? []).map((c) => {
          const meta = KIND_META[c.kind] ?? { label: c.kind, icon: "hub" };
          return (
            <Card key={c.id} className="gap-0 overflow-hidden py-0">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b p-4">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
                    <Icon name={meta.icon} size={18} className="text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate font-medium">{c.address}</div>
                    <div className="text-xs text-muted-foreground">{meta.label} intake</div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant="outline"
                    className={
                      c.enabled
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300"
                        : undefined
                    }
                  >
                    {c.enabled ? "Enabled" : "Disabled"}
                  </Badge>
                  {/* Only email has a poller to trigger; WhatsApp is pushed to
                      us by Meta, so "check now" would be a button that lies. */}
                  {c.kind === "email" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1.5"
                      disabled={busyId === c.id || !c.enabled}
                      onClick={() => void checkNow(c)}
                    >
                      <Icon
                        name="refresh"
                        size={15}
                        className={busyId === c.id ? "animate-spin" : undefined}
                      />
                      {busyId === c.id ? "Checking…" : "Check now"}
                    </Button>
                  ) : null}
                </div>
              </div>

              <dl className="grid grid-cols-1 gap-x-8 gap-y-3 p-4 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-muted-foreground">Last checked</dt>
                  <dd className="mt-0.5">{ago(c.lastPolledAt)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Connected</dt>
                  <dd className="mt-0.5">
                    {new Date(c.createdAt).toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Status</dt>
                  <dd className="mt-0.5">
                    {c.lastError ? (
                      <span className="text-red-600 dark:text-red-400">Needs attention</span>
                    ) : c.lastPolledAt ? (
                      "Healthy"
                    ) : (
                      "Not checked yet"
                    )}
                  </dd>
                </div>
              </dl>

              {/* A mailbox that stopped polling is documents not arriving, so
                  the failure is shown in full rather than summarised away. */}
              {c.lastError ? (
                <div className="border-t bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
                  <div className="mb-0.5 font-medium">Last error</div>
                  <div className="break-words">{c.lastError}</div>
                </div>
              ) : null}
            </Card>
          );
        })
      )}

      <div className="flex items-start gap-1.5 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        <Icon name="lock" size={15} className="mt-0.5 shrink-0" />
        <span>
          Mailbox passwords and WhatsApp tokens are encrypted and never leave the server — they
          cannot be displayed here. Adding or changing a channel is done by the Docket team.
        </span>
      </div>
    </div>
  );
}
