import { describe, expect, it } from "vitest";
import type { PlatformTenantDetail } from "@/features/platform/api";
import { tenantEditorSeed } from "@/features/platform/tenant-editor";

const base: PlatformTenantDetail = {
  id: "t1",
  publicId: "DPT-A12B3C4",
  name: "Harbor",
  slug: "harbor",
  plan: "trial",
  createdAt: "2026-08-16T00:00:00.000Z",
  owner: {
    id: "u1",
    userId: "DPU-A12B3C4",
    name: "Priya Shah",
    email: "priya@harbor.test",
    role: "owner",
  },
  members: [],
};

describe("tenantEditorSeed", () => {
  it("copies workspace and owner fields for first paint", () => {
    expect(tenantEditorSeed(base)).toEqual({
      name: "Harbor",
      plan: "trial",
      ownerName: "Priya Shah",
      ownerUserId: "DPU-A12B3C4",
      ownerEmail: "priya@harbor.test",
    });
  });

  it("uses empty owner fields when the workspace has no owner", () => {
    expect(tenantEditorSeed({ ...base, owner: null })).toEqual({
      name: "Harbor",
      plan: "trial",
      ownerName: "",
      ownerUserId: "",
      ownerEmail: "",
    });
  });
});
