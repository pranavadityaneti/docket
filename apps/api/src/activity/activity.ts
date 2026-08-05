import {
  caseMessages,
  cases,
  contacts,
  conversationMessages,
  documentRequirements,
  documents,
  workflowStages,
  workflows,
} from "@docket/db";
import { Controller, Get, Injectable, Module, UseGuards } from "@nestjs/common";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { CurrentUser, JwtAuthGuard, type AuthUser } from "../auth/auth";
import { DbService } from "../db/db";
import { requirementApplies, rollUpStatus } from "../documents/documents";

/**
 * Cross-case activity: the two workspace-wide views over what is happening.
 *
 * Both answer questions a single case cannot. "Who has written to us lately?"
 * and "who owes us documents, and when did we last ask?" are triage questions
 * - they are about choosing which case to open, so they cannot live inside one.
 *
 * Every figure is derived from rows, and the reminder arithmetic is the SAME
 * rule the scheduler applies (3-day interval, 3 reminders maximum). A screen
 * that said a case was "due" while the cron disagreed would be worse than no
 * screen: people would chase manually and double-message the borrower.
 */

/** Kept in step with NudgeService - see the note above about disagreeing. */
const REMINDER_INTERVAL_MS = 3 * 24 * 60 * 60 * 1000;
const MAX_REMINDERS = 3;

export type ConversationThread = {
  caseId: string;
  reference: string;
  subjectName: string | null;
  subjectOrganisation: string | null;
  /** Channel of the most recent message either way. */
  channel: "email" | "whatsapp";
  direction: "inbound" | "outbound";
  preview: string;
  at: Date;
  inboundCount: number;
};

export type FollowUpRow = {
  caseId: string;
  reference: string;
  subjectName: string | null;
  subjectOrganisation: string | null;
  stageName: string | null;
  workflowName: string;
  /** Required checklist items with nothing usable against them. */
  outstanding: number;
  /** Successful requests already sent, and of those, reminders. */
  requestsSent: number;
  remindersSent: number;
  lastRequestAt: Date | null;
  /** Null when nothing has been sent yet. */
  daysSinceLastRequest: number | null;
  paused: boolean;
  /** True when the scheduler would send a reminder on its next run. */
  reminderDue: boolean;
  /** No email and no phone: nothing can be sent at all. */
  unreachable: boolean;
};

@Injectable()
export class ActivityService {
  constructor(private readonly db: DbService) { }

  /**
   * One row per case that has any message, newest first - a workspace inbox.
   *
   * Inbound words and outbound requests live in two tables (the pollers keep
   * what a subject said; case_messages is the scheduler's own memory), so the
   * newest of each is taken and the later one wins. Merging at read time keeps
   * a single source for each and lets them never drift.
   */
  conversations(tenantId: string) {
    return this.db.withTenant(tenantId, async (tx) => {
      const [inbound, outbound, caseRows] = await Promise.all([
        tx
          .select({
            caseId: conversationMessages.caseId,
            channel: conversationMessages.channel,
            body: conversationMessages.body,
            sentAt: conversationMessages.sentAt,
          })
          .from(conversationMessages)
          .orderBy(desc(conversationMessages.sentAt)),
        tx
          .select({
            caseId: caseMessages.caseId,
            channel: caseMessages.channel,
            kind: caseMessages.kind,
            sentAt: caseMessages.sentAt,
          })
          .from(caseMessages)
          .where(eq(caseMessages.status, "sent"))
          .orderBy(desc(caseMessages.sentAt)),
        tx
          .select({
            id: cases.id,
            reference: cases.reference,
            subjectName: contacts.name,
            subjectOrganisation: contacts.organisation,
          })
          .from(cases)
          .leftJoin(contacts, eq(cases.contactId, contacts.id))
          .where(isNull(cases.deletedAt)),
      ]);

      const byCase = new Map<string, ConversationThread>();
      const caseInfo = new Map(caseRows.map((c) => [c.id, c]));

      const consider = (
        caseId: string,
        channel: "email" | "whatsapp",
        direction: "inbound" | "outbound",
        preview: string,
        at: Date,
      ) => {
        const info = caseInfo.get(caseId);
        if (!info) return; // case deleted out from under a message
        const existing = byCase.get(caseId);
        if (existing && existing.at >= at) {
          if (direction === "inbound") existing.inboundCount += 1;
          return;
        }
        byCase.set(caseId, {
          caseId,
          reference: info.reference,
          subjectName: info.subjectName,
          subjectOrganisation: info.subjectOrganisation,
          channel,
          direction,
          preview,
          at,
          inboundCount:
            (existing?.inboundCount ?? 0) + (direction === "inbound" ? 1 : 0),
        });
      };

      for (const m of inbound) {
        consider(m.caseId, m.channel, "inbound", m.body || "(no text)", m.sentAt);
      }
      for (const m of outbound) {
        const label =
          m.kind === "reminder" ? "Reminder sent" : m.kind === "initial" ? "Document request sent" : "Request sent";
        consider(m.caseId, m.channel, "outbound", label, m.sentAt);
      }

      return [...byCase.values()].sort((a, b) => b.at.getTime() - a.at.getTime());
    });
  }

