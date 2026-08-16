"use client";

import { DeleteDialog } from "@/components/shared/delete-dialog";
import { ErrorBanner, LoadErrorState, PageSkeleton } from "@/components/shared/page-state";
import { PasswordInput } from "@/components/shared/password-input";
import { SelectMenu } from "@/components/shared/select-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import {
  deletePlatformTenant,
  getPlatformTenant,
  updatePlatformTenant,
  updatePlatformTenantCredentials,
  type PlatformTenantDetail,
} from "@/features/platform/api";
import { usePlatformPrivilege } from "@/features/platform/session";
import { tenantEditorSeed } from "@/features/platform/tenant-editor";
import { TenantLogoMark } from "@/features/platform/tenant-logo";
import { useAsyncResource } from "@/hooks/use-async-resource";
import { formatDate } from "@/lib/format";
import { AuthRequiredError } from "@/lib/http";
import { sanitizeEmail } from "@/lib/validators";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import * as React from "react";

const PLANS = ["trial", "starter", "growth", "internal"] as const;

export default function TenantDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const canWrite = usePlatformPrivilege("tenants.write");
  const canCredentials = usePlatformPrivilege("tenants.credentials");
  const canDelete = usePlatformPrivilege("tenants.delete");
  const { data, error, loading, reload } = useAsyncResource(
    () => getPlatformTenant(id),
    [id],
    { fallbackError: "Couldn't load this workspace." },
  );

  if (loading && !data) return <PageSkeleton />;
  if (error && !data) return <LoadErrorState error={error} onRetry={reload} />;
  if (!data) return <PageSkeleton />;

  return (
    <TenantDetailEditor
      key={data.id}
      data={data}
      canWrite={canWrite}
      canCredentials={canCredentials}
      canDelete={canDelete}
      onReload={reload}
      onDeleted={() => router.push("/admin/tenants")}
    />
  );
}

