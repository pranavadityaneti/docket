"use client";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { LoadErrorState, PageSkeleton } from "@/components/shared/page-state";
import {
  fetchPlatformOverview,
  listPlatformTenants,
  type PlatformOverview,
  type PlatformTenantListItem,
} from "@/features/platform/api";
import { TenantLogoMark } from "@/features/platform/tenant-logo";
import { usePlatformPrivilege } from "@/features/platform/session";
import { useAsyncResource } from "@/hooks/use-async-resource";
import { formatDate, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

type Bundle = { overview: PlatformOverview; tenants: PlatformTenantListItem[] };

function StatChip({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[12px] border border-border/80 bg-card px-3.5 py-2.5">
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-xl font-semibold tracking-tight tabular-nums">{value}</div>
    </div>
  );
}

export default function PlatformOverviewPage() {
  const router = useRouter();
  const canWriteTenants = usePlatformPrivilege("tenants.write");
  const { data, error, loading, reload } = useAsyncResource<Bundle>(
    async () => {
      const [overview, tenants] = await Promise.all([
        fetchPlatformOverview(),
        listPlatformTenants(),
      ]);
      return { overview, tenants };
    },
    [],
    { fallbackError: "Couldn't load the platform console." },
  );

  if (loading && !data) return <PageSkeleton />;
  if (error && !data) {
    return <LoadErrorState error={error} onRetry={reload} />;
  }
  if (!data) return <PageSkeleton />;

  const recent = [...data.tenants]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 6);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div className="animate-fade-up flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        <div className="min-w-0 space-y-1">
          <h1 className="text-xl font-semibold tracking-tight text-balance sm:text-2xl">
            Platform console
          </h1>
          <p className="text-sm text-muted-foreground">
            Create and manage workspaces. This login is not a tenant membership.
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <Button variant="outline" className="min-w-0 flex-1 gap-1.5 sm:flex-none" onClick={reload}>
            <Icon name="refresh" size={18} /> Refresh
          </Button>
          {canWriteTenants ? (
            <Link
              href="/admin/tenants?new=1"
              className={cn(buttonVariants(), "min-w-0 flex-1 gap-1.5 sm:flex-none")}
            >
              <Icon name="add" size={18} /> New tenant
            </Link>
          ) : null}
        </div>
      </div>

      <div className="animate-fade-up-delay-1 grid grid-cols-2 gap-2">
        <StatChip label="Workspaces" value={data.overview.tenantCount} />
        <StatChip label="Created this week" value={data.overview.tenantsCreatedThisWeek} />
      </div>

      <Card className="animate-fade-up-delay-2 gap-0 overflow-hidden border-0 py-0">
        <CardHeader className="px-4 py-4">
          <CardTitle className="text-base font-semibold">Recent tenants</CardTitle>
          <CardDescription>Newest workspaces first.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {recent.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
              <div className="flex size-10 items-center justify-center rounded-[12px] bg-pastel-mint text-pastel-mint-fg">
                <Icon name="apartment" size={20} />
              </div>
              <div className="text-sm font-semibold">No tenants yet</div>
              <p className="max-w-sm text-sm text-muted-foreground">
                Create a workspace and an owner login. They sign in at /login, not here.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border/60 border-t border-border/60">
              {recent.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => router.push(`/admin/tenants/${t.id}`)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50"
                >
                  <TenantLogoMark tenant={t} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{t.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {t.slug} · {t.owner?.email ?? "no owner"}
                    </div>
                  </div>
                  <div className="shrink-0 text-xs text-muted-foreground">
                    {relativeTime(t.createdAt) || formatDate(t.createdAt)}
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
