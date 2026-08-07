"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorBanner, NoticeBanner } from "@/components/shared/page-state";
import { useAsyncResource } from "@/hooks/use-async-resource";
import { AuthRequiredError } from "@/lib/http";
import { listChannels, pollChannel } from "@/features/channels/api";
import type { ApiChannel } from "@/features/channels/api";
import { relativeTimeOrNever } from "@/lib/format";
import * as React from "react";

/* ------------------------------------------------------------------ *
 * Channels - the tenant's own mailbox and WhatsApp number.
 *
 * This is the product's premise made visible: subjects write to THEIR
 * lender's address, never to Docket's, which is what makes the platform
 * white-label rather than a portal with a logo on it. The screen answers
 * the two operational questions - is it connected, and is it working -
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

export default function ChannelsPage() {
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const { data: rows, error, loading, reload } = useAsyncResource(listChannels, [], {
    fallbackError: "Couldn't load channels.",
  });

  /** Fetch now rather than waiting up to a minute for the cron. */
  async function checkNow(c: ApiChannel) {
    setBusyId(c.id);
    setNotice(null);
    setActionError(null);
    try {
      await pollChannel(c.id);
      reload();
      setNotice(`Checked ${c.address} just now.`);
    } catch (e) {
      if (e instanceof AuthRequiredError) return;
      setActionError(e instanceof Error ? e.message : "Couldn't check that channel.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex w-full flex-col gap-5">
      <div className="space-y-1">
        <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
          Setup
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-balance">Channels</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          The addresses your subjects send documents to - under your brand, not ours.
        </p>
      </div>

      <ErrorBanner>{actionError ?? error}</ErrorBanner>
      <NoticeBanner>{notice}</NoticeBanner>

      {loading && rows === null && !error ? (
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
                  <div className="flex w-9 shrink-0 items-center justify-center rounded-full bg-muted">
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
                        ? "border-success-border bg-success-muted text-success-muted-foreground"
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
                      className="gap-1.5"
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
                  <dd className="mt-0.5">{relativeTimeOrNever(c.lastPolledAt)}</dd>
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
                      <span className="text-danger">Needs attention</span>
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
                <div className="border-t bg-danger-muted px-4 py-3 text-sm text-danger-muted-foreground">
                  <div className="mb-0.5 font-medium">Last error</div>
                  <div className="break-words">{c.lastError}</div>
                </div>
              ) : null}
            </Card>
          );
        })
      )}

      <div className="flex items-start gap-1.5 border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        <Icon name="lock" size={15} className="mt-0.5 shrink-0" />
        <span>
          Mailbox passwords and WhatsApp tokens are encrypted and never leave the server - they
          cannot be displayed here. Adding or changing a channel is done by the Docket team.
        </span>
      </div>
    </div>
  );
}
