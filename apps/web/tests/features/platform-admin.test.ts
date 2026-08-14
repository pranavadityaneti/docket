import { describe, expect, it } from "vitest";
import { DEFAULT_POST_ADMIN_LOGIN, safeAdminNext, safeNext } from "@/features/auth/safe-next";
import { platformTenantLogoUrl, slugFromName, TENANT_SLUG_RE } from "@/features/platform/api";
import { hasPrivilege, PLATFORM_PRIVILEGE_META, PLATFORM_PRIVILEGES, PLATFORM_ROLE_META } from "@/features/platform/roles";

describe("safeAdminNext", () => {
  it("allows admin paths only", () => {
    expect(safeAdminNext("/admin")).toBe("/admin");
    expect(safeAdminNext("/admin/tenants")).toBe("/admin/tenants");
    expect(safeAdminNext("/cases")).toBe(DEFAULT_POST_ADMIN_LOGIN);
    expect(safeAdminNext("//evil.com")).toBe(DEFAULT_POST_ADMIN_LOGIN);
    expect(safeAdminNext("https://evil.com")).toBe(DEFAULT_POST_ADMIN_LOGIN);
  });
});

describe("safeNext still rejects protocol-relative", () => {
  it("drops //", () => {
    expect(safeNext("//evil.com")).toBe("/cases");
  });
});

describe("slugFromName", () => {
  it("normalises a workspace name", () => {
    expect(slugFromName("Harbor Lending")).toBe("harbor-lending");
    expect(TENANT_SLUG_RE.test("harbor")).toBe(true);
    expect(TENANT_SLUG_RE.test("Harbor")).toBe(false);
    expect(TENANT_SLUG_RE.test("-bad")).toBe(false);
  });
});

describe("platformTenantLogoUrl", () => {
  it("is null until a logo has been uploaded", () => {
    expect(platformTenantLogoUrl(null)).toBeNull();
    expect(platformTenantLogoUrl({ id: "t1", logoUpdatedAt: null })).toBeNull();
  });

  it("cache-busts with the updated timestamp", () => {
    const url = platformTenantLogoUrl({ id: "t1", logoUpdatedAt: "2026-08-14T10:00:00.000Z" });
    expect(url).toContain("/platform/tenants/t1/logo?v=");
    expect(url).toContain(encodeURIComponent("2026-08-14T10:00:00.000Z"));
  });
});

describe("platform privileges", () => {
  it("gives super admin every privilege", () => {
    expect(hasPrivilege(PLATFORM_ROLE_META.super_admin.privileges, "operators.write")).toBe(true);
    expect(hasPrivilege(PLATFORM_ROLE_META.super_admin.privileges, "tenants.delete")).toBe(true);
  });

  it("lets admin manage tenants but not operators by default", () => {
    expect(hasPrivilege(PLATFORM_ROLE_META.admin.privileges, "tenants.write")).toBe(true);
    expect(hasPrivilege(PLATFORM_ROLE_META.admin.privileges, "operators.write")).toBe(false);
  });

  it("keeps sub-admin read-only on tenants by default", () => {
    expect(hasPrivilege(PLATFORM_ROLE_META.sub_admin.privileges, "tenants.read")).toBe(true);
    expect(hasPrivilege(PLATFORM_ROLE_META.sub_admin.privileges, "tenants.write")).toBe(false);
    expect(hasPrivilege(PLATFORM_ROLE_META.sub_admin.privileges, "operators.read")).toBe(false);
  });

  it("describes every privilege a super admin can grant", () => {
    for (const privilege of PLATFORM_PRIVILEGES) {
      expect(PLATFORM_PRIVILEGE_META[privilege].label.length).toBeGreaterThan(0);
      expect(PLATFORM_PRIVILEGE_META[privilege].group.length).toBeGreaterThan(0);
    }
  });
});
