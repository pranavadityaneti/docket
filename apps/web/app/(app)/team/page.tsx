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
  listWorkspaceRoleGrants,
  removeMember,
  updateMember,
  updateWorkspaceRoleGrants,
  type ApiMember,
} from "@/features/auth/api";
import {
  assignableRoles,
  canManageRoleGrants,
  canManageTeam,
  configurableRolesFor,
  isWorkspaceRole,
  WORKSPACE_PRIVILEGE_META,
  WORKSPACE_PRIVILEGES,
  WORKSPACE_ROLE_META,
  type ConfigurableWorkspaceRole,
  type Role,
  type WorkspacePrivilege,
} from "@/features/auth/roles";
import { useAsyncResource } from "@/hooks/use-async-resource";
import { useStoredProfile } from "@/hooks/use-stored-profile";
import { formatDate, initials } from "@/lib/format";
import { AuthRequiredError } from "@/lib/http";
import {
  EMAIL_MAX,
  MEMBER_NAME_MAX,
  MEMBER_TITLE_MAX,
  PASSWORD_MAX,
  PASSWORD_MIN,
  sanitizeEmail,
  setKeyedError,
  validateEmail,
  validateMemberTitle,
  validatePassword,
  validatePersonName
} from "@/lib/validators";
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
        description: WORKSPACE_ROLE_META[role].summary,
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
  const [draft, setDraft] = React.useState("");

  function startEdit() {
    setDraft(value ?? "");
    setEditing(true);
  }

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
        onClick={startEdit}
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
      onClick={startEdit}
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
  const [working, setWorking] = React.useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (working || o === open) return;
        if (!o) setWorking(false);
        onOpenChange(o);
      }}
    >
      {open ? (
        <AddMemberForm
          key={actorRole ?? "none"}
          actorRole={actorRole}
          working={working}
          setWorking={setWorking}
          onOpenChange={onOpenChange}
          onCreated={onCreated}
        />
      ) : null}
    </Dialog>
  );
}

