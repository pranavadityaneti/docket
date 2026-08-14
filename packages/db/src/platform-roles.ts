import { PLATFORM_ROLES, type PlatformRole } from "./schema";

export const PLATFORM_PRIVILEGES = [
  "tenants.read",
  "tenants.write",
  "tenants.credentials",
  "tenants.delete",
  "operators.read",
  "operators.write",
] as const;

export type PlatformPrivilege = (typeof PLATFORM_PRIVILEGES)[number];

export const CONFIGURABLE_PLATFORM_ROLES = ["admin", "sub_admin"] as const;
export type ConfigurablePlatformRole = (typeof CONFIGURABLE_PLATFORM_ROLES)[number];

export const DEFAULT_ROLE_PRIVILEGES: Record<PlatformRole, readonly PlatformPrivilege[]> = {
  super_admin: PLATFORM_PRIVILEGES,
  admin: ["tenants.read", "tenants.write", "tenants.credentials", "tenants.delete"],
  sub_admin: ["tenants.read"],
};

export function isPlatformRole(value: string): value is PlatformRole {
  return (PLATFORM_ROLES as readonly string[]).includes(value);
}

export function isConfigurablePlatformRole(value: string): value is ConfigurablePlatformRole {
  return (CONFIGURABLE_PLATFORM_ROLES as readonly string[]).includes(value);
}

export function isPlatformPrivilege(value: string): value is PlatformPrivilege {
  return (PLATFORM_PRIVILEGES as readonly string[]).includes(value);
}

/**
 * Drop unknown strings and add implied reads so write/delete never land
 * without the matching view permission.
 */
export function sanitizePlatformPrivileges(raw: unknown): PlatformPrivilege[] {
  const set = new Set<PlatformPrivilege>();
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === "string" && isPlatformPrivilege(item)) set.add(item);
    }
  }
  if (set.has("tenants.write") || set.has("tenants.credentials") || set.has("tenants.delete")) {
    set.add("tenants.read");
  }
  if (set.has("operators.write")) set.add("operators.read");
  return PLATFORM_PRIVILEGES.filter((p) => set.has(p));
}

export function privilegesFor(role: PlatformRole, stored?: unknown): PlatformPrivilege[] {
  if (role === "super_admin") return [...PLATFORM_PRIVILEGES];
  if (stored !== undefined) return sanitizePlatformPrivileges(stored);
  return [...DEFAULT_ROLE_PRIVILEGES[role]];
}

export function hasPlatformPrivilege(role: PlatformRole, privilege: PlatformPrivilege): boolean {
  return DEFAULT_ROLE_PRIVILEGES[role].includes(privilege);
}
