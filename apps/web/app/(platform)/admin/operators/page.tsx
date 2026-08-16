"use client";

import { EmptyState, ErrorBanner, LoadErrorState, PageSkeleton } from "@/components/shared/page-state";
import { PasswordInput } from "@/components/shared/password-input";
import { SelectMenu } from "@/components/shared/select-menu";
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
  createPlatformOperator,
  deletePlatformOperator,
  listPlatformOperators,
  listPlatformRoleGrants,
  updatePlatformOperator,
  updatePlatformRoleGrants,
  type PlatformOperator,
} from "@/features/platform/api";
import {
  CONFIGURABLE_PLATFORM_ROLES,
  PLATFORM_PRIVILEGE_META,
  PLATFORM_PRIVILEGES,
  PLATFORM_ROLE_META,
  PLATFORM_ROLES,
  isPlatformRole,
  type ConfigurablePlatformRole,
  type PlatformPrivilege,
  type PlatformRole,
} from "@/features/platform/roles";
import { usePlatformPrivilege, usePlatformSession } from "@/features/platform/session";
import { useAsyncResource } from "@/hooks/use-async-resource";
import { formatDate } from "@/lib/format";
import { AuthRequiredError } from "@/lib/http";
import { sanitizeEmail } from "@/lib/validators";
import * as React from "react";

function RoleSelect({
  id,
  value,
  onChange,
  disabled,
  roles = PLATFORM_ROLES,
}: {
  id?: string;
  value: PlatformRole;
  onChange: (role: PlatformRole) => void;
  disabled?: boolean;
  roles?: readonly PlatformRole[];
}) {
  return (
    <SelectMenu
      id={id}
      value={value}
      disabled={disabled}
      options={roles.map((role) => ({
        value: role,
        label: PLATFORM_ROLE_META[role].label,
      }))}
      onChange={(next) => {
        if (isPlatformRole(next)) onChange(next);
      }}
    />
  );
}

