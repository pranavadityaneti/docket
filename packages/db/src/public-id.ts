import { randomInt } from "node:crypto";

/**
 * Server-issued public IDs. Admins never choose these.
 *
 *   DPC-XXXXXXX  cases
 *   DPT-XXXXXXX  tenants
 *   DPU-XXXXXXX  users (the login User ID)
 *
 * XXXXXXX is 7 alphanumeric characters (0-9, A-Z). Random, not sequential:
 * a counter would leak volume and need locking. Uniqueness is enforced by
 * the database; callers retry on conflict.
 */
export const PUBLIC_ID_LENGTH = 7;
export const PUBLIC_ID_ALLOCATE_ATTEMPTS = 8;

export const PUBLIC_ID_PREFIXES = {
  case: "DPC",
  tenant: "DPT",
  user: "DPU",
} as const;

export type PublicIdKind = keyof typeof PUBLIC_ID_PREFIXES;

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function generatePublicId(kind: PublicIdKind): string {
  const prefix = PUBLIC_ID_PREFIXES[kind];
  let body = "";
  for (let i = 0; i < PUBLIC_ID_LENGTH; i++) body += ALPHABET[randomInt(ALPHABET.length)];
  return `${prefix}-${body}`;
}

export function normalizePublicId(raw: string): string {
  return raw.trim().toUpperCase();
}

export function isPublicId(kind: PublicIdKind, value: string): boolean {
  const prefix = PUBLIC_ID_PREFIXES[kind];
  const normalized = normalizePublicId(value);
  if (normalized.length !== prefix.length + 1 + PUBLIC_ID_LENGTH) return false;
  if (!normalized.startsWith(`${prefix}-`)) return false;
  const body = normalized.slice(prefix.length + 1);
  return [...body].every((c) => ALPHABET.includes(c));
}

export function publicIdError(kind: PublicIdKind, raw: string): string | null {
  const labels = { case: "Case ID", tenant: "Tenant ID", user: "User ID" } as const;
  if (!raw.trim()) return `${labels[kind]} is required`;
  if (!isPublicId(kind, raw)) {
    return `${labels[kind]} must look like ${PUBLIC_ID_PREFIXES[kind]}-XXXXXXX`;
  }
  return null;
}

export async function withUniquePublicId<T>(
  kind: PublicIdKind,
  run: (id: string) => Promise<T>,
  isIdTaken: (error: unknown) => boolean,
): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < PUBLIC_ID_ALLOCATE_ATTEMPTS; attempt++) {
    try {
      return await run(generatePublicId(kind));
    } catch (error) {
      last = error;
      if (!isIdTaken(error)) throw error;
    }
  }
  throw last instanceof Error ? last : new Error(`Could not allocate a ${kind} ID`);
}
