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
  addMember,
  listMembers,
  removeMember,
  updateMember,
  type ApiMember,
} from "@/features/auth/api";
import {
  assignableRoles,
  canManageTeam,
  isWorkspaceRole,
  WORKSPACE_ROLE_META,
  type Role,
} from "@/features/auth/roles";
import { useAsyncResource } from "@/hooks/use-async-resource";
import { formatDate, initials } from "@/lib/format";
import { AuthRequiredError, getStoredProfile, type LoginProfile } from "@/lib/http";
import * as React from "react";

function RoleSelect({
  id,
  value,
  roles,
  onChange,
  disabled,
}: {
  id?: string;
  value: Role;
  roles: Role[];
  onChange: (role: Role) => void;
  disabled?: boolean;
}) {
  return (
    <SelectMenu
      id={id}
      value={value}
      disabled={disabled}
      options={roles.map((role) => ({
        value: role,
        label: WORKSPACE_ROLE_META[role].label,
      }))}
      onChange={(next) => {
        if (isWorkspaceRole(next)) onChange(next);
      }}
    />
  );
}

function MemberTitleTag({
  value,
  disabled,
  onSave,
}: {
  value: string | null;
  disabled?: boolean;
  onSave?: (next: string) => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value ?? "");

  React.useEffect(() => {
    setDraft(value ?? "");
    setEditing(false);
  }, [value]);

  function commit() {
    const next = draft.trim();
    setEditing(false);
    if (next === (value ?? "").trim()) return;
    onSave?.(next);
  }

  if (!onSave) {
    if (!value) return null;
    return (
      <Badge variant="secondary" className="mt-1 max-w-full truncate font-normal">
        {value}
      </Badge>
    );
  }

  if (editing) {
    return (
      <Input
        autoFocus
        className="mt-1 h-7 px-2 text-xs"
        maxLength={40}
        value={draft}
        disabled={disabled}
        placeholder="Loan officer"
        aria-label="Title"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
          if (e.key === "Escape") {
            setDraft(value ?? "");
            setEditing(false);
          }
        }}
      />
    );
  }

  if (value) {
    return (
      <button
        type="button"
        disabled={disabled}
        className="mt-1 max-w-full text-left"
        onClick={() => setEditing(true)}
        aria-label={`Edit title ${value}`}
      >
        <Badge variant="secondary" className="max-w-full truncate font-normal">
          {value}
        </Badge>
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled={disabled}
      className="mt-1 text-[11px] text-muted-foreground hover:text-foreground"
      onClick={() => setEditing(true)}
    >
      Add title
    </button>
  );
}

