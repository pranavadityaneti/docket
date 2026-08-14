"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Skeleton } from "@/components/ui/skeleton";
import { DANGER_BANNER } from "@/lib/tones";
import * as React from "react";

/** Inline error strip used above tables and cards. */
export function ErrorBanner({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return (
    <div
      className={`${DANGER_BANNER} flex items-start gap-2 rounded-[8px] px-3 py-2.5 text-sm`}
    >
      <Icon name="error" size={16} className="mt-0.5 shrink-0 text-danger" />
      <div className="min-w-0 flex-1 leading-snug">{children}</div>
    </div>
  );
}

/** Soft success / info strip. */
export function NoticeBanner({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return (
    <div className="border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">{children}</div>
  );
}

/** Centred empty card with optional action. */
export function EmptyState({
  icon = "inbox",
  title,
  description,
  action,
}: {
  icon?: string;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col items-center gap-3 rounded-[12px] border-dashed px-6 py-10 text-center">
      <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon name={icon} size={18} />
      </div>
      <div className="space-y-1">
        <div className="text-base font-semibold tracking-tight">{title}</div>
        {description ? (
          <p className="mx-auto max-w-md text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action}
    </Card>
  );
}

/** Full-page / list load failure — soft danger wash, tight stack, clear hierarchy. */
export function LoadErrorState({
  title = "Couldn't load",
  error,
  hint,
  onRetry,
}: {
  title?: string;
  error: string | null;
  hint?: React.ReactNode;
  onRetry?: () => void;
}) {
  return (
    <Card className="flex flex-col items-center gap-4 rounded-[12px] border-danger-border/70 bg-danger-muted/35 px-6 py-10 text-center">
      <div className="flex size-10 items-center justify-center rounded-full bg-danger-muted text-danger">
        <Icon name="error" size={18} />
      </div>
      <div className="space-y-1.5">
        <div className="text-base font-semibold tracking-tight">{title}</div>
        {error ? (
          <p className="mx-auto max-w-lg text-sm leading-snug text-muted-foreground break-words">
            {error}
          </p>
        ) : null}
        {hint ? (
          <p className="mx-auto max-w-lg text-xs leading-relaxed text-muted-foreground/75">
            {hint}
          </p>
        ) : null}
      </div>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry} className="gap-1.5">
          <Icon name="refresh" size={16} /> Retry
        </Button>
      ) : null}
    </Card>
  );
}

/** Generic stacked skeleton for list pages before first paint. */
export function PageSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="h-9 w-72" />
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-16 w-full rounded-[12px]" />
      ))}
    </div>
  );
}
