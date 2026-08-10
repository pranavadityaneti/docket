import {
  apiFetch,
  publicJsonFetch,
  publicPost,
  writeProfile,
  clearSession,
  getStoredProfile,
  type LoginProfile,
} from "@/lib/http";

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
  name: string;
  email: string;
  role: string;
};

/** POST /auth/login - sets httpOnly cookie; returns profile only. */
export async function login(email: string, password: string): Promise<LoginProfile> {
  const profile = await publicJsonFetch<LoginProfile>(
    "/auth/login",
    { email, password },
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

/** Owner/admin can rename the workspace; agents and reviewers are read-only. */
export function canEditWorkspace(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

export type WorkspaceTenant = { id: string; name: string; slug: string };

/** Fired after workspace/profile cache changes so chrome (sidebar) can refresh. */
export const PROFILE_UPDATED_EVENT = "docket:profile-updated";

function emitProfileUpdated(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(PROFILE_UPDATED_EVENT));
  }
}

/** PATCH /auth/workspace - rename this tenant (owner/admin only). */
export async function updateWorkspace(input: {
  name: string;
}): Promise<WorkspaceTenant> {
  const tenant = await apiFetch<WorkspaceTenant>("/auth/workspace", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
  const profile = getStoredProfile();
  if (profile) {
    writeProfile({ ...profile, tenant: { ...profile.tenant, ...tenant } });
    emitProfileUpdated();
  }
  return tenant;
}

export async function requestPasswordReset(email: string): Promise<void> {
  await publicPost("/auth/forgot-password", { email }, "Request failed");
}

export async function resetPassword(token: string, password: string): Promise<void> {
  await publicPost("/auth/reset-password", { token, password }, "Reset failed");
}

export { getStoredProfile as readStoredProfile } from "@/lib/http";
