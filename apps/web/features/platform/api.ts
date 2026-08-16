import {
  API_URL,
  AuthRequiredError,
  friendlyErrorMessage,
  publicJsonFetch,
} from "@/lib/http";
import { isPlatformRole, PLATFORM_ROLE_META, type PlatformPrivilege, type PlatformRole } from "./roles";

export const PLATFORM_AUTH_REQUIRED_EVENT = "docket:platform-auth-required";
export const ADMIN_SESSION_COOKIE = "docket_admin_session";
const PLATFORM_PROFILE_KEY = "docket_platform_profile";

export type PlatformProfile = {
  user: { id: string; name: string; email: string };
  role: PlatformRole;
  privileges: PlatformPrivilege[];
};

export type PlatformOverview = {
  tenantCount: number;
  tenantsCreatedThisWeek: number;
};

export type PlatformTenantListItem = {
  id: string;
  publicId: string;
  name: string;
  slug: string;
  plan: string;
  createdAt: string;
  logoUpdatedAt?: string | null;
  owner: { name: string; userId?: string; email: string } | null;
  memberCount: number;
};

export type PlatformTenantDetail = {
  id: string;
  publicId: string;
  name: string;
  slug: string;
  plan: string;
  createdAt: string;
  logoUpdatedAt?: string | null;
  owner: { id: string; userId?: string; name: string; email: string; role: string } | null;
  members: {
    id: string;
    userId?: string;
    name: string;
    email: string;
    role: string;
    createdAt: string;
  }[];
};

export type CreateTenantInput = {
  name: string;
  slug: string;
  plan?: string;
  ownerName: string;
  ownerEmail: string;
  ownerPassword: string;
};

export type ProvisionedTenant = {
  tenant: { id: string; publicId: string; name: string; slug: string; plan: string };
  owner: { id: string; userId: string; name: string; email: string };
  ownerCreated: boolean;
  passwordSet: boolean;
};

function readBrowserCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  const match = document.cookie
    .split(";")
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${name}=`));
  if (!match) return undefined;
  return decodeURIComponent(match.slice(name.length + 1));
}

export function isPlatformLoggedIn(): boolean {
  return readBrowserCookie(ADMIN_SESSION_COOKIE) === "1";
}

function clearAdminPresenceCookie(): void {
  if (typeof document === "undefined") return;
  document.cookie = `${ADMIN_SESSION_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}

export function writePlatformProfile(profile: PlatformProfile): void {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(PLATFORM_PROFILE_KEY, JSON.stringify(profile));
  }
}

export function getStoredPlatformProfile(): PlatformProfile | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(PLATFORM_PROFILE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PlatformProfile>;
    if (!parsed?.user?.id || !parsed.user.email) return null;
    const role: PlatformRole = isPlatformRole(String(parsed.role)) ? parsed.role : "super_admin";
    const privileges = Array.isArray(parsed.privileges)
      ? (parsed.privileges as PlatformPrivilege[])
      : PLATFORM_ROLE_META[role].privileges;
    return {
      user: {
        id: parsed.user.id,
        name: parsed.user.name ?? parsed.user.email,
        email: parsed.user.email,
      },
      role,
      privileges,
    };
  } catch {
    return null;
  }
}

export function clearPlatformSession(): void {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(PLATFORM_PROFILE_KEY);
    clearAdminPresenceCookie();
  }
}

function emitPlatformAuthRequired(): void {
  clearPlatformSession();
  if (typeof window !== "undefined") {
    void fetch(`${API_URL}/platform/auth/logout`, {
      method: "POST",
      credentials: "include",
    }).catch(() => {});
    window.dispatchEvent(new Event(PLATFORM_AUTH_REQUIRED_EVENT));
  }
}

async function platformFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 401) {
    emitPlatformAuthRequired();
    throw new AuthRequiredError();
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      friendlyErrorMessage(
        body,
        `${init.method ?? "GET"} ${path} failed (${res.status}) ${body}`.trim(),
      ),
    );
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function platformAuthStatus(): Promise<{ needsSetup: boolean }> {
  return fetch(`${API_URL}/platform/auth/status`, { credentials: "include" }).then(async (res) => {
    if (!res.ok) throw new Error("Could not reach the platform console.");
    return (await res.json()) as { needsSetup: boolean };
  });
}

