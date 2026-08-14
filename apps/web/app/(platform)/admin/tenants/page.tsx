"use client";

import { EmptyState, ErrorBanner, LoadErrorState, PageSkeleton } from "@/components/shared/page-state";
import { PasswordInput } from "@/components/shared/password-input";
import { SelectMenu } from "@/components/shared/select-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  TENANT_SLUG_RE,
  createPlatformTenant,
  listPlatformTenants,
  slugFromName,
  type PlatformTenantListItem,
} from "@/features/platform/api";
import { TenantLogoMark } from "@/features/platform/tenant-logo";
import { usePlatformPrivilege } from "@/features/platform/session";
import { useAsyncResource } from "@/hooks/use-async-resource";
import { formatDate } from "@/lib/format";
import { AuthRequiredError } from "@/lib/http";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

const PLANS = ["trial", "starter", "growth", "internal"] as const;

function TenantTable({
  rows,
  onOpen,
}: {
  rows: PlatformTenantListItem[];
  onOpen: (id: string) => void;
}) {
  return (
    <Card className="gap-0 overflow-hidden border-0 py-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Workspace</TableHead>
            <TableHead>Owner</TableHead>
            <TableHead>Plan</TableHead>
            <TableHead>Members</TableHead>
            <TableHead>Created</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((t) => (
            <TableRow
              key={t.id}
              className="cursor-pointer"
              onClick={() => onOpen(t.id)}
            >
              <TableCell>
                <div className="flex items-center gap-3">
                  <TenantLogoMark tenant={t} />
                  <div className="min-w-0">
                    <div className="truncate font-medium">{t.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{t.slug}</div>
                  </div>
                </div>
              </TableCell>
              <TableCell>
                {t.owner ? (
                  <>
                    <div className="text-sm">{t.owner.name}</div>
                    <div className="text-xs text-muted-foreground">{t.owner.email}</div>
                  </>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell>
                <Badge variant="secondary">{t.plan}</Badge>
              </TableCell>
              <TableCell className="tabular-nums">{t.memberCount}</TableCell>
              <TableCell className="text-muted-foreground">{formatDate(t.createdAt)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function CreateTenantDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [slugTouched, setSlugTouched] = React.useState(false);
  const [plan, setPlan] = React.useState<string>("trial");
  const [ownerName, setOwnerName] = React.useState("");
  const [ownerEmail, setOwnerEmail] = React.useState("");
  const [ownerPassword, setOwnerPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [working, setWorking] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setName("");
      setSlug("");
      setSlugTouched(false);
      setPlan("trial");
      setOwnerName("");
      setOwnerEmail("");
      setOwnerPassword("");
      setError(null);
    }
  }, [open]);

  function onName(v: string) {
    setName(v);
    if (!slugTouched) setSlug(slugFromName(v));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!TENANT_SLUG_RE.test(slug)) {
      setError("Slug must be 1–63 lowercase letters or digits, with hyphens in between.");
      return;
    }
    setWorking(true);
    setError(null);
    try {
      const created = await createPlatformTenant({
        name,
        slug,
        plan,
        ownerName,
        ownerEmail,
        ownerPassword,
      });
      onOpenChange(false);
      onCreated(created.tenant.id);
    } catch (err) {
      if (err instanceof AuthRequiredError) return;
      setError(err instanceof Error ? err.message : "Couldn't create the workspace.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (working ? null : onOpenChange(o))}>
      <DialogContent className="gap-0 p-0">
        <form onSubmit={(e) => void submit(e)}>
          <DialogHeader className="border-b pr-10">
            <DialogTitle>New tenant</DialogTitle>
            <DialogDescription>
              Creates a workspace and its owner login. They sign in at /login, not this console.
            </DialogDescription>
          </DialogHeader>
          <div className="grid max-h-[60vh] gap-4 overflow-y-auto px-5 py-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="tenant-name" className="text-sm font-medium">
                Workspace name
              </label>
              <Input
                id="tenant-name"
                required
                value={name}
                onChange={(e) => onName(e.target.value)}
                placeholder="Harbor Lending"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="tenant-slug" className="text-sm font-medium">
                  Slug
                </label>
                <Input
                  id="tenant-slug"
                  required
                  value={slug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    setSlug(e.target.value.toLowerCase());
                  }}
                  placeholder="harbor"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="tenant-plan" className="text-sm font-medium">
                  Plan
                </label>
                <SelectMenu
                  id="tenant-plan"
                  value={plan}
                  options={PLANS.map((p) => ({ value: p, label: p }))}
                  onChange={setPlan}
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="owner-name" className="text-sm font-medium">
                Owner name
              </label>
              <Input
                id="owner-name"
                required
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
                placeholder="Priya Shah"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="owner-email" className="text-sm font-medium">
                Owner email
              </label>
              <Input
                id="owner-email"
                type="email"
                required
                value={ownerEmail}
                onChange={(e) => setOwnerEmail(e.target.value)}
                placeholder="priya@harbor.test"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="owner-password" className="text-sm font-medium">
                Owner password
              </label>
              <PasswordInput
                id="owner-password"
                autoComplete="new-password"
                required
                minLength={12}
                value={ownerPassword}
                onChange={(e) => setOwnerPassword(e.target.value)}
                placeholder="At least 12 characters"
              />
            </div>
            {error ? <ErrorBanner>{error}</ErrorBanner> : null}
          </div>
          <DialogFooter className="flex-row justify-end gap-2 border-t">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={working}>
              Cancel
            </Button>
            <Button type="submit" disabled={working} className="gap-1.5">
              {working ? (
                <>
                  <Icon name="progress_activity" size={16} className="animate-spin" /> Creating...
                </>
              ) : (
                "Create tenant"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TenantsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const canWriteTenants = usePlatformPrivilege("tenants.write");
  const { data, error, loading, reload } = useAsyncResource(
    listPlatformTenants,
    [],
    { fallbackError: "Couldn't load tenants." },
  );
  const [query, setQuery] = React.useState("");
  const [createOpen, setCreateOpen] = React.useState(false);

  React.useEffect(() => {
    if (canWriteTenants && searchParams.get("new") === "1") setCreateOpen(true);
  }, [searchParams, canWriteTenants]);

  const rows = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !data) return data ?? [];
    return data.filter((t) =>
      [t.name, t.slug, t.plan, t.owner?.email, t.owner?.name]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [data, query]);

  if (loading && !data) return <PageSkeleton />;
  if (error && !data) return <LoadErrorState error={error} onRetry={reload} />;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Tenants</h1>
          <p className="text-sm text-muted-foreground">
            Workspaces and the owner credentials they sign in with.
          </p>
        </div>
        {canWriteTenants ? (
          <Button className="gap-1.5" onClick={() => setCreateOpen(true)}>
            <Icon name="add" size={18} /> New tenant
          </Button>
        ) : null}
      </div>

      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search name, slug, or owner…"
        className="max-w-sm"
      />

      {error ? <ErrorBanner>{error}</ErrorBanner> : null}

      {rows.length === 0 ? (
        <EmptyState
          icon="apartment"
          title={query ? "No matching tenants" : "No tenants yet"}
          description={
            query
              ? "Try a different search."
              : "Create a workspace and an owner login. They use the tenant sign-in, not this console."
          }
          action={
            query || !canWriteTenants ? undefined : (
              <Button className="gap-1.5" onClick={() => setCreateOpen(true)}>
                <Icon name="add" size={18} /> New tenant
              </Button>
            )
          }
        />
      ) : (
        <TenantTable rows={rows} onOpen={(id) => router.push(`/admin/tenants/${id}`)} />
      )}

      <CreateTenantDialog
        open={canWriteTenants && createOpen}
        onOpenChange={(o) => {
          setCreateOpen(o);
          if (!o && searchParams.get("new") === "1") {
            router.replace("/admin/tenants");
          }
        }}
        onCreated={(id) => {
          reload();
          router.push(`/admin/tenants/${id}`);
        }}
      />
    </div>
  );
}

export default function TenantsPage() {
  return (
    <React.Suspense fallback={<PageSkeleton />}>
      <TenantsPageInner />
    </React.Suspense>
  );
}
