"use client";

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
import { Skeleton } from "@/components/ui/skeleton";
import type { WorkspacePrefs } from "@/features/auth/api";
import {
  canEditWorkspace,
  fetchMe,
  getWorkspacePrefs,
  logout,
  setWorkspacePrefs,
  updateWorkspace,
} from "@/features/auth/api";
import { initials } from "@/lib/format";
import type { LoginProfile } from "@/lib/http";
import { AuthRequiredError, getStoredProfile } from "@/lib/http";
import { matchTenantHost, originForSlug } from "@/lib/tenant-host";
import Link from "next/link";
import { useRouter } from "next/navigation";

function workspaceUrl(slug: string): string {
  if (typeof window === "undefined") return originForSlug(slug);
  const kind = matchTenantHost(window.location.host)?.kind ?? "prod";
  return originForSlug(slug, undefined, kind);
}
import * as React from "react";

function roleLabel(role: string) {
  if (!role) return "Member";
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function SettingsLinkRow({
  href,
  icon,
  title,
  description,
}: {
  href: string;
  icon: string;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="flex h-[58px] items-center gap-3 border-b px-4 transition-colors last:border-b-0 hover:bg-muted/50"
    >
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon name={icon} size={16} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{title}</div>
        <div className="truncate text-xs text-muted-foreground">{description}</div>
      </div>
      <Icon name="chevron_right" size={18} className="shrink-0 text-muted-foreground" />
    </Link>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const [profile, setProfile] = React.useState<LoginProfile | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [prefs, setPrefs] = React.useState<WorkspacePrefs>(getWorkspacePrefs);
  const [editOpen, setEditOpen] = React.useState(false);
  const [editName, setEditName] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [editError, setEditError] = React.useState<string | null>(null);

  React.useEffect(() => {
    // Cache read on mount - localStorage unavailable during SSR.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProfile(getStoredProfile());
    let cancelled = false;
    void (async () => {
      try {
        const me = await fetchMe();
        if (!cancelled) {
          setProfile(me);
          setError(null);
        }
      } catch (e) {
        if (cancelled) return;
        if (e instanceof AuthRequiredError) return;
        // Cached profile is still useful if /me fails transiently.
        if (!getStoredProfile()) {
          setError(e instanceof Error ? e.message : "Couldn't load your settings.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLogout() {
    await logout();
    router.push("/login");
  }

  function togglePref(key: keyof WorkspacePrefs) {
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    setWorkspacePrefs(next);
  }

  function openEdit() {
    if (!profile) return;
    setEditName(profile.tenant.name);
    setEditError(null);
    setEditOpen(true);
  }

  async function saveWorkspace() {
    const name = editName.trim();
    if (!name) {
      setEditError("Workspace name is required.");
      return;
    }
    setSaving(true);
    setEditError(null);
    try {
      const tenant = await updateWorkspace({ name });
      setProfile((prev) => (prev ? { ...prev, tenant: { ...prev.tenant, ...tenant } } : prev));
      setEditOpen(false);
    } catch (e) {
      if (e instanceof AuthRequiredError) return;
      setEditError(e instanceof Error ? e.message : "Couldn't update the workspace.");
    } finally {
      setSaving(false);
    }
  }

  const canEdit = canEditWorkspace(profile?.role);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <div className="space-y-1.5">
        <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
          Workspace
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-balance">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Your account, workspace and preferences.
        </p>
      </div>

      {error ? (
        <div className="border border-danger-border bg-danger-muted px-3 py-2 text-sm text-danger-muted-foreground">
          {error}
        </div>
      ) : null}

      {/* ---- Profile ---- */}
      <Card className="gap-0 overflow-hidden py-0">
        <div className="border-b px-4 py-3">
          <div className="font-medium">Profile</div>
          <p className="text-sm text-muted-foreground">How you appear to teammates on this workspace.</p>
        </div>
        {loading && !profile ? (
          <div className="flex items-center gap-3 px-4 py-4">
            <Skeleton className="size-12 rounded-full" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-56" />
            </div>
          </div>
        ) : profile ? (
          <div className="flex items-center gap-3 px-4 py-4">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-foreground">
              {initials(profile.user.name)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-base font-medium">{profile.user.name}</div>
              <div className="truncate text-sm text-muted-foreground">{profile.user.email}</div>
            </div>
            <Badge variant="outline" className="shrink-0 font-normal capitalize">
              {roleLabel(profile.role)}
            </Badge>
          </div>
        ) : (
          <div className="px-4 py-6 text-sm text-muted-foreground">
            Sign out and back in to load your profile.
          </div>
        )}
      </Card>

      {/* ---- Workspace ---- */}
      <Card className="gap-0 overflow-hidden py-0">
        <div className="border-b px-4 py-3">
          <div className="font-medium">Workspace</div>
          <p className="text-sm text-muted-foreground">This tenant&rsquo;s brand and setup surfaces.</p>
        </div>
        {profile ? (
          <div className="flex h-[58px] items-center gap-3 border-b px-4">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Icon name="apartment" size={16} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{profile.tenant.name}</div>
              <div className="truncate text-xs text-muted-foreground">
                {workspaceUrl(profile.tenant.slug)}
              </div>
            </div>
            {canEdit ? (
              <Button variant="outline" size="sm" className="gap-1.5" onClick={openEdit}>
                <Icon name="edit" size={14} /> Edit
              </Button>
            ) : null}
          </div>
        ) : null}
        <SettingsLinkRow
          href="/channels"
          icon="hub"
          title="Channels"
          description="Email and WhatsApp addresses subjects send documents to"
        />
        <SettingsLinkRow
          href="/workflows"
          icon="account_tree"
          title="Workflows"
          description="Stages, fields and checklist vocabulary for this workspace"
        />
      </Card>

      {/* ---- Notifications ---- */}
      <Card className="gap-0 overflow-hidden py-0">
        <div className="border-b px-4 py-3">
          <div className="font-medium">Notifications</div>
          <p className="text-sm text-muted-foreground">
            Controls what the header badge counts on this browser. Delivery (email/push) is not
            wired yet - this only filters the in-app attention inbox.
          </p>
        </div>
        {(
          [
            ["notifyNeedsReview", "Documents awaiting review"],
            ["notifyUnmatched", "Unmatched inbound documents"],
            ["notifyFollowUps", "Outstanding checklist items"],
          ] as const
        ).map(([key, label]) => (
          <label
            key={key}
            className="flex h-[58px] cursor-pointer items-center justify-between gap-3 border-b px-4 last:border-b-0"
          >
            <span className="text-sm font-medium">{label}</span>
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={prefs[key]}
              onChange={() => togglePref(key)}
            />
          </label>
        ))}
      </Card>

      {/* ---- Security ---- */}
      <Card className="gap-0 overflow-hidden py-0">
        <div className="border-b px-4 py-3">
          <div className="font-medium">Security</div>
          <p className="text-sm text-muted-foreground">Password and session.</p>
        </div>
        <div className="flex h-[58px] items-center justify-between gap-3 border-b px-4">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">Password</div>
            <div className="truncate text-xs text-muted-foreground">
              Reset via email - we never show your current password
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => router.push("/forgot")}>
            Change password
          </Button>
        </div>
        <div className="flex h-[58px] items-center justify-between gap-3 px-4">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">Sign out</div>
            <div className="truncate text-xs text-muted-foreground">
              End this session on this browser
            </div>
          </div>
          <Button variant="outline" size="sm" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={handleLogout}>
            Log out
          </Button>
        </div>
      </Card>

      <Dialog
        open={editOpen}
        onOpenChange={(open) => {
          if (saving) return;
          setEditOpen(open);
        }}
      >
        <DialogContent className="gap-0 p-0">
          <DialogHeader className="border-b">
            <DialogTitle>Edit workspace</DialogTitle>
            <DialogDescription>
              Company name shows in the sidebar for everyone in this workspace. The slug stays
              fixed.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 px-5 py-4">
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Company name</span>
              <Input
                value={editName}
                maxLength={80}
                autoFocus
                disabled={saving}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void saveWorkspace();
                }}
              />
            </label>
            {profile ? (
              <p className="text-xs text-muted-foreground">
                URL: {workspaceUrl(profile.tenant.slug)}
              </p>
            ) : null}
            {editError ? (
              <div className="border border-danger-border bg-danger-muted px-2.5 py-1.5 text-xs text-danger-muted-foreground">
                {editError}
              </div>
            ) : null}
          </div>
          <DialogFooter className="border-t">
            <Button variant="outline" disabled={saving} onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button disabled={saving || !editName.trim()} onClick={() => void saveWorkspace()}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
