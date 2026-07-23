# Automated document requests & reminders — design

**Date:** 2026-07-23 · **Status:** approved by Pranav (chat) · **Scope:** email live in v1; WhatsApp machinery built in v1, activates when channel + template exist

## What this is

Docket currently only *receives* documents. This feature makes it *ask* for them: when a case
is created the subject gets a request listing what's needed, reminders follow every 3 days
while anything is missing, and the chasing stops on its own the moment the checklist completes.
Replies file themselves through the existing intake (email poller / WhatsApp webhook).

Approved cadence: **initial on case creation, reminder every 3 days, max 3 auto-reminders,
stop on checklist completion, per-case pause.** Hardcoded in v1 (per-workflow config deferred).

## Architecture

One channel-agnostic core, one sender per channel:

```
case created ──┐
hourly cron ───┼──► NudgeService.sendNudge(case, kind)
manual button ─┘         │
                         ├─ compose from checklist()  (same source the dashboard reads)
                         ├─ EmailSender     — if contact.email && tenant has enabled email channel
                         ├─ WhatsappSender  — if contact.phone && tenant has enabled whatsapp
                         │                    channel && approved template configured
                         └─ one case_messages row PER channel delivery (audit + scheduler memory)
```

### Data

- **`case_messages`** (tenant-scoped, RLS `tenant_isolation` like every tenant table):
  `id uuid pk · tenantId · caseId · kind ('initial'|'reminder'|'manual') · channel
  ('email'|'whatsapp') · recipient text · subject text nullable (email only) ·
  itemsSnapshot jsonb (what was asked: [{key,label,state:'missing'|'rejected',reason?}]) ·
  status ('sent'|'failed') · error text nullable · sentAt timestamptz default now()`.
  Indexes: `(tenantId)`, `(caseId, sentAt desc)`.
- **`cases.nudgesPausedAt`** timestamptz nullable — staff Pause button. Null = active.

### Composing (shared by both channels)

Input: the case's `checklist()` output + case reference + tenant name + contact name.
Content: missing **required** items (label + description) and rejected items with their
`rejectionReason`. If nothing is missing or rejected → no send (composer returns null).

- **Email:** subject `Documents needed — <tenant name> — DKT-XXXXXX` (the ref is what the
  poller matches on replies). Plain-text body v1: greeting, why they're being contacted,
  the itemised list, "reply to this email with the documents attached and keep the subject
  line unchanged". From: verified Resend domain with tenant name as display name.
  **Reply-To: the tenant's enabled email channel address** — replies land in the mailbox the
  poller reads.
- **WhatsApp:** business-initiated ⇒ Meta-approved template only. Template
  `document_request` (submitted under the tenant's WABA) with variables:
  {{1}} contact name · {{2}} tenant name · {{3}} case reference · {{4}} item list as a
  single comma-joined string (capped ~600 chars, "…and N more" overflow). Sender reads the
  template name from the channel's `config.templateName`; absent ⇒ channel not nudge-capable
  yet ⇒ skip WhatsApp leg silently-but-surfaced (see Skips).

### Triggers

1. **Case creation** — after create commits, fire-and-forget `sendNudge(kind:'initial')`.
   Failure must never fail case creation.
2. **Hourly cron** (`@nestjs/schedule`, same pattern as the email poller, overlap-guarded):
   a case is **due** when ALL of: checklist has missing-required or rejected items ·
   `nudgesPausedAt is null` · newest successful case_message `sentAt` ≥ 3 days ago **or no
   successful message exists at all** (covers an initial that failed or was skipped at
   creation) · count of kind='reminder' messages < 3 · contact exists.
   The cron sends kind `'initial'` when the case has no successful message yet, else
   `'reminder'` — so a retried first ask never eats into the reminder cap.
3. **Manual button** — `POST /cases/:id/nudge` (kind 'manual'): sends now, resets the 3-day
   clock (it's the newest message), does NOT count against the reminder cap, and works even
   on a paused case — pause stops the machine, not the staff.

### Stop / skip conditions

Stop: checklist complete (no missing-required, no rejected) · 3 reminders sent · paused.
Skip a channel leg when: contact lacks that identifier · tenant lacks an enabled channel of
that kind · (whatsapp) no templateName configured. **A case whose contact has NO reachable
channel at all is surfaced** in the cron log summary and via `case_messages` absence — the
manual endpoint returns a clear error naming why each channel was skipped.

### Safety rails

- Per-cron-run send budget: max 50 nudge events per run — a bug can never mass-email.
- Idempotency: due-check re-runs inside the send transaction (SELECT newest message FOR
  UPDATE on the case row) so a double-firing cron can't double-send.
- Send failures: recorded on the message row (`status:'failed'`, error), never thrown to
  the caller; a failed send does NOT reset the 3-day clock (failed rows are excluded from
  the "newest message" due-check).
- Cross-tenant: cron iterates via `db.admin` for the scan, but every per-case read/write
  runs inside `withTenant` — same discipline as the pollers.

### API surface

- `POST /cases/:id/nudge` — manual send; returns per-channel outcome.
- `POST /cases/:id/nudges/pause` · `POST /cases/:id/nudges/resume`.
- `GET /cases/:id/messages` — sent history for the case screen.
- Checklist/case detail responses gain `nudgesPausedAt`.

### UI (case screen, existing patterns)

"Request documents" button → dialog previews recipient(s) + itemised ask → confirm →
per-channel result. Pause/Resume toggle. "Sent" history list (kind, channel, when, status).

### Testing

- Composer: fixtures for missing-only, rejected-only, mixed, complete (→ null), overflow list.
- Due-query: each stop/skip condition flips eligibility exactly as specified.
- `tsc --noEmit`; self-contained logic tests (same harness as the webhook's 18).
- Prod E2E: real case, real email, reply with attachment, watch it file itself.

### Explicitly out of v1

Per-workflow cadence config · quiet hours · per-tenant copy customization · WhatsApp
free-form replies within the 24h service window (template-only is correct and simpler) ·
staff notifications on arrival (separate feature) · SMS.

### External dependencies (WhatsApp leg)

Item 9 (channel registration — Pranav's Meta values) and a `document_request` template
approved under the WABA. Until both exist the WhatsApp sender is dormant, tested code.
