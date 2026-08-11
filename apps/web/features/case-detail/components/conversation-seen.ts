/** Per-case "I've seen the conversation up to this timestamp" cursor. */

const keyFor = (caseId: string) => `docket:case:${caseId}:conversations:seenAt`;

export function readConversationSeenAt(caseId: string): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.localStorage.getItem(keyFor(caseId));
    const n = raw ? Number(raw) : 0;
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

export function writeConversationSeenAt(caseId: string, atMs: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(keyFor(caseId), String(atMs));
  } catch {
    // Private mode / quota - badge simply won't persist.
  }
}

export function countUnseenInbound(
  caseId: string,
  entries: { direction: string; at: string }[],
): number {
  const seenAt = readConversationSeenAt(caseId);
  return entries.filter((entry) => {
    if (entry.direction !== "inbound") return false;
    const t = new Date(entry.at).getTime();
    return Number.isFinite(t) && t > seenAt;
  }).length;
}

export function markConversationSeen(
  caseId: string,
  entries: { direction: string; at: string }[],
): void {
  let latest = Date.now();
  for (const entry of entries) {
    const t = new Date(entry.at).getTime();
    if (Number.isFinite(t) && t > latest) latest = t;
  }
  writeConversationSeenAt(caseId, latest);
}
