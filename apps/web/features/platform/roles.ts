export const PLATFORM_ROLES = ["super_admin", "admin", "sub_admin"] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const CONFIGURABLE_PLATFORM_ROLES = ["admin", "sub_admin"] as const;
export type ConfigurablePlatformRole = (typeof CONFIGURABLE_PLATFORM_ROLES)[number];

export const PLATFORM_PRIVILEGES = [
  "tenants.read",
  "tenants.write",
  "tenants.credentials",
  "tenants.delete",
  "operators.read",
  "operators.write",
] as const;
export type PlatformPrivilege = (typeof PLATFORM_PRIVILEGES)[number];

export const PLATFORM_PRIVILEGE_META: Record<
  PlatformPrivilege,
  { group: string; label: string; summary: string }
> = {
  "tenants.read": {
    group: "Workspaces",
    label: "View",
    summary: "See the tenant list and open a workspace.",
  },
  "tenants.write": {
    group: "Workspaces",
    label: "Create & edit",
    summary: "Create tenants and change name or plan.",
  },
  "tenants.credentials": {
    group: "Workspaces",
    label: "Owner login",
    summary: "Change the workspace owner email and password.",
  },
  "tenants.delete": {
    group: "Workspaces",
    label: "Delete",
    summary: "Permanently delete a workspace.",
  },
  "operators.read": {
    group: "Operators",
    label: "View",
    summary: "See who can sign into this console.",
  },
  "operators.write": {
    group: "Operators",
    label: "Add & edit",
    summary: "Add operators, change roles, and reset passwords.",
  },
};

export const PLATFORM_ROLE_META: Record<
  PlatformRole,
  { label: string; summary: string; privileges: PlatformPrivilege[] }
> = {
  super_admin: {
    label: "Super admin",
    summary: "Full console. Always has every permission.",
    privileges: [...PLATFORM_PRIVILEGES],
  },
  admin: {
    label: "Admin",
    summary: "Permissions are set by a super admin.",
    privileges: ["tenants.read", "tenants.write", "tenants.credentials", "tenants.delete"],
  },
  sub_admin: {
    label: "Sub-admin",
    summary: "Permissions are set by a super admin.",
    privileges: ["tenants.read"],
  },
};

export function isPlatformRole(value: string): value is PlatformRole {
  return (PLATFORM_ROLES as readonly string[]).includes(value);
}

export function isConfigurablePlatformRole(value: string): value is ConfigurablePlatformRole {
  return (CONFIGURABLE_PLATFORM_ROLES as readonly string[]).includes(value);
}

export function platformRoleLabel(role: string): string {
  return isPlatformRole(role) ? PLATFORM_ROLE_META[role].label : role;
}

export function hasPrivilege(
  privileges: readonly string[] | undefined,
  privilege: PlatformPrivilege,
): boolean {
  return Boolean(privileges?.includes(privilege));
}