function AddMemberForm({
  actorRole,
  working,
  setWorking,
  onOpenChange,
  onCreated,
}: {
  actorRole: string | undefined;
  working: boolean;
  setWorking: (w: boolean) => void;
  onOpenChange: (o: boolean) => void;
  onCreated: () => void;
}) {
  const roles = assignableRoles(actorRole);
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [role, setRole] = React.useState<Role>(
    roles.includes("agent") ? "agent" : (roles[0] ?? "agent"),
  );
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  function patchError(key: string, message: string | null) {
    setFieldErrors((prev) => setKeyedError(prev, key, message));
  }

  function validateMemberForm() {
    const next: Record<string, string> = {};
    const nameError = validatePersonName(name, { label: "Name", max: MEMBER_NAME_MAX });
    const titleError = validateMemberTitle(title);
    const emailError = validateEmail(email, { required: true });
    const passwordError = validatePassword(password);
    if (nameError) next.name = nameError;
    if (titleError) next.title = titleError;
    if (emailError) next.email = emailError;
    if (passwordError) next.password = passwordError;
    return next;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const nextErrors = validateMemberForm();
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
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
      <DialogContent className="gap-0 p-0">
        <form noValidate onSubmit={(e) => void submit(e)}>
          <DialogHeader className="border-b pr-10">
            <DialogTitle>Add teammate</DialogTitle>
            <DialogDescription>
              They get an email with their user ID, email, and the password you set. User IDs are
              assigned automatically.
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
                maxLength={MEMBER_NAME_MAX}
                value={name}
                aria-invalid={fieldErrors.name ? true : undefined}
                onChange={(e) => {
                  const next = e.target.value;
                  setName(next);
                  if (fieldErrors.name) {
                    patchError("name", validatePersonName(next, { label: "Name", max: MEMBER_NAME_MAX }));
                  }
                }}
                onBlur={() =>
                  patchError("name", validatePersonName(name, { label: "Name", max: MEMBER_NAME_MAX }))
                }
                placeholder="Priya Shah"
              />
              {fieldErrors.name ? <p className="text-xs text-danger">{fieldErrors.name}</p> : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="member-title" className="text-sm font-medium">
                Title
              </label>
              <Input
                id="member-title"
                maxLength={MEMBER_TITLE_MAX}
                value={title}
                aria-invalid={fieldErrors.title ? true : undefined}
                onChange={(e) => {
                  const next = e.target.value;
                  setTitle(next);
                  if (fieldErrors.title) patchError("title", validateMemberTitle(next));
                }}
                onBlur={() => patchError("title", validateMemberTitle(title))}
                placeholder="Loan officer"
              />
              {fieldErrors.title ? (
                <p className="text-xs text-danger">{fieldErrors.title}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Optional tag shown next to their name.
                </p>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="member-email" className="text-sm font-medium">
                Email
              </label>
              <Input
                id="member-email"
                type="email"
                required
                maxLength={EMAIL_MAX}
                value={email}
                aria-invalid={fieldErrors.email ? true : undefined}
                onChange={(e) => {
                  const next = sanitizeEmail(e.target.value);
                  setEmail(next);
                  if (fieldErrors.email) patchError("email", validateEmail(next, { required: true }));
                }}
                onBlur={() => patchError("email", validateEmail(email, { required: true }))}
                placeholder="priya@firm.example"
              />
              {fieldErrors.email ? <p className="text-xs text-danger">{fieldErrors.email}</p> : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="member-password" className="text-sm font-medium">
                Password
              </label>
              <PasswordInput
                id="member-password"
                autoComplete="new-password"
                required
                minLength={PASSWORD_MIN}
                maxLength={PASSWORD_MAX}
                value={password}
                aria-invalid={fieldErrors.password ? true : undefined}
                onChange={(e) => {
                  const next = e.target.value;
                  setPassword(next);
                  if (fieldErrors.password) patchError("password", validatePassword(next));
                }}
                onBlur={() => patchError("password", validatePassword(password))}
                placeholder="At least 6 characters"
              />
              {fieldErrors.password ? (
                <p className="text-xs text-danger">{fieldErrors.password}</p>
              ) : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="member-role" className="text-sm font-medium">
                Role
              </label>
              <RoleSelect id="member-role" value={role} roles={roles} onChange={setRole} />
              <div className="rounded-[10px] border bg-muted/50 px-3 py-2">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {WORKSPACE_ROLE_META[role].label} can
                </p>
                <p className="mt-0.5 text-sm leading-snug text-foreground">
                  {WORKSPACE_ROLE_META[role].summary}
                </p>
              </div>
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
  const [working, setWorking] = React.useState(false);
  return (
    <Dialog
      open={Boolean(member)}
      onOpenChange={(o) => {
        if (working || o || !member) return;
        setWorking(false);
        onClose();
      }}
    >
      {member ? (
        <PasswordForm
          key={member.id}
          member={member}
          working={working}
          setWorking={setWorking}
          onClose={onClose}
          onSaved={onSaved}
        />
      ) : null}
    </Dialog>
  );
}

function PasswordForm({
  member,
  working,
  setWorking,
  onClose,
  onSaved,
}: {
  member: ApiMember;
  working: boolean;
  setWorking: (w: boolean) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [passwordError, setPasswordError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const local = validatePassword(password);
    setPasswordError(local);
    if (local) return;
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
      <DialogContent className="gap-0 p-0">
        <form noValidate onSubmit={(e) => void submit(e)}>
          <DialogHeader className="border-b pr-10">
            <DialogTitle>Reset password</DialogTitle>
            <DialogDescription>{member.email}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 px-5 py-4">
            <PasswordInput
              autoComplete="new-password"
              required
              minLength={PASSWORD_MIN}
              maxLength={PASSWORD_MAX}
              value={password}
              aria-invalid={passwordError ? true : undefined}
              onChange={(e) => {
                const next = e.target.value;
                setPassword(next);
                if (passwordError) setPasswordError(validatePassword(next));
              }}
              onBlur={() => setPasswordError(validatePassword(password))}
              placeholder="At least 6 characters"
            />
            {passwordError ? <p className="text-xs text-danger">{passwordError}</p> : null}
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
  );
}

const CONFIGURABLE_COLUMNS = ["admin", "agent", "reviewer"] as const;
const PRIVILEGE_GROUPS = [...new Set(WORKSPACE_PRIVILEGES.map((p) => WORKSPACE_PRIVILEGE_META[p].group))];

function emptyGrants(): Record<ConfigurableWorkspaceRole, WorkspacePrivilege[]> {
  return { admin: [], agent: [], reviewer: [] };
}

function RolePermissionsDialog({
  open,
  onOpenChange,
  actorRole,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  actorRole: string | undefined;
}) {
  const [working, setWorking] = React.useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (working || o === open) return;
        if (!o) setWorking(false);
        onOpenChange(o);
      }}
    >
      {open ? (
        <RolePermissionsForm
          actorRole={actorRole}
          working={working}
          setWorking={setWorking}
          onOpenChange={onOpenChange}
        />
      ) : null}
    </Dialog>
  );
}

function RolePermissionsForm({
  actorRole,
  working,
  setWorking,
  onOpenChange,
}: {
  actorRole: string | undefined;
  working: boolean;
  setWorking: (w: boolean) => void;
  onOpenChange: (o: boolean) => void;
}) {
  const editable = configurableRolesFor(actorRole);
  const [grants, setGrants] = React.useState<Record<ConfigurableWorkspaceRole, WorkspacePrivilege[]>>(emptyGrants);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    void listWorkspaceRoleGrants()
      .then((data) => {
        if (cancelled) return;
        const next = emptyGrants();
        for (const row of data.roles) {
          if (row.role === "admin" || row.role === "agent" || row.role === "reviewer") {
            next[row.role] = [...row.privileges];
          }
        }
        setGrants(next);
      })
      .catch((err) => {
        if (cancelled || err instanceof AuthRequiredError) return;
        setError(err instanceof Error ? err.message : "Couldn't load permissions.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function toggle(role: ConfigurableWorkspaceRole, privilege: WorkspacePrivilege) {
    if (!editable.includes(role)) return;
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
      await Promise.all(editable.map((role) => updateWorkspaceRoleGrants(role, grants[role])));
      onOpenChange(false);
    } catch (err) {
      if (err instanceof AuthRequiredError) return;
      setError(err instanceof Error ? err.message : "Couldn't save permissions.");
    } finally {
      setWorking(false);
    }
  }

  return (
      <DialogContent className="gap-0 p-0 sm:max-w-3xl">
        <form onSubmit={(e) => void submit(e)}>
          <DialogHeader className="border-b pr-10">
            <DialogTitle>Role permissions</DialogTitle>
            <DialogDescription>
              Owner always has every permission. These switches apply to everyone with that role
              in this workspace.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading permissions…</p>
            ) : (
              <div className="grid grid-cols-[minmax(0,1.5fr)_repeat(3,minmax(0,1fr))] gap-x-3 gap-y-2">
                <div />
                {CONFIGURABLE_COLUMNS.map((role) => (
                  <div key={role} className="text-center text-xs font-medium">
                    {WORKSPACE_ROLE_META[role].label}
                    {!editable.includes(role) ? (
                      <div className="font-normal text-muted-foreground">View only</div>
                    ) : null}
                  </div>
                ))}
                {PRIVILEGE_GROUPS.map((group) => (
                  <React.Fragment key={group}>
                    <div className="col-span-4 pt-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground first:pt-0">
                      {group}
                    </div>
                    {WORKSPACE_PRIVILEGES.filter((p) => WORKSPACE_PRIVILEGE_META[p].group === group).map(
                      (privilege) => (
                        <React.Fragment key={privilege}>
                          <div className="min-w-0 py-1">
                            <div className="text-sm font-medium">{WORKSPACE_PRIVILEGE_META[privilege].label}</div>
                            <div className="text-[11px] text-muted-foreground">
                              {WORKSPACE_PRIVILEGE_META[privilege].summary}
                            </div>
                          </div>
                          {CONFIGURABLE_COLUMNS.map((role) => (
                            <label
                              key={`${role}-${privilege}`}
                              className="flex items-center justify-center"
                            >
                              <input
                                type="checkbox"
                                className="size-4 accent-primary"
                                checked={grants[role].includes(privilege)}
                                disabled={working || !editable.includes(role)}
                                onChange={() => toggle(role, privilege)}
                                aria-label={`${WORKSPACE_ROLE_META[role].label}: ${WORKSPACE_PRIVILEGE_META[privilege].label}`}
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
            <Button type="submit" disabled={working || loading || editable.length === 0}>
              {working ? "Saving..." : "Save permissions"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
  );
}

export default function TeamPage() {
  const profile = useStoredProfile();
  const actorRole = profile?.role;
  const meId = profile?.user.id;
  const manage = canManageTeam(actorRole, profile?.privileges);
  const canEditGrants = canManageRoleGrants(actorRole, profile?.privileges);
  const roles = assignableRoles(actorRole);

  const { data, error, loading, reload } = useAsyncResource(listMembers, [], {
    fallbackError: "Couldn't load the team.",
  });
  const [createOpen, setCreateOpen] = React.useState(false);
  const [permsOpen, setPermsOpen] = React.useState(false);
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
          <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
            Workspace
          </p>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Team</h1>
          <p className="text-sm text-muted-foreground">
            People who can sign into this workspace.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canEditGrants ? (
            <Button variant="outline" className="gap-1.5" onClick={() => setPermsOpen(true)}>
              <Icon name="tune" size={18} /> Role permissions
            </Button>
          ) : null}
          {manage ? (
            <Button className="gap-1.5" onClick={() => setCreateOpen(true)}>
              <Icon name="add" size={18} /> Add teammate
            </Button>
          ) : null}
        </div>
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
                          <div className="truncate text-xs text-muted-foreground">
                            <span className="font-mono">{member.userId}</span> · {member.email}
                          </div>
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
                      <div className="flex max-w-60 flex-col gap-1">
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
                        <span className="text-xs leading-snug text-foreground/75">
                          {lastOwner
                            ? "Last owner"
                            : manage && isMe
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

      <RolePermissionsDialog
        open={permsOpen}
        onOpenChange={setPermsOpen}
        actorRole={actorRole}
      />
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
