import { randomInt } from "node:crypto";

/**
 * Human-readable case references — `DKT-7F3K2M`.
 *
 * These are not internal ids; they are read over WhatsApp, typed into an email
 * subject, and spoken aloud to the voice bot. That drives every choice here:
 *
 * - **Crockford base32 alphabet** — no `I`, `L`, `O` or `U`. `I/1`, `O/0` and
 *   `L/1` are the pairs people confuse when reading a code back, and `U` is
 *   excluded so a random string can't spell something unfortunate.
 * - **Random, not sequential.** A counter would tell any tenant's competitor
 *   how many cases they run, needs locking under concurrent inserts, and leaks
 *   ordering. 6 chars gives 32^6 ≈ 1.07 billion per tenant.
 * - **Uniqueness is enforced by the database** (cases_tenant_reference_uq), not
 *   by hoping; callers retry on conflict. At 1M cases in one tenant the
 *   birthday-collision chance per insert is still under 0.1%.
 *
 * `randomInt` (CSPRNG) rather than Math.random: references appear in URLs and
 * are quoted as a weak identifier, so they should not be predictable.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32: no I, L, O, U
const LENGTH = 6;
const PREFIX = "DKT";

export function generateCaseReference(): string {
  let out = "";
  for (let i = 0; i < LENGTH; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return `${PREFIX}-${out}`;
}

/**
 * Normalise a reference a human typed or spoke back, before looking it up.
 * Accepts lowercase, missing prefix, spaces, and the confusable characters the
 * alphabet deliberately excludes (someone reading `0` aloud may write `O`).
 * Returns null if it can't be read as a reference at all.
 */
export function normaliseCaseReference(raw: string): string | null {
  if (!raw) return null;
  const compact = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");

  // Strip the prefix ONLY when doing so leaves exactly a full code. D, K and T
  // are all in the alphabet, so a legitimate reference can itself begin "DKT"
  // (DKT-DKT123) — an unconditional strip would eat the first three characters
  // of a bare code and turn a valid reference into nonsense.
  const body =
    compact.length === PREFIX.length + LENGTH && compact.startsWith(PREFIX)
      ? compact.slice(PREFIX.length)
      : compact;

  // Fold the excluded characters onto what the speaker almost certainly meant.
  // This is safe in both directions: a real reference can never contain I, L,
  // O or U, so folding can only ever repair a mis-transcription — it can never
  // turn one valid reference into a different valid one.
  const folded = body
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0")
    .replace(/U/g, "V");

  if (folded.length !== LENGTH) return null;
  if (![...folded].every((c) => ALPHABET.includes(c))) return null;
  return `${PREFIX}-${folded}`;
}
