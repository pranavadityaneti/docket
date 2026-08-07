import type { NudgeSnapshotItem } from "@docket/db";

/**
 * Turning a checklist into the words a subject reads.
 *
 * Kept pure - no Nest, no DB, no network - so the one thing most worth getting
 * right (what we ask for, and how it reads) is trivially testable, and so the
 * email and WhatsApp bodies can never drift from the same source of truth: the
 * checklist the dashboard already shows.
 */

/**
 * The subset of DocumentsService.checklist()'s output that composing needs.
 * Declared structurally so this file depends on nothing but the item shape.
 */
export interface ChecklistItemLike {
  key: string;
  label: string;
  required: boolean;
  status: string; // "missing" | "rejected" | "received" | "accepted" | ...
  documents: Array<{ status: string; rejectionReason: string | null }>;
}
export interface ChecklistLike {
  items: ChecklistItemLike[];
}

export interface ComposeContext {
  contactName: string;
  tenantName: string;
  caseReference: string;
}

export interface ComposedEmail {
  subject: string;
  text: string;
}

/**
 * What is still being asked for. Three "we still need something" states:
 *   - rejected (any item) → re-send, with the reason so the ask is specific;
 *   - required + missing  → never supplied;
 *   - required + expired  → was supplied but its validity window lapsed, so the
 *     slot is empty again and a fresh copy is needed (occupiesSlot agrees).
 * Expired is phrased as a fresh ask (state "missing"), which is what it is from
 * the subject's side. Optional items simply never sent are omitted - we do not
 * nag for extras, only for what the workflow requires or refused.
 */
export function collectNudgeItems(checklist: ChecklistLike): NudgeSnapshotItem[] {
  const out: NudgeSnapshotItem[] = [];
  for (const item of checklist.items) {
    if (item.status === "rejected") {
      const reason = item.documents.find((d) => d.status === "rejected")?.rejectionReason;
      out.push({
        key: item.key,
        label: item.label,
        state: "rejected",
        reason: reason ?? undefined,
      });
    } else if (item.required && (item.status === "missing" || item.status === "expired")) {
      out.push({ key: item.key, label: item.label, state: "missing" });
    }
  }
  return out;
}

/** Email content. The caller only sends when items is non-empty. */
export function composeEmail(items: NudgeSnapshotItem[], ctx: ComposeContext): ComposedEmail {
  const subject = `Documents needed - ${ctx.tenantName} - ${ctx.caseReference}`;
  const lines: string[] = [
    `Hi ${ctx.contactName},`,
    ``,
    `${ctx.tenantName} still needs the following to move your case (${ctx.caseReference}) forward:`,
    ``,
  ];
  for (const it of items) {
    lines.push(
      it.state === "rejected"
        ? `  • ${it.label} - please re-send${it.reason ? ` (${it.reason})` : ""}`
        : `  • ${it.label}`,
    );
  }
  lines.push(
    ``,
    `Just reply to this email with the documents attached, and keep the subject line unchanged so we can match them to your case automatically.`,
    ``,
    `Thank you,`,
    ctx.tenantName,
  );
  return { subject, text: lines.join("\n") };
}

/** Max characters for the WhatsApp template's item-list variable. */
const WA_ITEMS_MAX = 600;

/**
 * The four body variables for the `document_request` template, in order:
 *   {{1}} contact name · {{2}} tenant name · {{3}} case reference · {{4}} items.
 * The item list is comma-joined and truncated with an "…and N more" tail so a
 * long checklist can never exceed WhatsApp's per-variable limit.
 */
export function composeWhatsappParams(items: NudgeSnapshotItem[], ctx: ComposeContext): string[] {
  const labels = items.map((it) => (it.state === "rejected" ? `${it.label} (re-send)` : it.label));
  let joined = labels.join(", ");
  if (joined.length > WA_ITEMS_MAX) {
    const kept: string[] = [];
    let len = 0;
    for (let i = 0; i < labels.length; i++) {
      const add = (kept.length ? 2 : 0) + labels[i].length;
      if (len + add > WA_ITEMS_MAX - 20) {
        kept.push(`…and ${labels.length - i} more`);
        break;
      }
      kept.push(labels[i]);
      len += add;
    }
    joined = kept.join(", ");
  }
  return [ctx.contactName, ctx.tenantName, ctx.caseReference, joined];
}
