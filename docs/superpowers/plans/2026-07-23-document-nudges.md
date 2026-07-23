# Automated Document Requests & Reminders — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Docket asks subjects for documents — an initial request on case creation, reminders every 3 days (max 3) until the checklist completes — over email now and WhatsApp the moment its channel + template exist.

**Architecture:** One channel-agnostic core (`NudgeService`) composes from the same `checklist()` the dashboard reads, then delegates to a per-channel sender. Every delivery is a `case_messages` row — the audit trail AND the scheduler's memory. An hourly cron scans for due cases; case creation fires the first request; a manual button/pause live on the case screen.

**Tech Stack:** NestJS (SWC), Drizzle ORM → Postgres (RLS), `@nestjs/schedule` cron, Resend (email), WhatsApp Cloud API (template send), Next.js dashboard.

**Spec:** `docs/superpowers/specs/2026-07-23-document-nudges-design.md`

---

## Shared decisions (read before Task 1)

- **Channel enum reuse:** `case_messages.channel` reuses `CHANNEL_KINDS` (`"email" | "whatsapp"`) — do not define a second enum.
- **Snapshot item type** (used across tasks, exported from schema.ts):
  ```ts
  export type NudgeSnapshotItem = {
    key: string;
    label: string;
    state: "missing" | "rejected";
    reason?: string; // rejection reason, when state === "rejected"
  };
  ```
- **Kinds:** `MESSAGE_KINDS = ["initial", "reminder", "manual"] as const`.
- **Cadence constants** (hardcoded v1, live in `nudges/nudges.ts`): `REMINDER_INTERVAL_MS = 3 * 24 * 60 * 60 * 1000`, `MAX_REMINDERS = 3`, `NUDGE_RUN_BUDGET = 50`.
- **DocumentsService reuse:** `NudgeService` calls `DocumentsService.checklist()`. That service is currently NOT exported from `DocumentsModule`. Task 4 adds it to that module's `exports` — a one-line, behaviour-neutral change to an adjacent feature module (flagged per scope rules; no documents behaviour changes).

## File structure

