export const WORKSPACE_ROLES = ["owner", "admin", "agent", "reviewer"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const MEMBER_TITLE_MAX = 40;

/** Trim a teammate tag. Empty / missing becomes null. */
export function normalizeMemberTitle(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string") return null;
  const title = value.trim().replace(/\s+/g, " ");
  if (!title) return null;
  if (title.length > MEMBER_TITLE_MAX) {
    return title.slice(0, MEMBER_TITLE_MAX);
  }
  return title;
}

export function isWorkspaceRole(value: string): value is WorkspaceRole {
  return (WORKSPACE_ROLES as readonly string[]).includes(value);
}

export function canManageWorkspaceMembers(role: string): boolean {
  return role === "owner" || role === "admin";
}

/** Roles this actor may assign when adding or changing a member. */
export function assignableRoles(actorRole: string): WorkspaceRole[] {
  if (actorRole === "owner") return [...WORKSPACE_ROLES];
  if (actorRole === "admin") return ["admin", "agent", "reviewer"];
  return ["agent", "reviewer"];
}

export type MemberMutationKind = "add" | "role" | "password" | "remove";

/**
 * Tenant-side team rules. Owners manage everyone; admins cannot touch owners
 * or mint a new owner. The last owner cannot be demoted or removed.
 */
export function memberMutationError(opts: {
  actorRole: string;
  actorUserId: string;
  targetUserId?: string;
  targetRole?: string;
  nextRole?: string;
  kind: MemberMutationKind;
  ownerCount: number;
  canManageTeam?: boolean;
}): string | null {
  const allowed = opts.canManageTeam ?? canManageWorkspaceMembers(opts.actorRole);
  if (!allowed) {
    return "Only workspace owners and admins can change this.";
  }

  if (opts.nextRole) {
    if (!isWorkspaceRole(opts.nextRole)) return "Invalid role";
    if (!assignableRoles(opts.actorRole).includes(opts.nextRole)) {
      return "You cannot assign that role";
    }
  }

  if (opts.kind === "add") return null;

  if (!opts.targetUserId || !opts.targetRole) {
    return "Member not found";
  }

  const self = opts.actorUserId === opts.targetUserId;
  if (self && (opts.kind === "remove" || opts.kind === "role")) {
    return opts.kind === "remove"
      ? "You cannot remove yourself"
      : "You cannot change your own role";
  }

  if (opts.actorRole === "admin" && opts.targetRole === "owner") {
    return "Only a workspace owner can change another owner";
  }

  if (opts.targetRole === "owner" && opts.ownerCount <= 1) {
    if (opts.kind === "remove") return "Cannot remove the last owner";
    if (opts.kind === "role" && opts.nextRole && opts.nextRole !== "owner") {
      return "Cannot demote the last owner";
    }
  }

  return null;
}
