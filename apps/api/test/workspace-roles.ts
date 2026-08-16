import {
  rolesAdminMayConfigure,
  sanitizeWorkspacePrivileges,
  workspacePrivilegesFor,
} from "../../../packages/db/src/workspace-roles.ts";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

assert(
  JSON.stringify(sanitizeWorkspacePrivileges(["cases.delete", "nope"])) ===
    JSON.stringify(["cases.create", "cases.delete"]),
  "delete implies create",
);
assert(
  JSON.stringify(sanitizeWorkspacePrivileges(["roles.manage"])) ===
    JSON.stringify(["team.manage", "roles.manage"]),
  "roles.manage implies team.manage",
);
assert(workspacePrivilegesFor("owner").includes("roles.manage"), "owner has every privilege");
assert(workspacePrivilegesFor("owner", []).includes("cases.delete"), "owner ignores stored grants");
assert(workspacePrivilegesFor("agent").includes("cases.create"), "default agent can create");
assert(!workspacePrivilegesFor("agent").includes("cases.delete"), "default agent cannot delete");
assert(
  JSON.stringify(workspacePrivilegesFor("admin", ["cases.create"])) ===
    JSON.stringify(["cases.create"]),
  "stored grants replace defaults",
);
assert(
  JSON.stringify(rolesAdminMayConfigure("owner")) ===
    JSON.stringify(["admin", "agent", "reviewer"]),
  "owner can configure admin/agent/reviewer",
);
assert(
  JSON.stringify(rolesAdminMayConfigure("admin")) === JSON.stringify(["agent", "reviewer"]),
  "admin cannot change the admin template",
);
assert(rolesAdminMayConfigure("agent").length === 0, "agent cannot edit grants");

console.log("workspace-roles ok");
