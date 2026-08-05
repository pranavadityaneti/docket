import {
  caseMessages,
  cases,
  channels,
  contacts,
  tenants,
  type MessageKind,
  type NudgeSnapshotItem,
  type Tx,
} from "@docket/db";
import {
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
import { Cron, CronExpression } from "@nestjs/schedule";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { CurrentUser, JwtAuthGuard, type AuthUser } from "../auth/auth";
import { DbService } from "../db/db";
import { DocumentsModule, DocumentsService } from "../documents/documents";
import { collectNudgeItems, type ChecklistLike, type ComposeContext } from "./compose";
import { EmailNudgeSender, WhatsappNudgeSender } from "./senders";

/**
 * Asking subjects for the documents a case still needs - the outbound half of
 * Docket, and the counterpart to the intake channels.
 *
 * The content is composed from the same checklist() the dashboard reads, so a
 * request can never ask for something the screen says is already in. Delivery
 * fans out to every channel the subject is reachable on. Every send is a
 * case_messages row: the audit trail AND the reminder scheduler's memory.
 */

const REMINDER_INTERVAL_MS = 3 * 24 * 60 * 60 * 1000; // 3 days
const MAX_REMINDERS = 3;
// A forged/buggy flood cannot turn one cron tick into thousands of sends.
const NUDGE_RUN_BUDGET = 50;

type ChannelName = "email" | "whatsapp";
type ChannelResult = { channel: ChannelName; ok: boolean; detail?: string };
export type NudgeResult = { sent: ChannelResult[]; skipped?: string };

@Injectable()
export class NudgeService {
  private readonly log = new Logger(NudgeService.name);

  constructor(
    private readonly db: DbService,
    private readonly documents: DocumentsService,
    private readonly email: EmailNudgeSender,
    private readonly whatsapp: WhatsappNudgeSender,
  ) { }

  /**
   * Compose from the live checklist and deliver on every reachable channel.
   *
   * The checklist is read first (its own transaction). If nothing is
   * outstanding we stop before opening a write transaction at all. The send
   * itself runs under a FOR UPDATE lock on the case row so two concurrent calls
   * (a double-firing cron, or a manual click racing the cron) serialise - the
   * second re-checks due-state under the lock and skips. Never throws for a
   * send failure; the failure is recorded on the message row.
   */
  async sendNudge(tenantId: string, caseId: string, kind: MessageKind): Promise<NudgeResult> {
    const checklist = (await this.documents.checklist(tenantId, caseId)) as unknown as ChecklistLike;
    const items = collectNudgeItems(checklist);
    if (items.length === 0) return { sent: [], skipped: "complete" };

    return this.db.withTenant(tenantId, async (tx) => {
      // Serialise per case. A plain SELECT elsewhere does not block on this, so
      // reads are unaffected; only another sendNudge for the same case waits.
      const [lock] = await tx
        .select({ id: cases.id, pausedAt: cases.nudgesPausedAt })
        .from(cases)
        .where(and(eq(cases.id, caseId), isNull(cases.deletedAt)))
        .for("update")
        .limit(1);
      if (!lock) throw new NotFoundException("Case not found");

      // Pause stops the machine, never a person: manual sends ignore it.
      if (kind !== "manual" && lock.pausedAt) return { sent: [], skipped: "paused" };

      // Re-verify auto-send eligibility under the lock (idempotency).
      if (kind !== "manual") {
        const due = await this.dueState(tx, caseId);
        if (kind === "reminder" && !due.reminderDue) return { sent: [], skipped: "not-due" };
        if (kind === "initial" && due.hasAnySuccessful) return { sent: [], skipped: "already-sent" };
      }

      const ctxRow = await this.loadContext(tx, caseId);
      if (!ctxRow || !ctxRow.contactName) return { sent: [], skipped: "no-contact" };

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

      // ---- whatsapp leg (dormant until a whatsapp channel + template exist) ----
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

  private async loadContext(tx: Tx, caseId: string) {
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
      .where(and(eq(cases.id, caseId), isNull(cases.deletedAt)))
      .limit(1);
    return row ?? null;
  }

  private async enabledChannel(tx: Tx, kind: ChannelName) {
    const [ch] = await tx
      .select()
      .from(channels)
      .where(and(eq(channels.kind, kind), eq(channels.enabled, true)))
      // Deterministic when a tenant has more than one - oldest wins.
      .orderBy(asc(channels.createdAt))
      .limit(1);
    return ch;
  }

  /** Newest SUCCESSFUL message + reminder count for the case. */
  private async dueState(tx: Tx, caseId: string) {
    const rows = await tx
      .select({ kind: caseMessages.kind, status: caseMessages.status, sentAt: caseMessages.sentAt })
      .from(caseMessages)
      .where(eq(caseMessages.caseId, caseId))
      .orderBy(desc(caseMessages.sentAt));
    const successful = rows.filter((r) => r.status === "sent");
    const reminderCount = successful.filter((r) => r.kind === "reminder").length;
    const newest = successful[0];
    const reminderDue =
      reminderCount < MAX_REMINDERS &&
      (!newest || Date.now() - new Date(newest.sentAt).getTime() >= REMINDER_INTERVAL_MS);
    return { hasAnySuccessful: successful.length > 0, reminderCount, reminderDue };
  }

  private async record(
    tx: Tx,
    tenantId: string,
    caseId: string,
    kind: MessageKind,
    channel: ChannelName,
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

  pause(tenantId: string, caseId: string) {
    return this.setPaused(tenantId, caseId, new Date());
  }
  resume(tenantId: string, caseId: string) {
    return this.setPaused(tenantId, caseId, null);
  }
  private setPaused(tenantId: string, caseId: string, at: Date | null) {
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
  //
  // Discovered by the single ScheduleModule.forRoot() in ChannelsModule - the
  // scheduler scans providers app-wide, so this needs no forRoot of its own
  // (a second one would register every cron twice).

  private running = false;
  @Cron(CronExpression.EVERY_HOUR)
  async reminderScan(): Promise<void> {
    if (this.running) return;
    this.running = true;
    let budget = NUDGE_RUN_BUDGET;
    try {
      // Candidates across all tenants: active (not paused), contact reachable.
      // Completeness and due-timing need the checklist, so they are decided
      // per-case below rather than in this query.
      const candidates = await this.db.admin
        .select({ tenantId: cases.tenantId, caseId: cases.id })
        .from(cases)
        .innerJoin(contacts, eq(cases.contactId, contacts.id))
        .where(
          and(
            isNull(cases.nudgesPausedAt),
            // A deleted case must never be chased - the borrower would get a
            // reminder for an application nobody can open.
            isNull(cases.deletedAt),
            isNull(contacts.deletedAt),
            sql`(${contacts.email} is not null or ${contacts.phone} is not null)`,
          ),
        );

      for (const c of candidates) {
        if (budget <= 0) {
          this.log.warn(
            `Nudge run budget (${NUDGE_RUN_BUDGET}) exhausted - ${candidates.length} candidates this tick`,
          );
          break;
        }
        // Decide the kind from history; sendNudge re-checks under the lock.
        const kind = await this.db.withTenant(c.tenantId, async (tx) => {
          const due = await this.dueState(tx, c.caseId);
          if (!due.hasAnySuccessful) return "initial" as const;
          return due.reminderDue ? ("reminder" as const) : null;
        });
        if (!kind) continue;

        try {
          const result = await this.sendNudge(c.tenantId, c.caseId, kind);
          if (result.sent.length > 0) budget--;
        } catch (e) {
          this.log.error(
            `Nudge for case ${c.caseId} failed: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
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
  constructor(private readonly nudges: NudgeService) { }

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
  imports: [DocumentsModule],
  controllers: [NudgeController],
  providers: [NudgeService, EmailNudgeSender, WhatsappNudgeSender],
  exports: [NudgeService],
})
export class NudgesModule { }
