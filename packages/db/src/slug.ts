/** Same rule as the web `TENANT_SLUG_RE` and DNS label limits. */
export const TENANT_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function normalizeTenantSlug(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isTenantSlug(slug: string): boolean {
  return TENANT_SLUG_RE.test(slug);
}
