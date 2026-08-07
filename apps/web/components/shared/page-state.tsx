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
    <div className={`${DANGER_BANNER} px-3 py-2 text-sm`}>{children}</div>
  );
}

/** Soft success / info strip. */
export function NoticeBanner({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return (
    <div className="border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">{children}</div>
  );
}

/** Centred empty / error card with optional retry. */
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
    <Card className="flex flex-col items-center gap-3 border-0 py-16 text-center">
      <Icon name={icon} size={26} className="text-muted-foreground" />
      <div>
        <div className="font-medium">{title}</div>
        {description ? (
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action}
    </Card>
  );
}

export function LoadErrorState({
  title = "Couldn't load",
  error,
  onRetry,
}: {
  title?: string;
  error: string | null;
  onRetry?: () => void;
}) {
  return (
    <EmptyState
      icon="error"
      title={title}
      description={error}
      action={
        onRetry ? (
          <Button onClick={onRetry} className="gap-1.5">
            <Icon name="refresh" size={16} /> Try again
          </Button>
        ) : null
      }
    />
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
