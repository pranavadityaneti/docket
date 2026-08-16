import {
  API_URL,
  AuthRequiredError,
  apiFetch,
  friendlyErrorMessage,
  publicJsonFetch,
  publicPost,
  writeProfile,
  clearSession,
  getStoredProfile,
  type LoginProfile,
} from "@/lib/http";
import { hasWorkspacePrivilege, type WorkspacePrivilege } from "@/features/auth/roles";
import { resolveWorkspaceSlug } from "@/lib/tenant-host";

export type { LoginProfile } from "@/lib/http";
export {
  AuthRequiredError,
  AUTH_REQUIRED_EVENT,
  isLoggedIn,
  getStoredProfile,
} from "@/lib/http";

/** Workspace UI preferences - local until a server prefs API exists. */
export type WorkspacePrefs = {
  notifyNeedsReview: boolean;
  notifyUnmatched: boolean;
  notifyFollowUps: boolean;
};

const PREFS_KEY = "docket_prefs";

const DEFAULT_PREFS: WorkspacePrefs = {
  notifyNeedsReview: true,
  notifyUnmatched: true,
  notifyFollowUps: true,
};

export function getWorkspacePrefs(): WorkspacePrefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  const raw = window.localStorage.getItem(PREFS_KEY);
  if (!raw) return DEFAULT_PREFS;
  try {
    return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<WorkspacePrefs>) };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function setWorkspacePrefs(next: WorkspacePrefs): void {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(next));
  }
}

export type ApiMember = {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: string;
  title: string | null;
  createdAt?: string;
};

/** POST /auth/login - sets httpOnly cookie; returns profile only. */
export async function login(
  userId: string,
  email: string,
  password: string,
): Promise<LoginProfile> {
  const tenantSlug = resolveWorkspaceSlug();
  const profile = await publicJsonFetch<LoginProfile>(
    "/auth/login",
    {
      userId,
      email,
      password,
      ...(tenantSlug ? { tenantSlug } : {}),
    },
    "Login failed",
  );
  writeProfile(profile);
  return profile;
}

/** POST /auth/logout - clears cookies server-side. */
export async function logout(): Promise<void> {
  try {
    await apiFetch("/auth/logout", { method: "POST" });
  } catch {
    // Still clear local cache even if the network call fails.
  }
  clearSession();
}

export async function fetchMe(): Promise<LoginProfile> {
  const profile = await apiFetch<LoginProfile>("/auth/me");
  writeProfile(profile);
  return profile;
}

export function listMembers(): Promise<ApiMember[]> {
  return apiFetch<ApiMember[]>("/auth/members");
}

export function addMember(input: {
  name: string;
  email: string;
  role: string;
  password: string;
  title?: string;
}): Promise<ApiMember> {
  return apiFetch<ApiMember>("/auth/members", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateMember(
  userId: string,
  input: { name?: string; role?: string; password?: string; title?: string },
): Promise<ApiMember> {
  return apiFetch<ApiMember>(`/auth/members/${userId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function removeMember(userId: string): Promise<{ ok: true; id: string; email: string }> {
  return apiFetch(`/auth/members/${userId}`, { method: "DELETE" });
}

/** Owner always can; others follow the tenant's role permissions. */
export function canEditWorkspace(
  role: string | null | undefined,
  privileges?: readonly string[] | undefined,
): boolean {
  return hasWorkspacePrivilege(role, privileges, "workspace.edit");
}

export type WorkspaceTenant = {
  id: string;
  publicId?: string;
  name: string;
  slug: string;
  logoUpdatedAt?: string | null;
};

export function workspaceLogoUrl(tenant: {
  logoUpdatedAt?: string | null;
} | null | undefined): string | null {
  if (!tenant?.logoUpdatedAt) return null;
  return `${API_URL}/auth/workspace/logo?v=${encodeURIComponent(tenant.logoUpdatedAt)}`;
}

export type PublicWorkspace = {
  name: string;
  slug: string;
  logoUpdatedAt: string | null;
};

export function publicWorkspaceLogoUrl(workspace: PublicWorkspace): string | null {
  if (!workspace.logoUpdatedAt) return null;
  return `${API_URL}/auth/public/workspace/logo?slug=${encodeURIComponent(workspace.slug)}&v=${encodeURIComponent(workspace.logoUpdatedAt)}`;
}

export async function fetchPublicWorkspace(slug: string): Promise<PublicWorkspace> {
  const res = await fetch(`${API_URL}/auth/public/workspace?slug=${encodeURIComponent(slug)}`);
  const parsed = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      parsed && typeof parsed === "object" && "message" in parsed && typeof parsed.message === "string"
        ? parsed.message
        : "Couldn't load this workspace";
    throw new Error(message);
  }
  return parsed as PublicWorkspace;
}

/** Fired after workspace/profile cache changes so chrome (sidebar) can refresh. */
export const PROFILE_UPDATED_EVENT = "docket:profile-updated";

function emitProfileUpdated(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(PROFILE_UPDATED_EVENT));
  }
}

function cacheTenant(tenant: WorkspaceTenant): WorkspaceTenant {
  const profile = getStoredProfile();
  if (profile) {
    writeProfile({ ...profile, tenant: { ...profile.tenant, ...tenant } });
    emitProfileUpdated();
  }
  return tenant;
}

/** PATCH /auth/workspace - rename this tenant (owner/admin only). */
export async function updateWorkspace(input: {
  name: string;
}): Promise<WorkspaceTenant> {
  const tenant = await apiFetch<WorkspaceTenant>("/auth/workspace", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  return cacheTenant(tenant);
}

export async function uploadWorkspaceLogo(file: File): Promise<WorkspaceTenant> {
  const res = await fetch(`${API_URL}/auth/workspace/logo`, {
    method: "PUT",
    credentials: "include",
    headers: { "content-type": file.type || "image/png" },
    body: file,
  });
  if (res.status === 401) {
    throw new AuthRequiredError();
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(friendlyErrorMessage(body, "Couldn't upload the logo"));
  }
  return cacheTenant((await res.json()) as WorkspaceTenant);
}

export async function deleteWorkspaceLogo(): Promise<WorkspaceTenant> {
  const tenant = await apiFetch<WorkspaceTenant>("/auth/workspace/logo", {
    method: "DELETE",
  });
  return cacheTenant(tenant);
}

export async function requestPasswordReset(email: string): Promise<void> {
  const tenantSlug = resolveWorkspaceSlug();
  await publicPost(
    "/auth/forgot-password",
    { email, ...(tenantSlug ? { tenantSlug } : {}) },
    "Request failed",
  );
}

export async function resetPassword(token: string, password: string): Promise<void> {
  await publicPost("/auth/reset-password", { token, password }, "Reset failed");
}

export type WorkspaceRoleGrants = {
  roles: {
    role: string;
    locked: boolean;
    privileges: WorkspacePrivilege[];
  }[];
};

export function listWorkspaceRoleGrants(): Promise<WorkspaceRoleGrants> {
  return apiFetch("/auth/roles");
}

export function updateWorkspaceRoleGrants(
  role: string,
  privileges: WorkspacePrivilege[],
): Promise<{ role: string; locked: boolean; privileges: WorkspacePrivilege[] }> {
  return apiFetch(`/auth/roles/${encodeURIComponent(role)}`, {
    method: "PUT",
    body: JSON.stringify({ privileges }),
  });
}

export { getStoredProfile as readStoredProfile } from "@/lib/http";
