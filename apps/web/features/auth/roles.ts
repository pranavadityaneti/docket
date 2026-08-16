/** Mirrors `@docket/db` workspace roles/privileges so the web app does not depend on the db package. */
export const ROLES = ["owner", "admin", "agent", "reviewer"] as const;
export type Role = (typeof ROLES)[number];

export const CONFIGURABLE_WORKSPACE_ROLES = ["admin", "agent", "reviewer"] as const;
export type ConfigurableWorkspaceRole = (typeof CONFIGURABLE_WORKSPACE_ROLES)[number];

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

export const WORKSPACE_PRIVILEGE_META: Record<
  WorkspacePrivilege,
  { group: string; label: string; summary: string }
> = {
  "cases.create": {
    group: "Cases",
    label: "Create",
    summary: "Open a new case in any workflow.",
  },
  "cases.delete": {
    group: "Cases",
    label: "Delete",
    summary: "Remove cases from this workspace.",
  },
  "team.manage": {
    group: "Team",
    label: "Manage people",
    summary: "Add teammates, change roles, and reset passwords.",
  },
  "roles.manage": {
    group: "Team",
    label: "Role permissions",
    summary: "Change what each role is allowed to do.",
  },
  "workflows.edit": {
    group: "Setup",
    label: "Workflows",
    summary: "Change stages, fields, and document checklists.",
  },
  "workspace.edit": {
    group: "Setup",
    label: "Workspace",
    summary: "Rename the workspace and change branding.",
  },
  "channels.manage": {
    group: "Setup",
    label: "Channels",
    summary: "Connect email and WhatsApp inboxes.",
  },
};

export const WORKSPACE_ROLE_META: Record<
  Role,
  { label: string; summary: string; privileges: WorkspacePrivilege[] }
> = {
  owner: {
    label: "Owner",
    summary: "Full control: branding, workflows, and everyone on the team.",
    privileges: [...WORKSPACE_PRIVILEGES],
  },
  admin: {
    label: "Admin",
    summary: "Permissions are set by an owner or admin.",
    privileges: [...WORKSPACE_PRIVILEGES],
  },
  agent: {
    label: "Agent",
    summary: "Create and work cases, conversations, and follow-ups.",
    privileges: ["cases.create"],
  },
  reviewer: {
    label: "Reviewer",
    summary: "Review documents and work cases.",
    privileges: ["cases.create"],
  },
};

export function isWorkspaceRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export function isConfigurableWorkspaceRole(value: string): value is ConfigurableWorkspaceRole {
  return (CONFIGURABLE_WORKSPACE_ROLES as readonly string[]).includes(value);
}

export function hasWorkspacePrivilege(
  role: string | null | undefined,
  privileges: readonly string[] | undefined,
  privilege: WorkspacePrivilege,
): boolean {
  if (role === "owner") return true;
  if (privileges) return privileges.includes(privilege);
  return isWorkspaceRole(role) ? WORKSPACE_ROLE_META[role].privileges.includes(privilege) : false;
}

export function canManageTeam(
  role: string | null | undefined,
  privileges?: readonly string[] | undefined,
): boolean {
  return hasWorkspacePrivilege(role, privileges, "team.manage");
}

export function canManageRoleGrants(
  role: string | null | undefined,
  privileges?: readonly string[] | undefined,
): boolean {
  return hasWorkspacePrivilege(role, privileges, "roles.manage");
}

export function canCreateCases(
  role: string | null | undefined,
  privileges?: readonly string[] | undefined,
): boolean {
  return hasWorkspacePrivilege(role, privileges, "cases.create");
}

export function canDeleteCases(
  role: string | null | undefined,
  privileges?: readonly string[] | undefined,
): boolean {
  return hasWorkspacePrivilege(role, privileges, "cases.delete");
}

export function assignableRoles(actorRole: string | null | undefined): Role[] {
  if (actorRole === "owner") return [...ROLES];
  if (actorRole === "admin") return ["admin", "agent", "reviewer"];
  return ["agent", "reviewer"];
}

export function configurableRolesFor(actorRole: string | null | undefined): ConfigurableWorkspaceRole[] {
  if (actorRole === "owner") return [...CONFIGURABLE_WORKSPACE_ROLES];
  if (actorRole === "admin") return ["agent", "reviewer"];
  return [];
}

export function workspaceRoleLabel(role: string): string {
  return isWorkspaceRole(role) ? WORKSPACE_ROLE_META[role].label : role;
}
