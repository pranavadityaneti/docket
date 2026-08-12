/**
 * Resolve a workspace slug from a browser host / origin.
 *
 * Host shapes (priority order):
 *   1. https://<slug>-uat.finlot.ai     → UAT
 *   2. https://<slug>.docket.in         → future prod apex
 *   3. https://<slug>.finlot.ai         → current prod
 *   4. Legacy aliases (docket.finlot.ai, docket-uat.vercel.app, localhost)
 *      → null (caller may fall back to an explicit tenantSlug body field)
 *
 * Reserved labels (www, api, docket, app, …) never count as a slug.
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
  /** Canonical origin for this host (no trailing slash). */
  origin: string;
  /** Which pattern matched. */
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

/**
 * Parse a Host header or Origin URL into a tenant slug + canonical origin.
 * Returns null when the host is not a tenant subdomain (legacy apex, localhost).
 */
export function matchTenantHost(hostOrOrigin: string): TenantHostMatch | null {
  const host = hostnameOf(hostOrOrigin);
  if (!host) return null;

  // <slug>-uat.finlot.ai
  const uat = /^([a-z0-9-]+)-uat\.finlot\.ai$/.exec(host);
  if (uat && isSlug(uat[1])) {
    return { slug: uat[1], origin: `https://${uat[1]}-uat.finlot.ai`, kind: "uat" };
  }

  // <slug>.docket.in
  const docketIn = /^([a-z0-9-]+)\.docket\.in$/.exec(host);
  if (docketIn && isSlug(docketIn[1])) {
    return {
      slug: docketIn[1],
      origin: `https://${docketIn[1]}.docket.in`,
      kind: "docket-in",
    };
  }

  // <slug>.finlot.ai
  const prod = /^([a-z0-9-]+)\.finlot\.ai$/.exec(host);
  if (prod && isSlug(prod[1])) {
    return { slug: prod[1], origin: `https://${prod[1]}.finlot.ai`, kind: "prod" };
  }

  return null;
}

/** Build the public origin for a slug given an explicit template, else infer. */
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

/**
 * CORS / email allow-list: explicit WEB_ORIGIN entries plus the three host
 * patterns above. Credentials mode forbids `*`, so this is a callback predicate.
 */
export function isAllowedWebOrigin(origin: string, explicit: readonly string[]): boolean {
  const clean = origin.trim().replace(/\/+$/, "");
  if (!clean) return false;
  if (explicit.some((o) => o.replace(/\/+$/, "") === clean)) return true;
  return matchTenantHost(clean) !== null;
}
