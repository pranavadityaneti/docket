import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_POST_LOGIN, safeNext } from "@/features/auth/safe-next";
import {
  getWorkspacePrefs,
  publicWorkspaceLogoUrl,
  setWorkspacePrefs,
  workspaceLogoUrl,
  type WorkspacePrefs,
} from "@/features/auth/api";
import {
  assignableRoles,
  canCreateCases,
  canDeleteCases,
  canManageRoleGrants,
  canManageTeam,
  configurableRolesFor,
  hasWorkspacePrivilege,
  isWorkspaceRole,
} from "@/features/auth/roles";

describe("safeNext", () => {
  it("allows same-origin absolute paths", () => {
    expect(safeNext("/cases")).toBe("/cases");
    expect(safeNext("/cases?q=1")).toBe("/cases?q=1");
    expect(safeNext("/cases/abc#x")).toBe("/cases/abc#x");
  });

  it("rejects open redirects and non-paths", () => {
    expect(safeNext("https://evil.example")).toBe(DEFAULT_POST_LOGIN);
    expect(safeNext("//evil.example")).toBe(DEFAULT_POST_LOGIN);
    expect(safeNext("javascript:alert(1)")).toBe(DEFAULT_POST_LOGIN);
    expect(safeNext(null)).toBe(DEFAULT_POST_LOGIN);
    expect(safeNext("")).toBe(DEFAULT_POST_LOGIN);
  });

  it("accepts a custom fallback", () => {
    expect(safeNext(null, "/")).toBe("/");
  });
});

describe("workspace prefs", () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => {
          store.set(k, v);
        },
        removeItem: (k: string) => {
          store.delete(k);
        },
        clear: () => store.clear(),
      },
    });
  });

  it("returns defaults when storage empty", () => {
    const prefs = getWorkspacePrefs();
    expect(prefs.notifyNeedsReview).toBe(true);
    expect(prefs.notifyUnmatched).toBe(true);
    expect(prefs.notifyFollowUps).toBe(true);
  });

  it("round-trips prefs", () => {
    const next: WorkspacePrefs = {
      notifyNeedsReview: false,
      notifyUnmatched: true,
      notifyFollowUps: false,
    };
    setWorkspacePrefs(next);
    expect(getWorkspacePrefs()).toEqual(next);
  });

  it("survives corrupt json", () => {
    store.set("docket_prefs", "{not-json");
    expect(getWorkspacePrefs().notifyNeedsReview).toBe(true);
  });
});

describe("workspaceLogoUrl", () => {
  it("is null until a logo has been uploaded", () => {
    expect(workspaceLogoUrl(null)).toBeNull();
    expect(workspaceLogoUrl({ logoUpdatedAt: null })).toBeNull();
  });

  it("cache-busts with the updated timestamp", () => {
    const url = workspaceLogoUrl({ logoUpdatedAt: "2026-08-14T10:00:00.000Z" });
    expect(url).toContain("/auth/workspace/logo?v=");
    expect(url).toContain(encodeURIComponent("2026-08-14T10:00:00.000Z"));
  });

  it("builds a public logo url from slug", () => {
    expect(
      publicWorkspaceLogoUrl({
        name: "Test Tenant",
        slug: "test-tenant",
        logoUpdatedAt: null,
      }),
    ).toBeNull();
    const url = publicWorkspaceLogoUrl({
      name: "Test Tenant",
      slug: "test-tenant",
      logoUpdatedAt: "2026-08-14T10:00:00.000Z",
    });
    expect(url).toContain("/auth/public/workspace/logo?slug=test-tenant");
    expect(url).toContain(encodeURIComponent("2026-08-14T10:00:00.000Z"));
  });
});

describe("workspace team roles", () => {
  it("lets owners and admins manage the team", () => {
    expect(canManageTeam("owner")).toBe(true);
    expect(canManageTeam("admin")).toBe(true);
    expect(canManageTeam("agent")).toBe(false);
    expect(canManageTeam("reviewer")).toBe(false);
  });

  it("stops admins from minting owners", () => {
    expect(assignableRoles("owner")).toEqual(["owner", "admin", "agent", "reviewer"]);
    expect(assignableRoles("admin")).toEqual(["admin", "agent", "reviewer"]);
    expect(assignableRoles("agent")).toEqual(["agent", "reviewer"]);
  });

  it("recognises workspace roles", () => {
    expect(isWorkspaceRole("owner")).toBe(true);
    expect(isWorkspaceRole("super_admin")).toBe(false);
    expect(isWorkspaceRole("Loan officer")).toBe(false);
  });

  it("lets owners always pass privilege checks", () => {
    expect(hasWorkspacePrivilege("owner", [], "roles.manage")).toBe(true);
    expect(canCreateCases("owner", [])).toBe(true);
    expect(canDeleteCases("owner")).toBe(true);
    expect(canManageRoleGrants("owner")).toBe(true);
  });

  it("uses stored grants when present, otherwise role defaults", () => {
    expect(canCreateCases("agent")).toBe(true);
    expect(canDeleteCases("agent")).toBe(false);
    expect(canDeleteCases("agent", ["cases.create", "cases.delete"])).toBe(true);
    expect(canCreateCases("agent", [])).toBe(false);
    expect(canManageTeam("admin")).toBe(true);
    expect(canManageTeam("admin", ["cases.create"])).toBe(false);
  });

  it("limits which role templates an actor can edit", () => {
    expect(configurableRolesFor("owner")).toEqual(["admin", "agent", "reviewer"]);
    expect(configurableRolesFor("admin")).toEqual(["agent", "reviewer"]);
    expect(configurableRolesFor("agent")).toEqual([]);
  });
});
