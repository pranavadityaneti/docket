import {
  isConfigurableWorkspaceRole,
  workspacePrivilegesFor,
  workspaceRolePrivileges,
  type WorkspacePrivilege,
} from "@docket/db";
import { and, eq } from "drizzle-orm";
import { DbService } from "../db/db";

export async function loadWorkspacePrivileges(
  db: DbService,
  tenantId: string,
  role: string,
): Promise<WorkspacePrivilege[]> {
  if (role === "owner") return workspacePrivilegesFor("owner");
  if (!isConfigurableWorkspaceRole(role)) return [];
  const [row] = await db.admin
    .select({ privileges: workspaceRolePrivileges.privileges })
    .from(workspaceRolePrivileges)
    .where(
      and(eq(workspaceRolePrivileges.tenantId, tenantId), eq(workspaceRolePrivileges.role, role)),
    )
    .limit(1);
  return workspacePrivilegesFor(role, row?.privileges);
}
