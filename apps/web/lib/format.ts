/**
 * Shared display formatters. One implementation so "2h ago" and initials
 * never drift between Overview, Cases, Contacts, and the header.
 */

/** Relative age from an ISO timestamp. Empty string if unparseable. */
export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/**
 * Relative age that tolerates null ("never") - for channel last-polled and
 * follow-up last-request rows.
 */
export function relativeTimeOrNever(iso: string | null): string {
  if (!iso) return "never";
  const label = relativeTime(iso);
  return label || "never";
}

/** English plural for workflow vocabulary ("Case" → "Cases", "Admission" → "Admissions"). */
export function plural(label: string): string {
  if (/[^aeiou]y$/i.test(label)) return label.slice(0, -1) + "ies";
  if (/(s|x|z|ch|sh)$/i.test(label)) return label + "es";
  return label + "s";
}

/** Up to two initials from a display name. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}`.toUpperCase();
}

/** Compact en-IN calendar date, or fallback when missing/invalid. */
export function formatDate(iso: string | null, empty = "-"): string {
  if (!iso) return empty;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? empty
    : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

/** Human file size for document rows. */
export function formatFileSize(bytes: number | null): string | null {
  if (bytes === null) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Compact en-IN date and time, or empty string if invalid. */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d
    .toLocaleString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
    .replace(/\b(am|pm)\b/gi, (match) => match.toUpperCase());
}

/**
 * Age of an in-memory timestamp (ms since epoch), for "updated Ns ago" labels
 * while a case is open. Null → "just now".
 */
export function agoFromMs(loadedAt: number | null): string {
  if (loadedAt === null) return "just now";
  const s = Math.max(0, Math.round((Date.now() - loadedAt) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  return `${Math.round(s / 60)}m ago`;
}