  /**
   * Cases still owing documents, ordered by how long they have been waiting.
   *
   * Deliberately includes cases nothing has been sent for yet: "never asked"
   * is the most actionable row on the screen, and the one most easily lost.
   */
  followUps(tenantId: string): Promise<FollowUpRow[]> {
    return this.db.withTenant(tenantId, async (tx) => {
      const [caseRows, reqRows, docRows, msgRows] = await Promise.all([
        tx
          .select({
            id: cases.id,
            reference: cases.reference,
            data: cases.data,
            workflowId: cases.workflowId,
            workflowName: workflows.name,
            stageName: workflowStages.name,
            nudgesPausedAt: cases.nudgesPausedAt,
            subjectName: contacts.name,
            subjectOrganisation: contacts.organisation,
            subjectEmail: contacts.email,
            subjectPhone: contacts.phone,
          })
          .from(cases)
          .innerJoin(workflows, eq(cases.workflowId, workflows.id))
          .leftJoin(contacts, eq(cases.contactId, contacts.id))
          .leftJoin(workflowStages, eq(cases.stageId, workflowStages.id))
          .where(isNull(cases.deletedAt)),
        tx.select().from(documentRequirements),
        tx
          .select()
          .from(documents)
          .where(and(isNull(documents.deletedAt), sql`${documents.storageKey} is not null`)),
        tx
          .select({
            caseId: caseMessages.caseId,
            kind: caseMessages.kind,
            sentAt: caseMessages.sentAt,
          })
          .from(caseMessages)
          .where(eq(caseMessages.status, "sent")),
      ]);

      const out: FollowUpRow[] = [];
      for (const c of caseRows) {
        // The SAME rule the checklist and the Overview use. Three screens
        // disagreeing about whether a case is finished is how people stop
        // trusting all three.
        const applicable = reqRows
          .filter((r) => r.workflowId === c.workflowId)
          .filter((r) => requirementApplies(r.condition, c.data));
        const mine = docRows.filter((d) => d.caseId === c.id);
        const outstanding = applicable.filter((r) => {
          if (!r.required) return false;
          const status = rollUpStatus(mine.filter((d) => d.requirementId === r.id));
          return status === "missing" || status === "rejected" || status === "expired";
        }).length;
        if (outstanding === 0) continue; // nothing to chase

        const msgs = msgRows
          .filter((m) => m.caseId === c.id)
          .sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime());
        const remindersSent = msgs.filter((m) => m.kind === "reminder").length;
        const last = msgs[0]?.sentAt ?? null;
        const paused = c.nudgesPausedAt !== null;
        const reminderDue =
          !paused &&
          remindersSent < MAX_REMINDERS &&
          (!last || Date.now() - last.getTime() >= REMINDER_INTERVAL_MS);

        out.push({
          caseId: c.id,
          reference: c.reference,
          subjectName: c.subjectName,
          subjectOrganisation: c.subjectOrganisation,
          stageName: c.stageName,
          workflowName: c.workflowName,
          outstanding,
          requestsSent: msgs.length,
          remindersSent,
          lastRequestAt: last,
          daysSinceLastRequest: last
            ? Math.floor((Date.now() - last.getTime()) / (24 * 60 * 60 * 1000))
            : null,
          paused,
          reminderDue,
          unreachable: !c.subjectEmail && !c.subjectPhone,
        });
      }

      // Never-asked first (nulls), then longest-waiting. That is the order a
      // person would work the list in.
      return out.sort((a, b) => {
        if (a.lastRequestAt === null && b.lastRequestAt !== null) return -1;
        if (b.lastRequestAt === null && a.lastRequestAt !== null) return 1;
        if (a.lastRequestAt === null && b.lastRequestAt === null) return 0;
        return a.lastRequestAt!.getTime() - b.lastRequestAt!.getTime();
      });
    });
  }
}

@Controller()
@UseGuards(JwtAuthGuard)
export class ActivityController {
  constructor(private readonly activity: ActivityService) { }

  @Get("conversations")
  conversations(@CurrentUser() u: AuthUser) {
    return this.activity.conversations(u.tenantId);
  }

  @Get("follow-ups")
  followUps(@CurrentUser() u: AuthUser) {
    return this.activity.followUps(u.tenantId);
  }
}

@Module({ controllers: [ActivityController], providers: [ActivityService] })
export class ActivityModule { }
