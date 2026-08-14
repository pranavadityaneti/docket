/** Mirrors `@docket/db` `ROLES` so the web app does not depend on the db package. */
export const ROLES = ["owner", "admin", "agent", "reviewer"] as const;
export type Role = (typeof ROLES)[number];

export const WORKSPACE_ROLE_META: Record<
  Role,
  { label: string; summary: string }
> = {
  owner: {
    label: "Owner",
    summary: "Full control: branding, workflows, and everyone on the team.",
  },
  admin: {
    label: "Admin",
    summary: "Manage setup and teammates, except owners.",
  },
  agent: {
    label: "Agent",
    summary: "Work cases, conversations, and follow-ups.",
  },
  reviewer: {
    label: "Reviewer",
    summary: "Review documents and work cases.",
  },
};

export function isWorkspaceRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export function canManageTeam(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

export function assignableRoles(actorRole: string | null | undefined): Role[] {
  if (actorRole === "owner") return [...ROLES];
  if (actorRole === "admin") return ["admin", "agent", "reviewer"];
  return [];
}

export function workspaceRoleLabel(role: string): string {
  return isWorkspaceRole(role) ? WORKSPACE_ROLE_META[role].label : role;
}