function TenantDetailEditor({
  data,
  canWrite,
  canCredentials,
  canDelete,
  onReload,
  onDeleted,
}: {
  data: PlatformTenantDetail;
  canWrite: boolean;
  canCredentials: boolean;
  canDelete: boolean;
  onReload: () => void;
  onDeleted: () => void;
}) {
  const seed = tenantEditorSeed(data);
  const [name, setName] = React.useState(seed.name);
  const [plan, setPlan] = React.useState(seed.plan);
  const [ownerName, setOwnerName] = React.useState(seed.ownerName);
  const ownerUserId = seed.ownerUserId;
  const [ownerEmail, setOwnerEmail] = React.useState(seed.ownerEmail);
  const [ownerPassword, setOwnerPassword] = React.useState("");
  const [savingTenant, setSavingTenant] = React.useState(false);
  const [savingCreds, setSavingCreds] = React.useState(false);
  const [tenantError, setTenantError] = React.useState<string | null>(null);
  const [credsError, setCredsError] = React.useState<string | null>(null);
  const [credsNotice, setCredsNotice] = React.useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = React.useState(false);

  async function saveTenant(e: React.FormEvent) {
    e.preventDefault();
    setSavingTenant(true);
    setTenantError(null);
    try {
      await updatePlatformTenant(data.id, { name, plan });
      onReload();
    } catch (err) {
      if (err instanceof AuthRequiredError) return;
      setTenantError(err instanceof Error ? err.message : "Couldn't update the workspace.");
    } finally {
      setSavingTenant(false);
    }
  }

  async function saveCredentials(e: React.FormEvent) {
    e.preventDefault();
    setSavingCreds(true);
    setCredsError(null);
    setCredsNotice(null);
    try {
      const result = await updatePlatformTenantCredentials(data.id, {
        name: ownerName,
        email: ownerEmail,
        ...(ownerPassword ? { password: ownerPassword } : {}),
      });
      setOwnerPassword("");
      setCredsNotice(
        result.passwordSet
          ? "Owner details and password updated."
          : "Owner details updated. Password unchanged.",
      );
      onReload();
    } catch (err) {
      if (err instanceof AuthRequiredError) return;
      setCredsError(err instanceof Error ? err.message : "Couldn't update credentials.");
    } finally {
      setSavingCreds(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <TenantLogoMark tenant={data} className="mt-1 size-10" />
          <div className="space-y-1">
            <Link
              href="/admin/tenants"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <Icon name="arrow_back" size={14} /> Tenants
            </Link>
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{data.name}</h1>
            <p className="text-sm text-muted-foreground">
              <span className="font-mono">{data.publicId}</span> · {data.slug} · created{" "}
              {formatDate(data.createdAt)}
            </p>
          </div>
        </div>
        {canDelete ? (
          <Button variant="destructive" className="gap-1.5" onClick={() => setDeleteOpen(true)}>
            <Icon name="delete" size={16} /> Delete
          </Button>
        ) : null}
      </div>

      <form onSubmit={(e) => void saveTenant(e)}>
        <Card className="gap-0 border-0 py-0">
          <CardHeader className="px-4 py-4">
            <CardTitle className="text-base font-semibold">Workspace</CardTitle>
            <CardDescription>
              Tenant ID and slug stay fixed — the ID is server-issued, the slug is the host key.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 border-t border-border/60 px-4 py-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="ws-public-id" className="text-sm font-medium">
                Tenant ID
              </label>
              <Input id="ws-public-id" readOnly value={data.publicId} className="font-mono" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="ws-name" className="text-sm font-medium">
                Name
              </label>
              <Input
                id="ws-name"
                required
                value={name}
                disabled={!canWrite}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="ws-plan" className="text-sm font-medium">
                Plan
              </label>
              <SelectMenu
                id="ws-plan"
                value={plan}
                disabled={!canWrite}
                options={[
                  ...(PLANS.includes(plan as (typeof PLANS)[number])
                    ? []
                    : [{ value: plan, label: plan }]),
                  ...PLANS.map((p) => ({ value: p, label: p })),
                ]}
                onChange={setPlan}
              />
            </div>
            {tenantError ? <ErrorBanner>{tenantError}</ErrorBanner> : null}
            {canWrite ? (
              <div>
                <Button type="submit" disabled={savingTenant} className="gap-1.5">
                  {savingTenant ? (
                    <>
                      <Icon name="progress_activity" size={16} className="animate-spin" /> Saving...
                    </>
                  ) : (
                    "Save workspace"
                  )}
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </form>

      <form onSubmit={(e) => void saveCredentials(e)}>
        <Card className="gap-0 border-0 py-0">
          <CardHeader className="px-4 py-4">
            <CardTitle className="text-base font-semibold">Owner credentials</CardTitle>
            <CardDescription>
              The account that signs into this workspace at /login. Leave password blank to keep
              the current one.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 border-t border-border/60 px-4 py-4">
            {!data.owner ? (
              <p className="text-sm text-muted-foreground">This workspace has no owner.</p>
            ) : (
              <>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="cred-name" className="text-sm font-medium">
                    Name
                  </label>
                  <Input
                    id="cred-name"
                    required
                    value={ownerName}
                    disabled={!canCredentials}
                    onChange={(e) => setOwnerName(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="cred-login-id" className="text-sm font-medium">
                    User ID
                  </label>
                  <Input id="cred-login-id" readOnly value={ownerUserId} className="font-mono" />
                  <p className="text-xs text-muted-foreground">Assigned automatically. Cannot be changed.</p>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="cred-email" className="text-sm font-medium">
                    Email
                  </label>
                  <Input
                    id="cred-email"
                    type="email"
                    required
                    value={ownerEmail}
                    disabled={!canCredentials}
                    onChange={(e) => setOwnerEmail(sanitizeEmail(e.target.value))}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="cred-password" className="text-sm font-medium">
                    New password
                  </label>
                  <PasswordInput
                    id="cred-password"
                    autoComplete="new-password"
                    minLength={12}
                    value={ownerPassword}
                    disabled={!canCredentials}
                    onChange={(e) => setOwnerPassword(e.target.value)}
                    placeholder="Leave blank to keep current"
                  />
                </div>
                {credsError ? <ErrorBanner>{credsError}</ErrorBanner> : null}
                {credsNotice ? (
                  <div className="flex items-center gap-1.5 rounded-md border border-success-border bg-success-muted px-3 py-2 text-sm text-success-muted-foreground">
                    <Icon name="check_circle" size={15} /> {credsNotice}
                  </div>
                ) : null}
                {canCredentials ? (
                  <div>
                    <Button type="submit" disabled={savingCreds} className="gap-1.5">
                      {savingCreds ? (
                        <>
                          <Icon name="progress_activity" size={16} className="animate-spin" /> Saving...
                        </>
                      ) : (
                        "Save credentials"
                      )}
                    </Button>
                  </div>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>
      </form>

      <Card className="gap-0 border-0 py-0">
        <CardHeader className="px-4 py-4">
          <CardTitle className="text-base font-semibold">Members</CardTitle>
          <CardDescription>Everyone with a seat in this workspace.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-border/60 border-t border-border/60">
            {data.members.map((m) => (
              <div key={m.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{m.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {m.userId ? `${m.userId} · ` : ""}
                    {m.email}
                  </div>
                </div>
                <Badge variant="secondary">{m.role}</Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {canDelete ? (
        <DeleteDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          title="Delete tenant"
          consequences={
            <>
              This removes <span className="font-medium">{data.name}</span> and every case, document,
              and channel under it. The owner account remains if it belongs to another workspace.
            </>
          }
          lines={[{ id: data.id, label: data.name, detail: data.slug }]}
          loading={false}
          onConfirm={async () => {
            await deletePlatformTenant(data.id);
            onDeleted();
          }}
        />
      ) : null}
    </div>
  );
}