export async function platformLogin(email: string, password: string): Promise<PlatformProfile> {
  const profile = await publicJsonFetch<PlatformProfile>(
    "/platform/auth/login",
    { email, password },
    "Login failed",
  );
  writePlatformProfile(profile);
  return profile;
}

export async function platformBootstrap(input: {
  email: string;
  password: string;
}): Promise<PlatformProfile> {
  const profile = await publicJsonFetch<PlatformProfile>(
    "/platform/auth/bootstrap",
    input,
    "Could not create the platform admin",
  );
  writePlatformProfile(profile);
  return profile;
}

export async function platformLogout(): Promise<void> {
  try {
    await platformFetch("/platform/auth/logout", { method: "POST" });
  } catch {
    // Clear local cache even if the network call fails.
  }
  clearPlatformSession();
}

export async function fetchPlatformMe(): Promise<PlatformProfile> {
  const profile = await platformFetch<PlatformProfile>("/platform/auth/me");
  writePlatformProfile(profile);
  return profile;
}

export function fetchPlatformOverview(): Promise<PlatformOverview> {
  return platformFetch<PlatformOverview>("/platform/tenants/overview");
}

export function listPlatformTenants(): Promise<PlatformTenantListItem[]> {
  return platformFetch<PlatformTenantListItem[]>("/platform/tenants");
}

export function getPlatformTenant(id: string): Promise<PlatformTenantDetail> {
  return platformFetch<PlatformTenantDetail>(`/platform/tenants/${id}`);
}

export function platformTenantLogoUrl(tenant: {
  id: string;
  logoUpdatedAt?: string | null;
} | null | undefined): string | null {
  if (!tenant?.id || !tenant.logoUpdatedAt) return null;
  return `${API_URL}/platform/tenants/${tenant.id}/logo?v=${encodeURIComponent(tenant.logoUpdatedAt)}`;
}

export function createPlatformTenant(input: CreateTenantInput): Promise<ProvisionedTenant> {
  return platformFetch<ProvisionedTenant>("/platform/tenants", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updatePlatformTenant(
  id: string,
  input: { name?: string; plan?: string },
): Promise<{ id: string; name: string; slug: string; plan: string }> {
  return platformFetch(`/platform/tenants/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function updatePlatformTenantCredentials(
  id: string,
  input: { name?: string; email?: string; password?: string },
): Promise<{
  owner: { id: string; userId: string; name: string; email: string };
  passwordSet: boolean;
}> {
  return platformFetch(`/platform/tenants/${id}/credentials`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function deletePlatformTenant(id: string): Promise<{ ok: true; id: string; slug: string }> {
  return platformFetch(`/platform/tenants/${id}`, { method: "DELETE" });
}

export type PlatformOperator = {
  id: string;
  name: string;
  email: string;
  role: PlatformRole;
  createdAt: string;
};

export function listPlatformOperators(): Promise<PlatformOperator[]> {
  return platformFetch("/platform/operators");
}

export function createPlatformOperator(input: {
  email: string;
  password: string;
  role: PlatformRole;
}): Promise<PlatformOperator> {
  return platformFetch("/platform/operators", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updatePlatformOperator(
  id: string,
  input: { role?: PlatformRole; password?: string },
): Promise<PlatformOperator> {
  return platformFetch(`/platform/operators/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function deletePlatformOperator(id: string): Promise<{ ok: true; id: string; email: string }> {
  return platformFetch(`/platform/operators/${id}`, { method: "DELETE" });
}

export type PlatformRoleGrants = {
  privileges: PlatformPrivilege[];
  roles: {
    role: PlatformRole;
    locked: boolean;
    privileges: PlatformPrivilege[];
  }[];
};

export function listPlatformRoleGrants(): Promise<PlatformRoleGrants> {
  return platformFetch("/platform/roles");
}

export function updatePlatformRoleGrants(
  role: PlatformRole,
  privileges: PlatformPrivilege[],
): Promise<{ role: PlatformRole; locked: boolean; privileges: PlatformPrivilege[] }> {
  return platformFetch(`/platform/roles/${role}`, {
    method: "PUT",
    body: JSON.stringify({ privileges }),
  });
}

/** Same rule as the API / @docket/db slug helper. */
export const TENANT_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function slugFromName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}
