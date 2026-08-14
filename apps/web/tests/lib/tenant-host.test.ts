import { matchTenantHost, originForSlug, tenantSlugFromLocation } from "@/lib/tenant-host";
import { describe, expect, it } from "vitest";

describe("matchTenantHost", () => {
  it("parses UAT hosts", () => {
    expect(matchTenantHost("acme-uat.finlot.ai")).toEqual({
      slug: "acme",
      origin: "https://acme-uat.finlot.ai",
      kind: "uat",
    });
    expect(matchTenantHost("https://Harbor-UAT.finlot.ai/login")?.slug).toBe("harbor");
  });

  it("parses prod and docket.in hosts", () => {
    expect(matchTenantHost("acme.finlot.ai")?.kind).toBe("prod");
    expect(matchTenantHost("acme.docket.in")?.kind).toBe("docket-in");
  });

  it("rejects reserved and legacy hosts", () => {
    expect(matchTenantHost("docket.finlot.ai")).toBeNull();
    expect(matchTenantHost("www.finlot.ai")).toBeNull();
    expect(matchTenantHost("api.finlot.ai")).toBeNull();
    expect(matchTenantHost("docket-uat.vercel.app")).toBeNull();
    expect(matchTenantHost("localhost")).toBeNull();
  });

  it("builds origins", () => {
    expect(originForSlug("acme", undefined, "uat")).toBe("https://acme-uat.finlot.ai");
    expect(originForSlug("acme")).toBe("https://acme.finlot.ai");
  });

  it("reads location helper", () => {
    expect(tenantSlugFromLocation("summit-uat.finlot.ai")).toBe("summit");
  });
});