function AddMemberDialog({
  open,
  onOpenChange,
  actorRole,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  actorRole: string | undefined;
  onCreated: () => void;
}) {
  const roles = assignableRoles(actorRole);
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [role, setRole] = React.useState<Role>(roles[0] ?? "agent");
  const [error, setError] = React.useState<string | null>(null);
  const [working, setWorking] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      const nextRoles = assignableRoles(actorRole);
      setName("");
      setEmail("");
      setPassword("");
      setTitle("");
      setRole(nextRoles.includes("agent") ? "agent" : (nextRoles[0] ?? "agent"));
      setError(null);
    }
  }, [open, actorRole]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setWorking(true);
    setError(null);
    try {
      await addMember({
        name: name.trim(),
        email: email.trim(),
        role,
        password,
        title: title.trim(),
      });
      onOpenChange(false);
      onCreated();
    } catch (err) {
      if (err instanceof AuthRequiredError) return;
      setError(err instanceof Error ? err.message : "Couldn't add that person.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (working ? undefined : onOpenChange(o))}>
      <DialogContent className="gap-0 p-0">
        <form onSubmit={(e) => void submit(e)}>
          <DialogHeader className="border-b pr-10">
            <DialogTitle>Add teammate</DialogTitle>
            <DialogDescription>
              They sign in at this workspace with the email and password you set. If they already
              have a Docket account, they keep their existing password.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 px-5 py-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="member-name" className="text-sm font-medium">
                Name
              </label>
              <Input
                id="member-name"
                required
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Priya Shah"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="member-title" className="text-sm font-medium">
                Title
              </label>
              <Input
                id="member-title"
                maxLength={40}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Loan officer"
              />
              <p className="text-xs text-muted-foreground">
                Optional tag shown next to their name.
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="member-email" className="text-sm font-medium">
                Email
              </label>
              <Input
                id="member-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="priya@firm.example"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="member-password" className="text-sm font-medium">
                Password
              </label>
              <PasswordInput
                id="member-password"
                autoComplete="new-password"
                required
                minLength={12}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 12 characters"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="member-role" className="text-sm font-medium">
                Role
              </label>
              <RoleSelect id="member-role" value={role} roles={roles} onChange={setRole} />
              <p className="text-xs text-muted-foreground">{WORKSPACE_ROLE_META[role].summary}</p>
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
                "Add teammate"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PasswordDialog({
  member,
  onClose,
  onSaved,
}: {
  member: ApiMember | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [working, setWorking] = React.useState(false);

  React.useEffect(() => {
    setPassword("");
    setError(null);
  }, [member]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!member) return;
    setWorking(true);
    setError(null);
    try {
      await updateMember(member.id, { password });
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
    <Dialog open={Boolean(member)} onOpenChange={(o) => (working || o ? undefined : onClose())}>
      <DialogContent className="gap-0 p-0">
        <form onSubmit={(e) => void submit(e)}>
          <DialogHeader className="border-b pr-10">
            <DialogTitle>Reset password</DialogTitle>
            <DialogDescription>{member?.email}</DialogDescription>
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

export default function TeamPage() {
  const [profile, setProfile] = React.useState<LoginProfile | null>(null);
  React.useEffect(() => {
    setProfile(getStoredProfile());
  }, []);
  const actorRole = profile?.role;
  const meId = profile?.user.id;
  const manage = canManageTeam(actorRole);
  const roles = assignableRoles(actorRole);

  const { data, error, loading, reload } = useAsyncResource(listMembers, [], {
    fallbackError: "Couldn't load the team.",
  });
  const [createOpen, setCreateOpen] = React.useState(false);
  const [passwordFor, setPasswordFor] = React.useState<ApiMember | null>(null);
  const [rowError, setRowError] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const ownerCount = (data ?? []).filter((m) => m.role === "owner").length;

  function canEditRole(member: ApiMember): boolean {
    if (!manage) return false;
    if (member.id === meId) return false;
    if (actorRole === "admin" && member.role === "owner") return false;
    if (member.role === "owner" && ownerCount <= 1) return false;
    return true;
  }

  function canResetPassword(member: ApiMember): boolean {
    if (!manage) return false;
    if (actorRole === "admin" && member.role === "owner") return false;
    return true;
  }

  function canRemove(member: ApiMember): boolean {
    return canEditRole(member);
  }

  function canEditTitle(member: ApiMember): boolean {
    if (!manage) return false;
    if (actorRole === "admin" && member.role === "owner") return false;
    return true;
  }

  async function changeTitle(member: ApiMember, title: string) {
    if (title === (member.title ?? "")) return;
    setBusyId(member.id);
    setRowError(null);
    try {
      await updateMember(member.id, { title });
      reload();
    } catch (err) {
      if (err instanceof AuthRequiredError) return;
      setRowError(err instanceof Error ? err.message : "Couldn't update the title.");
    } finally {
      setBusyId(null);
    }
  }

  async function changeRole(member: ApiMember, role: Role) {
    if (role === member.role) return;
    setBusyId(member.id);
    setRowError(null);
    try {
      await updateMember(member.id, { role });
      reload();
    } catch (err) {
      if (err instanceof AuthRequiredError) return;
      setRowError(err instanceof Error ? err.message : "Couldn't update the role.");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(member: ApiMember) {
    if (!window.confirm(`Remove ${member.email} from this workspace?`)) return;
    setBusyId(member.id);
    setRowError(null);
    try {
      await removeMember(member.id);
      reload();
    } catch (err) {
      if (err instanceof AuthRequiredError) return;
      setRowError(err instanceof Error ? err.message : "Couldn't remove that person.");
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
          <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
            Workspace
          </p>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Team</h1>
          <p className="text-sm text-muted-foreground">
            People who can sign into this workspace.
          </p>
        </div>
        {manage ? (
          <Button className="gap-1.5" onClick={() => setCreateOpen(true)}>
            <Icon name="add" size={18} /> Add teammate
          </Button>
        ) : null}
      </div>

      {rowError ? <ErrorBanner>{rowError}</ErrorBanner> : null}
      {error ? <ErrorBanner>{error}</ErrorBanner> : null}

      {rows.length === 0 ? (
        <EmptyState
          icon="group"
          title="No teammates"
          description="Add someone so they can work cases in this workspace."
          action={
            manage ? (
              <Button className="gap-1.5" onClick={() => setCreateOpen(true)}>
                <Icon name="add" size={18} /> Add teammate
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card className="gap-0 overflow-hidden border-0 py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Person</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Added</TableHead>
                {manage ? <TableHead className="text-right">Actions</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((member) => {
                const role = isWorkspaceRole(member.role) ? member.role : "agent";
                const isMe = member.id === meId;
                const lastOwner = member.role === "owner" && ownerCount <= 1;
                const roleLocked = !canEditRole(member);
                return (
                  <TableRow key={member.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground">
                          {initials(member.name)}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate font-medium">
                            {member.name}
                            {isMe ? (
                              <span className="ml-1.5 text-xs font-normal text-muted-foreground">You</span>
                            ) : null}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">{member.email}</div>
                          <MemberTitleTag
                            value={member.title ?? null}
                            disabled={Boolean(busyId)}
                            onSave={
                              canEditTitle(member)
                                ? (next) => void changeTitle(member, next)
                                : undefined
                            }
                          />
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex max-w-[240px] flex-col gap-1">
                        {manage && !roleLocked ? (
                          <RoleSelect
                            value={role}
                            roles={roles}
                            disabled={Boolean(busyId)}
                            onChange={(next) => void changeRole(member, next)}
                          />
                        ) : (
                          <span className="text-sm">{WORKSPACE_ROLE_META[role].label}</span>
                        )}
                        <span className="text-[11px] text-muted-foreground">
                          {lastOwner
                            ? "Last owner"
                            : isMe
                              ? "You cannot change your own role"
                              : WORKSPACE_ROLE_META[role].summary}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {member.createdAt ? formatDate(member.createdAt) : "—"}
                    </TableCell>
                    {manage ? (
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={Boolean(busyId) || !canResetPassword(member)}
                            onClick={() => setPasswordFor(member)}
                          >
                            Password
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            disabled={Boolean(busyId) || !canRemove(member)}
                            onClick={() => void remove(member)}
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

      <AddMemberDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        actorRole={actorRole}
        onCreated={reload}
      />
      <PasswordDialog
        member={passwordFor}
        onClose={() => setPasswordFor(null)}
        onSaved={reload}
      />
    </div>
  );
}
