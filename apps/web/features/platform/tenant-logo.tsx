"use client";

import { platformTenantLogoUrl } from "@/features/platform/api";
import { cn } from "@/lib/utils";
import * as React from "react";

export function TenantLogoMark({
  tenant,
  className,
}: {
  tenant: { id: string; name: string; logoUpdatedAt?: string | null };
  className?: string;
}) {
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => {
    setFailed(false);
  }, [tenant.id, tenant.logoUpdatedAt]);

  const url = failed ? null : platformTenantLogoUrl(tenant);
  const mark = tenant.name.trim().charAt(0).toUpperCase() || "T";

  if (url) {
  return (
    // Same-origin cookie auth; Next Image is the wrong tool for a private stream.
    <img
      src={url}
      alt=""
      onError={() => setFailed(true)}
      className={cn("size-8 shrink-0 rounded-lg bg-muted object-contain", className)}
    />
  );
  }

  return (
    <div
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-semibold text-muted-foreground",
        className,
      )}
    >
      {mark}
    </div>
  );
}
