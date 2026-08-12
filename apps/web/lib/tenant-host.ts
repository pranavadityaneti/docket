/**
 * Resolve a workspace slug from a browser host / origin.
 * Keep in sync with apps/api/src/config/tenant-host.ts.
 */

const RESERVED = new Set([
  "www",
  "api",
  "app",
  "mail",
  "smtp",
  "ftp",
  "docket",
  "admin",
  "static",
  "assets",
  "cdn",
]);

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export type TenantHostMatch = {
  slug: string;
  origin: string;
  kind: "uat" | "prod" | "docket-in";
};

function hostnameOf(hostOrOrigin: string): string | null {
  const raw = hostOrOrigin.trim().toLowerCase();
  if (!raw) return null;
  try {
    if (raw.includes("://")) return new URL(raw).hostname;
  } catch {
    return null;
  }
  return raw.split("/")[0]?.split(":")[0] || null;
}

function isSlug(label: string): boolean {
  return SLUG_RE.test(label) && !RESERVED.has(label);
}

export function matchTenantHost(hostOrOrigin: string): TenantHostMatch | null {
  const host = hostnameOf(hostOrOrigin);
  if (!host) return null;

  const uat = /^([a-z0-9-]+)-uat\.finlot\.ai$/.exec(host);
  if (uat && isSlug(uat[1])) {
    return { slug: uat[1], origin: `https://${uat[1]}-uat.finlot.ai`, kind: "uat" };
  }

  const docketIn = /^([a-z0-9-]+)\.docket\.in$/.exec(host);
  if (docketIn && isSlug(docketIn[1])) {
    return {
      slug: docketIn[1],
      origin: `https://${docketIn[1]}.docket.in`,
      kind: "docket-in",
    };
  }

  const prod = /^([a-z0-9-]+)\.finlot\.ai$/.exec(host);
  if (prod && isSlug(prod[1])) {
    return { slug: prod[1], origin: `https://${prod[1]}.finlot.ai`, kind: "prod" };
  }

  return null;
}

/** Browser helper: slug for the current page host, if any. */
export function tenantSlugFromLocation(
  hostname = typeof window !== "undefined" ? window.location.hostname : "",
): string | null {
  return matchTenantHost(hostname)?.slug ?? null;
}

/** Build the public origin for a slug. */
export function originForSlug(
  slug: string,
  template?: string,
  kind: TenantHostMatch["kind"] = "prod",
): string {
  const clean = slug.trim().toLowerCase();
  if (template?.includes("{slug}")) {
    return template.replaceAll("{slug}", clean).replace(/\/+$/, "");
  }
  if (kind === "uat") return `https://${clean}-uat.finlot.ai`;
  if (kind === "docket-in") return `https://${clean}.docket.in`;
  return `https://${clean}.finlot.ai`;
}
