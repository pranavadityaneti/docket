import type { PlatformTenantDetail } from "./api";

export function tenantEditorSeed(data: PlatformTenantDetail) {
  return {
    name: data.name,
    plan: data.plan,
    ownerName: data.owner?.name ?? "",
    ownerUserId: data.owner?.userId ?? "",
    ownerEmail: data.owner?.email ?? "",
  };
}
