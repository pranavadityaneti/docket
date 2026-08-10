"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Skeleton } from "@/components/ui/skeleton";
import { ListPager } from "@/components/shared/list-pager";
import { ErrorBanner, NoticeBanner } from "@/components/shared/page-state";
import { SegmentedControl } from "@/components/shared/segmented-control";
import { useAsyncResource } from "@/hooks/use-async-resource";
import { AuthRequiredError } from "@/lib/http";
import { formatDateTime, relativeTimeOrNever } from "@/lib/format";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  NOTIFICATION_KIND_META,
  type ApiNotification,
} from "@/features/notifications/api";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

type Filter = "all" | "unread";

const PAGE_SIZE = 50;

function NotificationRow({
  n,
  onOpen,
  onMarkRead,
  busy,
}: {
  n: ApiNotification;
  onOpen: (n: ApiNotification) => void;
  onMarkRead: (n: ApiNotification) => void;
  busy: boolean;
}) {
  const meta = NOTIFICATION_KIND_META[n.kind] ?? NOTIFICATION_KIND_META.generic;
  const unread = !n.readAt;

  return (
    <div
      className={cn(
        "flex gap-3 border-b px-4 py-3.5 last:border-b-0 transition-colors",
        unread ? "bg-primary/5" : "hover:bg-muted/40",
      )}
    >
      <div
        className={cn(
          "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-[10px]",
          unread
            ? "bg-primary/15 text-primary"
            : "bg-muted text-muted-foreground",
        )}
      >
        <Icon name={meta.icon} size={18} />
      </div>
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        onClick={() => onOpen(n)}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("text-sm", unread ? "font-semibold" : "font-medium")}>
            {n.title}
          </span>
          <Badge variant="outline" className="font-normal">
            {meta.label}
          </Badge>
          {unread ? (
            <span className="size-1.5 rounded-full bg-primary" aria-label="Unread" />
          ) : null}
        </div>
        {n.body ? (
          <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{n.body}</p>
        ) : null}
        <div className="mt-1 text-xs text-muted-foreground">
          {formatDateTime(n.createdAt)} · {relativeTimeOrNever(n.createdAt)}
        </div>
      </button>
      {unread ? (
        <Button
          size="sm"
          variant="ghost"
          className="shrink-0 self-start"
          disabled={busy}
          onClick={() => onMarkRead(n)}
        >
          Mark read
        </Button>
      ) : null}
    </div>
  );
}

export default function NotificationsPage() {
  const router = useRouter();
  const [filter, setFilter] = React.useState<Filter>("all");
  const [offset, setOffset] = React.useState(0);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const loader = React.useCallback(
    () =>
      listNotifications({
        unreadOnly: filter === "unread",
        limit: PAGE_SIZE,
        offset,
      }),
    [filter, offset],
  );
  const {
    data: page,
    error,
    loading,
    reload,
  } = useAsyncResource(loader, [filter, offset], {
    fallbackError: "Couldn't load notifications.",
  });
  const rows = page?.items ?? null;
  const total = page?.total ?? 0;

  async function handleOpen(n: ApiNotification) {
    setActionError(null);
    try {
      if (!n.readAt) {
        setBusyId(n.id);
        await markNotificationRead(n.id);
        reload();
      }
      if (n.href) router.push(n.href);
    } catch (e) {
      if (e instanceof AuthRequiredError) return;
      setActionError(e instanceof Error ? e.message : "Couldn't open that.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleMarkRead(n: ApiNotification) {
    setBusyId(n.id);
    setActionError(null);
    try {
      await markNotificationRead(n.id);
      setNotice("Marked as read.");
      reload();
    } catch (e) {
      if (e instanceof AuthRequiredError) return;
      setActionError(e instanceof Error ? e.message : "Couldn't mark as read.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleMarkAll() {
    setBusyId("all");
    setActionError(null);
    try {
      const r = await markAllNotificationsRead();
      setNotice(
        r.updated === 0
          ? "Nothing unread."
          : `Marked ${r.updated} notification${r.updated === 1 ? "" : "s"} read.`,
      );
      reload();
    } catch (e) {
      if (e instanceof AuthRequiredError) return;
      setActionError(e instanceof Error ? e.message : "Couldn't mark all read.");
    } finally {
      setBusyId(null);
    }
  }

  const unreadOnPage = (rows ?? []).filter((n) => !n.readAt).length;

  return (
    <div className="flex w-full flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
            Activity
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-balance">
            Notifications
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            What needs a look across this workspace - documents, unmatched files,
            follow-ups.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl
            aria-label="Filter"
            value={filter}
            onChange={(next) => {
              setFilter(next);
              setOffset(0);
            }}
            options={[
              { value: "all", label: "All" },
              { value: "unread", label: "Unread" },
            ]}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={busyId === "all" || unreadOnPage === 0}
            onClick={() => void handleMarkAll()}
          >
            Mark all read
          </Button>
        </div>
      </div>

      <ErrorBanner>{actionError ?? error}</ErrorBanner>
      <NoticeBanner>{notice}</NoticeBanner>

      {loading && rows === null && !error ? (
        <Skeleton className="h-48 w-full" />
      ) : rows && total === 0 ? (
        <Card className="flex flex-col items-center gap-2 border-dashed py-16 text-center">
          <Icon name="notifications" size={22} className="text-muted-foreground" />
          <div className="text-sm font-medium">
            {filter === "unread" ? "No unread notifications" : "No notifications yet"}
          </div>
          <p className="max-w-md px-4 text-sm text-muted-foreground">
            When documents arrive, need review, or a follow-up is due, they show
            up here.
          </p>
          <Button size="sm" variant="outline" className="mt-2" render={<Link href="/" />}>
            Back to overview
          </Button>
        </Card>
      ) : (
        <Card className="gap-0 overflow-hidden py-0">
          {(rows ?? []).map((n) => (
            <NotificationRow
              key={n.id}
              n={n}
              busy={busyId === n.id}
              onOpen={(item) => void handleOpen(item)}
              onMarkRead={(item) => void handleMarkRead(item)}
            />
          ))}
          <ListPager
            total={total}
            limit={PAGE_SIZE}
            offset={offset}
            onPage={setOffset}
            noun="notifications"
          />
        </Card>
      )}
    </div>
  );
}