function CreateOperatorDialog({
  open,
  onOpenChange,
  onCreated,
  roles,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: () => void;
  roles: readonly PlatformRole[];
}) {
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [role, setRole] = React.useState<PlatformRole>(roles[0] ?? "admin");
  const [error, setError] = React.useState<string | null>(null);
  const [working, setWorking] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setEmail("");
      setPassword("");
      setRole(roles.includes("admin") ? "admin" : (roles[0] ?? "admin"));
      setError(null);
    }
  }, [open, roles]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setWorking(true);
    setError(null);
    try {
      await createPlatformOperator({ email: email.trim(), password, role });
      onOpenChange(false);
      onCreated();
    } catch (err) {
      if (err instanceof AuthRequiredError) return;
      setError(err instanceof Error ? err.message : "Couldn't add that operator.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (working ? null : onOpenChange(o))}>
      <DialogContent className="gap-0 p-0">
        <form onSubmit={(e) => void submit(e)}>
          <DialogHeader className="border-b pr-10">
            <DialogTitle>Add operator</DialogTitle>
            <DialogDescription>
              They sign in at /admin/login. This is not a tenant workspace seat.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 px-5 py-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="op-email" className="text-sm font-medium">
                Email
              </label>
              <Input
                id="op-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(sanitizeEmail(e.target.value))}
                placeholder="ops@finlot.ai"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="op-password" className="text-sm font-medium">
                Password
              </label>
              <PasswordInput
                id="op-password"
                autoComplete="new-password"
                required
                minLength={12}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 12 characters"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="op-role" className="text-sm font-medium">
                Role
              </label>
              <RoleSelect id="op-role" value={role} roles={roles} onChange={setRole} />
              <p className="text-xs text-muted-foreground">{PLATFORM_ROLE_META[role].summary}</p>
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
                  <Icon name="progress_activity" size={16} className="animate-spin" /> Adding...
                </>
              ) : (
                "Add operator"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PasswordDialog({
  operator,
  onClose,
  onSaved,
}: {
  operator: PlatformOperator | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [working, setWorking] = React.useState(false);

  React.useEffect(() => {
    setPassword("");
    setError(null);
  }, [operator]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!operator) return;
    setWorking(true);
    setError(null);
    try {
      await updatePlatformOperator(operator.id, { password });
      onSaved();
      onClose();
    } catch (err) {
      if (err instanceof AuthRequiredError) return;
      setError(err instanceof Error ? err.message : "Couldn't update the password.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <Dialog open={Boolean(operator)} onOpenChange={(o) => (working || o ? null : onClose())}>
      <DialogContent className="gap-0 p-0">
        <form onSubmit={(e) => void submit(e)}>
          <DialogHeader className="border-b pr-10">
            <DialogTitle>Reset password</DialogTitle>
            <DialogDescription>{operator?.email}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 px-5 py-4">
            <PasswordInput
              autoComplete="new-password"
              required
              minLength={12}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 12 characters"
            />
            {error ? <ErrorBanner>{error}</ErrorBanner> : null}
          </div>
          <DialogFooter className="flex-row justify-end gap-2 border-t">
            <Button type="button" variant="outline" onClick={onClose} disabled={working}>
              Cancel
            </Button>
            <Button type="submit" disabled={working}>
              Save password
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const PRIVILEGE_GROUPS = [...new Set(PLATFORM_PRIVILEGES.map((p) => PLATFORM_PRIVILEGE_META[p].group))];

function emptyGrants(): Record<ConfigurablePlatformRole, PlatformPrivilege[]> {
  return { admin: [], sub_admin: [] };
}

function RolePermissionsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [grants, setGrants] = React.useState<Record<ConfigurablePlatformRole, PlatformPrivilege[]>>(emptyGrants);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [working, setWorking] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setError(null);
    setLoading(true);
    void listPlatformRoleGrants()
      .then((data) => {
        const next = emptyGrants();
        for (const row of data.roles) {
          if (row.role === "admin" || row.role === "sub_admin") next[row.role] = [...row.privileges];
        }
        setGrants(next);
      })
      .catch((err) => {
        if (err instanceof AuthRequiredError) return;
        setError(err instanceof Error ? err.message : "Couldn't load permissions.");
      })
      .finally(() => setLoading(false));
  }, [open]);

  function toggle(role: ConfigurablePlatformRole, privilege: PlatformPrivilege) {
    setGrants((prev) => {
      const has = prev[role].includes(privilege);
      return {
        ...prev,
        [role]: has ? prev[role].filter((p) => p !== privilege) : [...prev[role], privilege],
      };
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setWorking(true);
    setError(null);
    try {
      await Promise.all(
        CONFIGURABLE_PLATFORM_ROLES.map((role) => updatePlatformRoleGrants(role, grants[role])),
      );
      onOpenChange(false);
    } catch (err) {
      if (err instanceof AuthRequiredError) return;
      setError(err instanceof Error ? err.message : "Couldn't save permissions.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (working ? null : onOpenChange(o))}>
      <DialogContent className="gap-0 p-0 sm:max-w-2xl">
        <form onSubmit={(e) => void submit(e)}>
          <DialogHeader className="border-b pr-10">
            <DialogTitle>Role permissions</DialogTitle>
            <DialogDescription>
              Super admin always has every permission. These switches apply to every Admin and
              Sub-admin on this console.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading permissions…</p>
            ) : (
              <div className="grid grid-cols-[minmax(0,1.4fr)_repeat(2,minmax(0,1fr))] gap-x-3 gap-y-2">
                <div />
                {CONFIGURABLE_PLATFORM_ROLES.map((role) => (
                  <div key={role} className="text-center text-xs font-medium">
                    {PLATFORM_ROLE_META[role].label}
                  </div>
                ))}
                {PRIVILEGE_GROUPS.map((group) => (
                  <React.Fragment key={group}>
                    <div className="col-span-3 pt-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground first:pt-0">
                      {group}
                    </div>
                    {PLATFORM_PRIVILEGES.filter((p) => PLATFORM_PRIVILEGE_META[p].group === group).map(
                      (privilege) => (
                        <React.Fragment key={privilege}>
                          <div className="min-w-0 py-1">
                            <div className="text-sm font-medium">{PLATFORM_PRIVILEGE_META[privilege].label}</div>
                            <div className="text-[11px] text-muted-foreground">
                              {PLATFORM_PRIVILEGE_META[privilege].summary}
                            </div>
                          </div>
                          {CONFIGURABLE_PLATFORM_ROLES.map((role) => (
                            <label
                              key={`${role}-${privilege}`}
                              className="flex items-center justify-center"
                            >
                              <input
                                type="checkbox"
                                className="size-4 accent-primary"
                                checked={grants[role].includes(privilege)}
                                disabled={working}
                                onChange={() => toggle(role, privilege)}
                                aria-label={`${PLATFORM_ROLE_META[role].label}: ${PLATFORM_PRIVILEGE_META[privilege].label}`}
                              />
                            </label>
                          ))}
                        </React.Fragment>
                      ),
                    )}
                  </React.Fragment>
                ))}
              </div>
            )}
            {error ? <div className="mt-3"><ErrorBanner>{error}</ErrorBanner></div> : null}
          </div>
          <DialogFooter className="flex-row justify-end gap-2 border-t">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={working}>
              Cancel
            </Button>
            <Button type="submit" disabled={working || loading}>
              {working ? "Saving..." : "Save permissions"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function OperatorsPage() {
  const { profile } = usePlatformSession();
  const canWrite = usePlatformPrivilege("operators.write");
  const isSuper = profile?.role === "super_admin";
  const assignableRoles: readonly PlatformRole[] = isSuper
    ? PLATFORM_ROLES
    : CONFIGURABLE_PLATFORM_ROLES;
  const { data, error, loading, reload } = useAsyncResource(listPlatformOperators, [], {
    fallbackError: "Couldn't load operators.",
  });
  const [createOpen, setCreateOpen] = React.useState(false);
  const [permsOpen, setPermsOpen] = React.useState(false);
  const [passwordFor, setPasswordFor] = React.useState<PlatformOperator | null>(null);
  const [rowError, setRowError] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const superAdminCount = (data ?? []).filter((o) => o.role === "super_admin").length;
  const meId = profile?.user.id;

  async function changeRole(op: PlatformOperator, role: PlatformRole) {
    if (role === op.role) return;
    setBusyId(op.id);
    setRowError(null);
    try {
      await updatePlatformOperator(op.id, { role });
      reload();
    } catch (err) {
      if (err instanceof AuthRequiredError) return;
      setRowError(err instanceof Error ? err.message : "Couldn't update the role.");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(op: PlatformOperator) {
    if (!window.confirm(`Remove ${op.email} from the platform console?`)) return;
    setBusyId(op.id);
    setRowError(null);
    try {
      await deletePlatformOperator(op.id);
      reload();
    } catch (err) {
      if (err instanceof AuthRequiredError) return;
      setRowError(err instanceof Error ? err.message : "Couldn't remove that operator.");
    } finally {
      setBusyId(null);
    }
  }

  if (loading && !data) return <PageSkeleton />;
  if (error && !data) return <LoadErrorState error={error} onRetry={reload} />;

  const rows = data ?? [];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Operators</h1>
          <p className="text-sm text-muted-foreground">
            People who can sign into this console. Separate from tenant workspace members.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isSuper ? (
            <Button variant="outline" className="gap-1.5" onClick={() => setPermsOpen(true)}>
              <Icon name="tune" size={18} /> Role permissions
            </Button>
          ) : null}
          {canWrite ? (
            <Button className="gap-1.5" onClick={() => setCreateOpen(true)}>
              <Icon name="add" size={18} /> Add operator
            </Button>
          ) : null}
        </div>
      </div>

      {rowError ? <ErrorBanner>{rowError}</ErrorBanner> : null}
      {error ? <ErrorBanner>{error}</ErrorBanner> : null}

      {rows.length === 0 ? (
        <EmptyState
          icon="admin_panel_settings"
          title="No operators"
          description="Add an admin or sub-admin to share this console."
          action={
            canWrite ? (
              <Button className="gap-1.5" onClick={() => setCreateOpen(true)}>
                <Icon name="add" size={18} /> Add operator
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card className="gap-0 overflow-hidden border-0 py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Operator</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Added</TableHead>
                {canWrite ? <TableHead className="text-right">Actions</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((op) => {
                const isMe = op.id === meId;
                const lastSuper = op.role === "super_admin" && superAdminCount <= 1;
                const superLocked = !isSuper && op.role === "super_admin";
                const locked = isMe || lastSuper || superLocked;
                return (
                  <TableRow key={op.id}>
                    <TableCell>
                      <div className="font-medium">{op.name}</div>
                      <div className="text-xs text-muted-foreground">{op.email}</div>
                    </TableCell>
                    <TableCell>
                      <div className="flex max-w-[220px] flex-col gap-1">
                        {canWrite && !superLocked ? (
                          <RoleSelect
                            value={op.role}
                            roles={assignableRoles}
                            disabled={Boolean(busyId) || locked}
                            onChange={(role) => void changeRole(op, role)}
                          />
                        ) : (
                          <span className="text-sm">{PLATFORM_ROLE_META[op.role].label}</span>
                        )}
                        {isMe ? (
                          <span className="text-[11px] text-muted-foreground">You</span>
                        ) : lastSuper ? (
                          <span className="text-[11px] text-muted-foreground">Last super admin</span>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">
                            {PLATFORM_ROLE_META[op.role].summary}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(op.createdAt)}</TableCell>
                    {canWrite ? (
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={Boolean(busyId) || superLocked}
                            onClick={() => setPasswordFor(op)}
                          >
                            Password
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            disabled={Boolean(busyId) || locked}
                            onClick={() => void remove(op)}
                          >
                            Remove
                          </Button>
                        </div>
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      <CreateOperatorDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={reload}
        roles={assignableRoles}
      />
      <RolePermissionsDialog open={permsOpen} onOpenChange={setPermsOpen} />
      <PasswordDialog
        operator={passwordFor}
        onClose={() => setPasswordFor(null)}
        onSaved={reload}
      />
    </div>
  );
}
