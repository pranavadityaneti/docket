import {
  generatePublicId,
  isPublicId,
  normalizePublicId,
  PUBLIC_ID_LENGTH,
  PUBLIC_ID_PREFIXES,
} from "./public-id";

/**
 * Human-readable case references — `DPC-A12B3C4`.
 *
 * These are not internal ids; they are read over WhatsApp, typed into an email
 * subject, and spoken aloud to the voice bot. New cases always get a server
 * issued DPC-XXXXXXX (7 alphanumeric). Lookup still accepts the older
 * DKT-XXXXXX Crockford form so in-flight messages keep matching until those
 * rows are migrated.
 */
const LEGACY_PREFIX = "DKT";
const LEGACY_LENGTH = 6;
const LEGACY_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function generateCaseReference(): string {
  return generatePublicId("case");
}

/**
 * Normalise a reference a human typed or spoke back, before looking it up.
 * Accepts lowercase, missing prefix, spaces, and (for legacy DKT codes) the
 * confusable characters the old alphabet excluded.
 * Returns null if it can't be read as a reference at all.
 */
export function normaliseCaseReference(raw: string): string | null {
  if (!raw) return null;
  const compact = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const currentPrefix = PUBLIC_ID_PREFIXES.case;

  if (compact.length === currentPrefix.length + PUBLIC_ID_LENGTH && compact.startsWith(currentPrefix)) {
    const body = compact.slice(currentPrefix.length);
    return isPublicId("case", `${currentPrefix}-${body}`) ? `${currentPrefix}-${body}` : null;
  }

  if (compact.length === PUBLIC_ID_LENGTH && isPublicId("case", `${currentPrefix}-${compact}`)) {
    return `${currentPrefix}-${compact}`;
  }

  const legacyBody =
    compact.length === LEGACY_PREFIX.length + LEGACY_LENGTH && compact.startsWith(LEGACY_PREFIX)
      ? compact.slice(LEGACY_PREFIX.length)
      : compact;

  const folded = legacyBody
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0")
    .replace(/U/g, "V");

  if (folded.length === LEGACY_LENGTH && [...folded].every((c) => LEGACY_ALPHABET.includes(c))) {
    return `${LEGACY_PREFIX}-${folded}`;
  }

  return null;
}

export function normalizeCaseReference(raw: string): string {
  return normalizePublicId(raw);
}
