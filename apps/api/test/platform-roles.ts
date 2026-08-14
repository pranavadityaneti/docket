import { privilegesFor, sanitizePlatformPrivileges } from "../../../packages/db/src/platform-roles.ts";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

assert(
  JSON.stringify(sanitizePlatformPrivileges(["tenants.write", "nope"])) ===
    JSON.stringify(["tenants.read", "tenants.write"]),
  "write implies read",
);
assert(
  JSON.stringify(sanitizePlatformPrivileges(["operators.write"])) ===
    JSON.stringify(["operators.read", "operators.write"]),
  "operators.write implies read",
);
assert(privilegesFor("super_admin").includes("operators.write"), "super admin has operators.write");
assert(!privilegesFor("sub_admin").includes("tenants.delete"), "default sub-admin cannot delete");
assert(
  JSON.stringify(privilegesFor("admin", ["operators.write"])) ===
    JSON.stringify(["operators.read", "operators.write"]),
  "stored grants replace defaults",
);

console.log("platform-roles ok");
