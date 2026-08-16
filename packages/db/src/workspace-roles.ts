import { ROLES, type Role } from "./schema";

export const WORKSPACE_PRIVILEGES = [
  "cases.create",
  "cases.delete",
  "team.manage",
  "roles.manage",
  "workflows.edit",
  "workspace.edit",
  "channels.manage",
] as const;

export type WorkspacePrivilege = (typeof WORKSPACE_PRIVILEGES)[number];

export const CONFIGURABLE_WORKSPACE_ROLES = ["admin", "agent", "reviewer"] as const;
export type ConfigurableWorkspaceRole = (typeof CONFIGURABLE_WORKSPACE_ROLES)[number];

export const DEFAULT_WORKSPACE_PRIVILEGES: Record<Role, readonly WorkspacePrivilege[]> = {
  owner: WORKSPACE_PRIVILEGES,
  admin: [
    "cases.create",
    "cases.delete",
    "team.manage",
    "roles.manage",
    "workflows.edit",
    "workspace.edit",
    "channels.manage",
  ],
  agent: ["cases.create"],
  reviewer: ["cases.create"],
};

export function isConfigurableWorkspaceRole(value: string): value is ConfigurableWorkspaceRole {
  return (CONFIGURABLE_WORKSPACE_ROLES as readonly string[]).includes(value);
}

export function isWorkspacePrivilege(value: string): value is WorkspacePrivilege {
  return (WORKSPACE_PRIVILEGES as readonly string[]).includes(value);
}

/**
 * Drop unknown strings and add implied grants so delete never lands
 * without create, and role edits never land without team.manage.
 */
export function sanitizeWorkspacePrivileges(raw: unknown): WorkspacePrivilege[] {
  const set = new Set<WorkspacePrivilege>();
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === "string" && isWorkspacePrivilege(item)) set.add(item);
    }
  }
  if (set.has("cases.delete")) set.add("cases.create");
  if (set.has("roles.manage")) set.add("team.manage");
  return WORKSPACE_PRIVILEGES.filter((p) => set.has(p));
}

export function workspacePrivilegesFor(role: string, stored?: unknown): WorkspacePrivilege[] {
  if (role === "owner") return [...WORKSPACE_PRIVILEGES];
  if (!isConfigurableWorkspaceRole(role)) return [];
  if (stored !== undefined) return sanitizeWorkspacePrivileges(stored);
  return [...DEFAULT_WORKSPACE_PRIVILEGES[role]];
}

export function rolesAdminMayConfigure(actorRole: string): ConfigurableWorkspaceRole[] {
  if (actorRole === "owner") return [...CONFIGURABLE_WORKSPACE_ROLES];
  if (actorRole === "admin") return ["agent", "reviewer"];
  return [];
}