| File | Responsibility |
|---|---|
| `packages/db/src/schema.ts` (modify) | `caseMessages` table, `cases.nudgesPausedAt`, `MESSAGE_KINDS`, `NudgeSnapshotItem` |
| `packages/db/migrations/0011_case_messages.sql` (create) | DDL + RLS, mirrors `0010_channels.sql` |
| `packages/db/migrations/meta/_journal.json` (modify) | journal entry for 0011 |
| `apps/api/src/nudges/compose.ts` (create) | pure: checklist → snapshot items; snapshot → email/WhatsApp content |
| `apps/api/src/nudges/senders.ts` (create) | `EmailNudgeSender`, `WhatsappNudgeSender` |
| `apps/api/src/nudges/nudges.ts` (create) | `NudgeService`, `NudgeController`, `NudgesModule` |
| `apps/api/test/nudges-compose.mjs` (create) | self-contained logic tests (run via swc register, like the webhook's 18) |
| `apps/api/src/documents/documents.ts` (modify) | export `DocumentsService` from `DocumentsModule` |
| `apps/api/src/cases/cases.ts` (modify) | fire initial nudge after create; import `NudgesModule` |
| `apps/api/src/app.module.ts` (modify) | register `NudgesModule` |
| `apps/web/lib/api.ts` (modify) | nudge endpoints + types |
| `apps/web/app/cases/[id]/page.tsx` (modify) | Request button, Pause/Resume, Sent history |

---

## Task 1: DB layer — `case_messages` table + `nudgesPausedAt`

**Files:**
- Modify: `packages/db/src/schema.ts`
- Create: `packages/db/migrations/0011_case_messages.sql`
- Modify: `packages/db/migrations/meta/_journal.json`

- [ ] **Step 1: Add constants and type near the top of schema.ts**

Find the block defining `CHANNEL_KINDS` (around line 77) and add immediately after it:

```ts
export const MESSAGE_KINDS = ["initial", "reminder", "manual"] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

/** One item Docket is (still) asking a subject for, captured on each message. */
export type NudgeSnapshotItem = {
  key: string;
  label: string;
  state: "missing" | "rejected";
  reason?: string;
};
```

- [ ] **Step 2: Add `nudgesPausedAt` to the `cases` table**

In the `cases` pgTable definition, add this column immediately after `data` (before `createdAt`):

```ts
    /**
     * Set when staff pause automated document requests for this case. Null =
     * active. The cron skips paused cases; a manual "Request documents" still
     * works — pause stops the machine, not the person.
     */
    nudgesPausedAt: timestamp("nudges_paused_at", { withTimezone: true }),
```

- [ ] **Step 3: Add the `caseMessages` table**

Place it immediately after the `documents` table definition. Reuse `CHANNEL_KINDS` for `channel`:

```ts
/**
 * One outbound document request or reminder, per channel delivered.
 *
 * This is both the audit trail ("what did we ask for, when, on which channel?")
 * and the scheduler's memory: the reminder cron decides what is due by reading
 * the newest successful row for a case. Snapshotting the items asked for
 * (itemsSnapshot) keeps the audit honest even after the checklist later changes.
 */
export const caseMessages = pgTable(
  "case_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    caseId: uuid("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: MESSAGE_KINDS }).notNull(),
    channel: text("channel", { enum: CHANNEL_KINDS }).notNull(),
    /** The address/number it was sent to, for audit. */
    recipient: text("recipient").notNull(),
    /** Email subject; null for WhatsApp (template-driven). */
    subject: text("subject"),
    itemsSnapshot: jsonb("items_snapshot").$type<NudgeSnapshotItem[]>().notNull().default(sql`'[]'::jsonb`),
    status: text("status", { enum: ["sent", "failed"] }).notNull(),
    /** Populated when status = 'failed'. */
    error: text("error"),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("case_messages_tenant_idx").on(t.tenantId),
    // The reminder cron and the case screen both read "this case's messages,
    // newest first".
    index("case_messages_case_sent_idx").on(t.caseId, t.sentAt),
  ],
);
```

- [ ] **Step 4: Add the inferred type export** (near the other `$inferSelect` exports at the bottom of schema.ts)

```ts
export type CaseMessage = typeof caseMessages.$inferSelect;
```

- [ ] **Step 5: Write the migration** `packages/db/migrations/0011_case_messages.sql`, mirroring `0010_channels.sql` exactly for the RLS/policy pattern:

```sql
-- Outbound document requests and reminders, one row per channel delivery.
-- Both the audit trail and the reminder scheduler's memory (it reads the newest
-- successful row per case to decide what is due). Tenant-scoped like every case
-- artifact.
ALTER TABLE "cases" ADD COLUMN "nudges_paused_at" timestamp with time zone;--> statement-breakpoint

CREATE TABLE "case_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "case_id" uuid NOT NULL REFERENCES "cases"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "channel" text NOT NULL,
  "recipient" text NOT NULL,
  "subject" text,
  "items_snapshot" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "status" text NOT NULL,
  "error" text,
  "sent_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "case_messages_kind_check" CHECK ("kind" IN ('initial', 'reminder', 'manual')),
  CONSTRAINT "case_messages_channel_check" CHECK ("channel" IN ('email', 'whatsapp')),
  CONSTRAINT "case_messages_status_check" CHECK ("status" IN ('sent', 'failed'))
);--> statement-breakpoint
CREATE INDEX "case_messages_tenant_idx" ON "case_messages" ("tenant_id");--> statement-breakpoint
CREATE INDEX "case_messages_case_sent_idx" ON "case_messages" ("case_id", "sent_at");--> statement-breakpoint

-- RLS: tenant-scoped exactly like channels. ALTER DEFAULT PRIVILEGES grants the
-- app role access the moment the table exists, so the policy is what confines it.
ALTER TABLE "case_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "case_messages" USING ("tenant_id" = current_tenant()) WITH CHECK ("tenant_id" = current_tenant());
```

- [ ] **Step 6: Append the journal entry** to `packages/db/migrations/meta/_journal.json` (inside the `entries` array, after the `0010_channels` object). Use a `when` strictly greater than 1784633751181 (0010's value); use `1784720151181`:

```json
    ,{
      "idx": 11,
      "version": "7",
      "when": 1784720151181,
      "tag": "0011_case_messages",
      "breakpoints": true
    }
```

- [ ] **Step 7: Typecheck the db package**

Run: `cd /Users/pranavaditya/projects/docket/packages/db && ../../node_modules/.bin/tsc --noEmit`
Expected: exit 0 (if tsc isn't at that path, use `pnpm --filter @docket/db exec tsc --noEmit`).

- [ ] **Step 8: Commit**

```bash
cd /Users/pranavaditya/projects/docket
git add packages/db/src/schema.ts packages/db/migrations/0011_case_messages.sql packages/db/migrations/meta/_journal.json
git commit -m "feat(db): case_messages table + cases.nudges_paused_at for document nudges"
```

STOP. Show diff + tsc output. Wait for approval.

---

## Task 2: The composer (pure functions + tests)

**Files:**
- Create: `apps/api/src/nudges/compose.ts`
- Create: `apps/api/test/nudges-compose.mjs`

The composer never touches the DB or network — it turns a checklist into snapshot items, and snapshot items into channel content. This is the piece most worth testing.

- [ ] **Step 1: Write `apps/api/src/nudges/compose.ts`**

```ts
import type { NudgeSnapshotItem } from "@docket/db";

/**
 * The subset of DocumentsService.checklist()'s output that composing needs.
 * Declared structurally so compose.ts stays free of Nest/DB imports and is
 * trivially testable.
 */
export interface ChecklistItemLike {
  key: string;
  label: string;
  required: boolean;
  status: string; // "missing" | "rejected" | "received" | ...
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
 * What is still being asked for: required items not yet supplied, plus anything
 * that was rejected (with the reason, so the re-ask is specific). Optional items
 * that were never sent are intentionally omitted — we do not nag for extras.
 */
export function collectNudgeItems(checklist: ChecklistLike): NudgeSnapshotItem[] {
  const out: NudgeSnapshotItem[] = [];
  for (const item of checklist.items) {
    if (item.status === "rejected") {
      const reason = item.documents.find((d) => d.status === "rejected")?.rejectionReason;
      out.push({ key: item.key, label: item.label, state: "rejected", reason: reason ?? undefined });
    } else if (item.required && item.status === "missing") {
      out.push({ key: item.key, label: item.label, state: "missing" });
    }
  }
  return out;
}

/** Email content. Caller only sends when items is non-empty. */
export function composeEmail(items: NudgeSnapshotItem[], ctx: ComposeContext): ComposedEmail {
  const subject = `Documents needed — ${ctx.tenantName} — ${ctx.caseReference}`;
  const lines: string[] = [
    `Hi ${ctx.contactName},`,
    ``,
    `${ctx.tenantName} still needs the following to move your application (${ctx.caseReference}) forward:`,
    ``,
  ];
  for (const it of items) {
    lines.push(
      it.state === "rejected"
        ? `  • ${it.label} — please re-send${it.reason ? ` (${it.reason})` : ""}`
        : `  • ${it.label}`,
    );
  }
  lines.push(
    ``,
    `Just reply to this email with the documents attached, and keep the subject line unchanged so we can match them to your application automatically.`,
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
 * {{1}} contact name · {{2}} tenant name · {{3}} case reference · {{4}} items.
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
```

- [ ] **Step 2: Write `apps/api/test/nudges-compose.mjs`**

```js
import assert from "node:assert";
import {
  collectNudgeItems,
  composeEmail,
  composeWhatsappParams,
} from "../src/nudges/compose.ts";

let pass = 0;
const ok = (name, fn) => { fn(); pass++; console.log("  PASS", name); };

const ctx = { contactName: "Asha", tenantName: "Acme Loans", caseReference: "DKT-7F3K2M" };

ok("collects required-missing and rejected, skips optional-missing and satisfied", () => {
  const items = collectNudgeItems({ items: [
    { key: "pan", label: "PAN card", required: true, status: "missing", documents: [] },
    { key: "sel", label: "Selfie", required: false, status: "missing", documents: [] },
    { key: "acc", label: "Bank statement", required: true, status: "accepted", documents: [] },
    { key: "aad", label: "Aadhaar", required: true, status: "rejected",
      documents: [{ status: "rejected", rejectionReason: "blurry" }] },
  ]});
  assert.deepStrictEqual(items, [
    { key: "pan", label: "PAN card", state: "missing" },
    { key: "aad", label: "Aadhaar", state: "rejected", reason: "blurry" },
  ]);
});

ok("rejected with no reason yields undefined reason", () => {
  const items = collectNudgeItems({ items: [
    { key: "aad", label: "Aadhaar", required: true, status: "rejected",
      documents: [{ status: "rejected", rejectionReason: null }] },
  ]});
  assert.strictEqual(items[0].reason, undefined);
});

ok("complete checklist yields empty items", () => {
  const items = collectNudgeItems({ items: [
    { key: "pan", label: "PAN card", required: true, status: "accepted", documents: [] },
  ]});
  assert.strictEqual(items.length, 0);
});

ok("email subject carries tenant + reference", () => {
  const { subject } = composeEmail([{ key: "pan", label: "PAN card", state: "missing" }], ctx);
  assert.strictEqual(subject, "Documents needed — Acme Loans — DKT-7F3K2M");
});

ok("email body lists items and re-ask reason", () => {
  const { text } = composeEmail([
    { key: "pan", label: "PAN card", state: "missing" },
    { key: "aad", label: "Aadhaar", state: "rejected", reason: "blurry" },
  ], ctx);
  assert.ok(text.includes("• PAN card"));
  assert.ok(text.includes("• Aadhaar — please re-send (blurry)"));
  assert.ok(text.includes("DKT-7F3K2M"));
});

ok("whatsapp params are the 4 body variables in order", () => {
  const p = composeWhatsappParams([{ key: "pan", label: "PAN card", state: "missing" }], ctx);
  assert.deepStrictEqual(p, ["Asha", "Acme Loans", "DKT-7F3K2M", "PAN card"]);
});

ok("whatsapp item list truncates with an overflow tail", () => {
  const many = Array.from({ length: 100 }, (_, i) => ({
    key: `k${i}`, label: `Document number ${i} with a long name`, state: "missing",
  }));
  const p = composeWhatsappParams(many, ctx);
  assert.ok(p[3].length <= 600);
  assert.ok(/…and \d+ more/.test(p[3]));
});

console.log(`\n${pass} passed`);
```

- [ ] **Step 3: Run the tests**

Run: `cd /Users/pranavaditya/projects/docket/apps/api && node --import @swc-node/register/esm-register test/nudges-compose.mjs`
Expected: `7 passed`

- [ ] **Step 4: Typecheck**

Run: `cd /Users/pranavaditya/projects/docket && pnpm --filter @docket/api exec tsc --noEmit`
Expected: exit 0

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/nudges/compose.ts apps/api/test/nudges-compose.mjs
git commit -m "feat(api): nudge composer — checklist to email/WhatsApp content"
```

STOP. Show test output + diff. Wait for approval.

---

## Task 3: The senders

**Files:**
- Create: `apps/api/src/nudges/senders.ts`

Each sender does one thing: deliver already-composed content over one channel, returning success or an error string. Neither throws.

- [ ] **Step 1: Write `apps/api/src/nudges/senders.ts`**

```ts
import { Injectable, Logger } from "@nestjs/common";
import { Resend } from "resend";
import { openSecret, type NudgeSnapshotItem } from "@docket/db";
import { env } from "../config/env";
import { composeEmail, composeWhatsappParams, type ComposeContext } from "./compose";

export type SendOutcome = { ok: true } | { ok: false; error: string };

/**
 * Sends the document-request email via Resend. Reply-To is the tenant's own
 * mailbox address so the subject's reply (with attachments) lands where the
 * email poller will match it back to the case.
 */
@Injectable()
export class EmailNudgeSender {
  private readonly log = new Logger(EmailNudgeSender.name);
  private readonly resend = env.resendApiKey ? new Resend(env.resendApiKey) : null;

  configured(): boolean {
    return !!this.resend && !!env.resendFromEmail;
  }

  /** Returns the subject line used (for the audit row) alongside the outcome. */
  async send(
    to: string,
    replyTo: string,
    items: NudgeSnapshotItem[],
    ctx: ComposeContext,
  ): Promise<SendOutcome & { subject: string }> {
    const { subject, text } = composeEmail(items, ctx);
    if (!this.resend || !env.resendFromEmail) {
      return { ok: false, error: "Resend not configured", subject };
    }
    const { error } = await this.resend.emails.send({
      from: `${ctx.tenantName} <${env.resendFromEmail}>`,
      to,
      replyTo,
      subject,
      text,
    });
    if (error) {
      const msg = error.message ?? String(error);
      this.log.error(`Nudge email to ${to} failed: ${msg}`);
      return { ok: false, error: msg, subject };
    }
    return { ok: true, subject };
  }
}

/** Decrypted WhatsApp credential (same shape the webhook stores). */
interface WhatsappSecret {
  accessToken: string;
  appSecret: string;
}

/**
 * Sends the `document_request` template via the WhatsApp Cloud API. Business-
 * initiated messages must be a Meta-approved template, so this is template-only
 * by design. Dormant until a whatsapp channel exists with a templateName in its
 * config — resolveWhatsapp() in NudgeService gates that.
 */
@Injectable()
export class WhatsappNudgeSender {
  private readonly log = new Logger(WhatsappNudgeSender.name);

  async send(
    channel: { config: Record<string, unknown> | null; secretCiphertext: string | null },
    recipientPhone: string,
    items: NudgeSnapshotItem[],
    ctx: ComposeContext,
  ): Promise<SendOutcome> {
    const templateName =
      channel.config && typeof channel.config.templateName === "string"
        ? (channel.config.templateName as string)
        : null;
    const phoneNumberId =
      channel.config && typeof channel.config.phoneNumberId === "string"
        ? (channel.config.phoneNumberId as string)
        : null;
    if (!templateName || !phoneNumberId) {
      return { ok: false, error: "WhatsApp channel missing templateName/phoneNumberId" };
    }
    if (!env.channelSecretKey || !channel.secretCiphertext) {
      return { ok: false, error: "WhatsApp channel has no usable credential" };
    }
    let accessToken: string;
    try {
      // Same seal/open shape as the webhook. Kept local rather than coupling the
      // nudge feature to the webhook module; consolidate into a channels util later.
      const parsed = JSON.parse(openSecret(channel.secretCiphertext, env.channelSecretKey)) as
        | Partial<WhatsappSecret>
        | undefined;
      if (!parsed?.accessToken) return { ok: false, error: "credential missing accessToken" };
      accessToken = parsed.accessToken;
    } catch {
      return { ok: false, error: "credential could not be decrypted" };
    }

    const params = composeWhatsappParams(items, ctx);
    const to = recipientPhone.replace(/\D/g, "");
    try {
      const res = await fetch(
        `https://graph.facebook.com/${env.graphApiVersion}/${phoneNumberId}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to,
            type: "template",
            template: {
              name: templateName,
              language: { code: "en" },
              components: [
                { type: "body", parameters: params.map((text) => ({ type: "text", text })) },
              ],
            },
          }),
          signal: AbortSignal.timeout(15_000),
        },
      );
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        return { ok: false, error: `WhatsApp send ${res.status}: ${detail.slice(0, 200)}` };
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd /Users/pranavaditya/projects/docket && pnpm --filter @docket/api exec tsc --noEmit`
Expected: exit 0

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/nudges/senders.ts
git commit -m "feat(api): email + WhatsApp nudge senders"
```

STOP. Show diff + tsc. Wait for approval.

---

## Task 4: `NudgeService`, controller, module + `DocumentsService` export

**Files:**
- Modify: `apps/api/src/documents/documents.ts` (export DocumentsService)
- Create: `apps/api/src/nudges/nudges.ts`

- [ ] **Step 1: Export DocumentsService from its module**

In `apps/api/src/documents/documents.ts`, find the `@Module({...}) export class DocumentsModule {}` (around line 641) and add an `exports` array listing `DocumentsService` (keep existing `imports`/`providers`/`controllers` as they are). Example — match the existing object's other keys:

```ts
@Module({
  imports: [StorageModule],
  controllers: [DocumentsController],
  providers: [DocumentsService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
```

(If the existing `@Module` has different `imports`, preserve them — only add the `exports` line.)

- [ ] **Step 2: Write `apps/api/src/nudges/nudges.ts`**

```ts
import {
  Body,
  Controller,
  Get,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from "@nestjs/common";
import { Cron, CronExpression, ScheduleModule } from "@nestjs/schedule";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  cases,
  caseMessages,
  channels,
  contacts,
  tenants,
  workflows,
  type MessageKind,
  type NudgeSnapshotItem,
} from "@docket/db";
import { DbService } from "../db/db";
import { CurrentUser, JwtAuthGuard, type AuthUser } from "../auth/auth";
import { DocumentsModule, DocumentsService } from "../documents/documents";
import { collectNudgeItems, type ComposeContext, type ChecklistLike } from "./compose";
import { EmailNudgeSender, WhatsappNudgeSender } from "./senders";

const REMINDER_INTERVAL_MS = 3 * 24 * 60 * 60 * 1000;
const MAX_REMINDERS = 3;
const NUDGE_RUN_BUDGET = 50;

/** Per-channel result surfaced to staff on a manual send. */
type ChannelResult = { channel: "email" | "whatsapp"; ok: boolean; detail?: string };
export type NudgeResult = { sent: ChannelResult[]; skipped?: string };

@Injectable()
export class NudgeService {
  private readonly log = new Logger(NudgeService.name);

  constructor(
    private readonly db: DbService,
    private readonly documents: DocumentsService,
    private readonly email: EmailNudgeSender,
    private readonly whatsapp: WhatsappNudgeSender,
  ) {}

  /**
   * Compose from the live checklist and deliver on every reachable channel.
   * For auto kinds ('initial'/'reminder') a row-lock on the case serialises
   * concurrent sends so a double-firing cron cannot double-send. Never throws.
   */
  async sendNudge(tenantId: string, caseId: string, kind: MessageKind): Promise<NudgeResult> {
    return this.db.withTenant(tenantId, async (tx) => {
      // Serialise per-case (guards cron overlap + create/cron race).
      const [lock] = await tx
        .select({ id: cases.id, pausedAt: cases.nudgesPausedAt })
        .from(cases)
        .where(eq(cases.id, caseId))
        .for("update")
        .limit(1);
      if (!lock) throw new NotFoundException("Case not found");

      // Pause blocks auto sends but never a manual one.
      if (kind !== "manual" && lock.pausedAt) return { sent: [], skipped: "paused" };

      const ctxRow = await this.loadContext(tx, caseId);
      if (!ctxRow) return { sent: [], skipped: "no-contact" };

      const checklist = (await this.documents.checklist(tenantId, caseId)) as unknown as ChecklistLike;
      const items = collectNudgeItems(checklist);
      if (items.length === 0) return { sent: [], skipped: "complete" };

      // Re-verify auto-send eligibility under the lock (idempotency).
      if (kind !== "manual") {
        const due = await this.dueState(tx, caseId);
        if (kind === "reminder" && !due.reminderDue) return { sent: [], skipped: "not-due" };
        if (kind === "initial" && due.hasAnySuccessful) return { sent: [], skipped: "already-sent" };
      }

      const ctx: ComposeContext = {
        contactName: ctxRow.contactName,
        tenantName: ctxRow.tenantName,
        caseReference: ctxRow.reference,
      };
      const sent: ChannelResult[] = [];

      // ---- email leg ----
      const emailCh = await this.enabledChannel(tx, "email");
      if (ctxRow.contactEmail && emailCh && this.email.configured()) {
        const r = await this.email.send(ctxRow.contactEmail, emailCh.address, items, ctx);
        await this.record(tx, tenantId, caseId, kind, "email", ctxRow.contactEmail, r.subject, items, r);
        sent.push({ channel: "email", ok: r.ok, detail: r.ok ? undefined : r.error });
      }

      // ---- whatsapp leg (dormant until channel + template exist) ----
      const waCh = await this.enabledChannel(tx, "whatsapp");
      if (ctxRow.contactPhone && waCh) {
        const r = await this.whatsapp.send(waCh, ctxRow.contactPhone, items, ctx);
        await this.record(tx, tenantId, caseId, kind, "whatsapp", ctxRow.contactPhone, null, items, r);
        sent.push({ channel: "whatsapp", ok: r.ok, detail: r.ok ? undefined : r.error });
      }

      if (sent.length === 0) return { sent: [], skipped: "no-channel" };
      return { sent };
    });
  }

  private async loadContext(tx: any, caseId: string) {
    const [row] = await tx
      .select({
        reference: cases.reference,
        contactName: contacts.name,
        contactEmail: contacts.email,
        contactPhone: contacts.phone,
        tenantName: tenants.name,
      })
      .from(cases)
      .innerJoin(tenants, eq(cases.tenantId, tenants.id))
      .leftJoin(contacts, eq(cases.contactId, contacts.id))
      .where(eq(cases.id, caseId))
      .limit(1);
    if (!row || !row.contactName) return null;
    return row;
  }

  private async enabledChannel(tx: any, kind: "email" | "whatsapp") {
    const [ch] = await tx
      .select()
      .from(channels)
      .where(and(eq(channels.kind, kind), eq(channels.enabled, true)))
      .limit(1);
    return ch;
  }

  /** Newest SUCCESSFUL message + reminder count for the case. */
  private async dueState(tx: any, caseId: string) {
    const rows = await tx
      .select({ kind: caseMessages.kind, status: caseMessages.status, sentAt: caseMessages.sentAt })
      .from(caseMessages)
      .where(eq(caseMessages.caseId, caseId))
      .orderBy(desc(caseMessages.sentAt));
    const successful = rows.filter((r: any) => r.status === "sent");
    const reminderCount = successful.filter((r: any) => r.kind === "reminder").length;
    const newest = successful[0];
    const reminderDue =
      reminderCount < MAX_REMINDERS &&
      (!newest || Date.now() - new Date(newest.sentAt).getTime() >= REMINDER_INTERVAL_MS);
    return { hasAnySuccessful: successful.length > 0, reminderCount, reminderDue };
  }

  private async record(
    tx: any,
    tenantId: string,
    caseId: string,
    kind: MessageKind,
    channel: "email" | "whatsapp",
    recipient: string,
    subject: string | null,
    items: NudgeSnapshotItem[],
    outcome: { ok: boolean; error?: string },
  ) {
    await tx.insert(caseMessages).values({
      tenantId,
      caseId,
      kind,
      channel,
      recipient,
      subject,
      itemsSnapshot: items,
      status: outcome.ok ? "sent" : "failed",
      error: outcome.ok ? null : (outcome.error ?? "unknown"),
    });
  }

  // ---- staff actions ----

  async pause(tenantId: string, caseId: string) {
    return this.setPaused(tenantId, caseId, new Date());
  }
  async resume(tenantId: string, caseId: string) {
    return this.setPaused(tenantId, caseId, null);
  }
  private async setPaused(tenantId: string, caseId: string, at: Date | null) {
    return this.db.withTenant(tenantId, async (tx) => {
      const [row] = await tx
        .update(cases)
        .set({ nudgesPausedAt: at })
        .where(eq(cases.id, caseId))
        .returning({ id: cases.id, nudgesPausedAt: cases.nudgesPausedAt });
      if (!row) throw new NotFoundException("Case not found");
      return row;
    });
  }

  history(tenantId: string, caseId: string) {
    return this.db.withTenant(tenantId, (tx) =>
      tx
        .select({
          id: caseMessages.id,
          kind: caseMessages.kind,
          channel: caseMessages.channel,
          recipient: caseMessages.recipient,
          status: caseMessages.status,
          error: caseMessages.error,
          sentAt: caseMessages.sentAt,
        })
        .from(caseMessages)
        .where(eq(caseMessages.caseId, caseId))
        .orderBy(desc(caseMessages.sentAt)),
    );
  }

  // ---- reminder cron ----

  private running = false;
  @Cron(CronExpression.EVERY_HOUR)
  async reminderScan(): Promise<void> {
    if (this.running) return;
    this.running = true;
    let budget = NUDGE_RUN_BUDGET;
    try {
      // Candidate cases across all tenants: active (not paused), with a contact
      // that has at least one identifier. Completeness + due timing are checked
      // per-case inside sendNudge (they need the checklist).
      const candidates = await this.db.admin
        .select({ tenantId: cases.tenantId, caseId: cases.id })
        .from(cases)
        .innerJoin(contacts, eq(cases.contactId, contacts.id))
        .where(
          and(
            isNull(cases.nudgesPausedAt),
            sql`(${contacts.email} is not null or ${contacts.phone} is not null)`,
          ),
        );
      for (const c of candidates) {
        if (budget <= 0) {
          this.log.warn(`Nudge run budget exhausted — ${candidates.length} candidates this tick`);
          break;
        }
        // Decide kind from history; sendNudge re-checks under the lock.
        const kind = await this.db.withTenant(c.tenantId, async (tx) => {
          const due = await this.dueState(tx, c.caseId);
          if (!due.hasAnySuccessful) return "initial" as const;
          return due.reminderDue ? ("reminder" as const) : null;
        });
        if (!kind) continue;
        const result = await this.sendNudge(c.tenantId, c.caseId, kind);
        if (result.sent.length > 0) budget--;
      }
    } catch (e) {
      this.log.error(`Reminder scan failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.running = false;
    }
  }
}

@Controller("cases")
@UseGuards(JwtAuthGuard)
export class NudgeController {
  constructor(private readonly nudges: NudgeService) {}

  @Post(":id/nudge")
  send(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.nudges.sendNudge(u.tenantId, id, "manual");
  }

  @Post(":id/nudges/pause")
  pause(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.nudges.pause(u.tenantId, id);
  }

  @Post(":id/nudges/resume")
  resume(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.nudges.resume(u.tenantId, id);
  }

  @Get(":id/messages")
  history(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.nudges.history(u.tenantId, id);
  }
}

@Module({
  imports: [ScheduleModule.forRoot(), DocumentsModule],
  controllers: [NudgeController],
  providers: [NudgeService, EmailNudgeSender, WhatsappNudgeSender],
  exports: [NudgeService],
})
export class NudgesModule {}
```

- [ ] **Step 3: Typecheck**

Run: `cd /Users/pranavaditya/projects/docket && pnpm --filter @docket/api exec tsc --noEmit`
Expected: exit 0. If `NudgeController`'s `cases` prefix collides with `CasesController`, that is fine — Nest allows multiple controllers on one prefix as long as full paths differ (`/cases/:id/nudge` vs `/cases/:id`).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/nudges/nudges.ts apps/api/src/documents/documents.ts
git commit -m "feat(api): NudgeService — compose, send, reminder cron, staff actions"
```

STOP. Show diff + tsc. Wait for approval.

---

## Task 5: Wire the triggers (case creation + app module)

**Files:**
- Modify: `apps/api/src/cases/cases.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Register the module** in `apps/api/src/app.module.ts` — add `NudgesModule` to the `imports` array (import it: `import { NudgesModule } from "./nudges/nudges";`).

- [ ] **Step 2: Inject NudgeService into CasesService** — in `apps/api/src/cases/cases.ts`:
  - add import: `import { NudgeService } from "../nudges/nudges";`
  - change the constructor:
    ```ts
    constructor(
      private readonly db: DbService,
      private readonly nudges: NudgeService,
    ) {}
    ```

- [ ] **Step 3: Fire the initial nudge after create commits.** In `CasesService.create`, the `withTenant` callback returns `created` from inside the retry loop. Capture it and fire the nudge after the DB work returns, so a nudge failure can never roll back or fail case creation:

Change the method so the `withTenant(...)` result is stored, then fire-and-forget before returning:

```ts
create(tenantId: string, input: CreateCaseDto) {
  const data = input.data ?? {};
  if (Buffer.byteLength(JSON.stringify(data), "utf8") > MAX_DATA_BYTES) {
    throw new BadRequestException("data is too large");
  }

  return this.db
    .withTenant(tenantId, async (tx) => {
      // ... unchanged body: resolveWorkflow, firstStage, contact insert,
      // reference retry loop returning `created` ...
    })
    .then((created) => {
      // Fire-and-forget: the borrower's first request. Never allowed to fail or
      // delay case creation — a send problem is recorded on case_messages.
      void this.nudges
        .sendNudge(tenantId, created.id, "initial")
        .catch((e) => this.log.error(`initial nudge for ${created.id} failed: ${e}`));
      return created;
    });
}
```

Add a logger to CasesService: `private readonly log = new Logger(CasesService.name);` and import `Logger` from `@nestjs/common`. (This introduces a circular module reference only if NudgesModule imported CasesModule — it does not. NudgesModule depends on DocumentsModule; CasesModule depends on NudgesModule. One-way.)

- [ ] **Step 4: Import NudgesModule into CasesModule** — change the bottom of `cases.ts`:

```ts
@Module({
  imports: [NudgesModule],
  controllers: [CasesController],
  providers: [CasesService],
})
export class CasesModule {}
```

(Add `Module` is already imported; add `NudgesModule` to the existing import from `../nudges/nudges`.)

- [ ] **Step 5: Typecheck + boot check**

Run: `cd /Users/pranavaditya/projects/docket && pnpm --filter @docket/api exec tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/cases/cases.ts apps/api/src/app.module.ts
git commit -m "feat(api): fire initial document request on case creation"
```

STOP. Show diff + tsc. Wait for approval.

---

## Task 6: Dashboard — Request button, Pause/Resume, Sent history

**Files:**
- Modify: `apps/web/lib/api.ts`
- Modify: `apps/web/app/cases/[id]/page.tsx`

- [ ] **Step 1: Add API client functions + types to `apps/web/lib/api.ts`** (follow the existing `reviewDocument`/`removeDocument` fetch pattern in that file for auth headers and base URL):

```ts
export type NudgeChannelResult = { channel: "email" | "whatsapp"; ok: boolean; detail?: string };
export type NudgeResult = { sent: NudgeChannelResult[]; skipped?: string };

export type ApiCaseMessage = {
  id: string;
  kind: "initial" | "reminder" | "manual";
  channel: "email" | "whatsapp";
  recipient: string;
  status: "sent" | "failed";
  error: string | null;
  sentAt: string;
};

export async function requestDocuments(caseId: string): Promise<NudgeResult> {
  return apiPost(`/cases/${caseId}/nudge`); // use the file's existing POST helper
}
export async function pauseNudges(caseId: string) {
  return apiPost(`/cases/${caseId}/nudges/pause`);
}
export async function resumeNudges(caseId: string) {
  return apiPost(`/cases/${caseId}/nudges/resume`);
}
export async function getCaseMessages(caseId: string): Promise<ApiCaseMessage[]> {
  return apiGet(`/cases/${caseId}/messages`); // use the file's existing GET helper
}
```

(Match the actual helper names/signatures already in `api.ts` — if it uses a single `request()` wrapper, use that instead of `apiGet`/`apiPost`. Add `nudgesPausedAt: string | null` to the `ApiCaseDetail` type.)

- [ ] **Step 2: Add the UI to the case screen** `apps/web/app/cases/[id]/page.tsx`. Near the case header actions, add:
  - a **"Request documents"** button → calls `requestDocuments(id)`, then shows a short result toast/line ("Sent via email" or the per-channel error), and refreshes the message history;
  - a **Pause/Resume** toggle bound to `detail.nudgesPausedAt` → calls `pauseNudges`/`resumeNudges`, refreshes;
  - a **"Sent" list** rendered from `getCaseMessages(id)` (kind · channel · relative time · status; show `error` on failed rows).

  Follow the existing state/handler pattern in this file (`busyId`, `actionError`, `load()` refresh). Load messages in the same effect that loads the checklist.

- [ ] **Step 3: Typecheck the web app**

Run: `cd /Users/pranavaditya/projects/docket && pnpm --filter web exec tsc --noEmit`
Expected: exit 0

- [ ] **Step 4: Verify in the browser** (per verification workflow): start the web dev server, open a case, confirm the button/pause/history render and the network calls succeed against the API.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/api.ts "apps/web/app/cases/[id]/page.tsx"
git commit -m "feat(web): document-request button, pause/resume, sent history on case screen"
```

STOP. Show diff + screenshot. Wait for approval.

---

## Task 7: Deploy + production E2E

- [ ] **Step 1:** Confirm account `771650096408` and prod Ready/Green (`aws sts get-caller-identity --profile finlot`; `describe-environments`).
- [ ] **Step 2:** Run migration 0011 on prod RDS via SSM (private RDS — same pattern as prior migrations; see `docket-prod-deploy-runbook`). Verify `case_messages` exists and RLS is enabled.
- [ ] **Step 3:** Build + bundle + S3 + create-application-version + update-environment (standard runbook). Then `CI=true pnpm install` locally (ERRORS.md lesson).
- [ ] **Step 4:** Wait for Ready/Green; verify the new version label.
- [ ] **Step 5: Prod E2E** — create a real case with your own email as the contact; confirm the initial request email arrives; reply with a PDF attached (subject unchanged); confirm the document lands on the case via the existing poller. Confirm a `case_messages` row exists (kind `initial`, status `sent`).
- [ ] **Step 6:** Update `SESSION_LOG.md` and mark forlater items if any move.

STOP. Report results.

---

## Self-review notes (done during planning)

- **Spec coverage:** data (T1) · composer (T2) · senders incl. WhatsApp template (T3) · triggers/cron/manual/pause/history/idempotency/budget (T4) · creation hook + wiring (T5) · UI (T6) · deploy+E2E (T7). All spec sections map to a task.
- **Idempotency:** implemented via `SELECT ... FOR UPDATE` on the case row in `sendNudge` + re-check of `dueState` under the lock — a double-firing cron cannot double-send.
- **Failed sends** are excluded from `dueState` (it filters `status === "sent"`), so a failed initial/reminder does not reset the clock and will be retried next tick — matching the spec.
- **Type consistency:** `NudgeSnapshotItem`, `ComposeContext`, `ChecklistLike`, `MessageKind` used identically across compose.ts / senders.ts / nudges.ts.
- **Known small duplication (flagged):** WhatsApp credential decrypt exists both in the webhook and the WhatsApp sender; consolidate into a channels util in a later pass (not this feature's scope).
- **WhatsApp dormancy:** the sender is wired and typed but only fires when an enabled `whatsapp` channel with `config.templateName` exists — so v1 ships live email + tested-but-dormant WhatsApp, exactly as approved.
