import {
  cases,
  contacts,
  documentRequirements,
  documents,
  workflowStages,
} from "@docket/db";
import { Controller, Get, Injectable, Module, UseGuards } from "@nestjs/common";
import { asc, desc, eq, isNull } from "drizzle-orm";
import { CurrentUser, JwtAuthGuard, type AuthUser } from "../auth/auth";
import { DbService } from "../db/db";
import { requirementApplies, rollUpStatus } from "../documents/documents";

/**
 * The numbers behind the Overview screen.
 *
 * This exists because the screen had none. It shipped with "342 leads in
 * flight", "68% docs auto-cleared" and six invented borrowers, on a workspace
 * holding four cases - a landing page that reported a business that was not
 * happening. A dashboard nobody can trust is worse than no dashboard, because
 * the first time someone acts on it they learn the whole screen is decoration.
 *
 * Every count here is derived from rows. Anything that cannot be derived - call
 * volumes, emails sent, documents cleared by an AI - is absent rather than
 * estimated, because none of those things exist yet.
 *
 * Per-case state is computed with requirementApplies() and rollUpStatus(), the
 * same functions that answer the checklist. The Overview and a case must never
 * disagree about whether that case is finished.
 */

/** One case that wants a human, with the reason it does. */
export type AttentionItem = {
  caseId: string;
  reference: string;
  subjectName: string | null;
  subjectOrganisation: string | null;
  stageName: string | null;
  /** Required items with nothing usable against them yet. */
  outstanding: number;
  /** Documents that have arrived and are waiting on a decision. */
  awaitingReview: number;
  updatedAt: Date;
};

@Injectable()
export class OverviewService {
  constructor(private readonly db: DbService) { }

  overview(tenantId: string) {
    return this.db.withTenant(tenantId, async (tx) => {
      // Three reads, then the per-case arithmetic in memory. The alternative -
      // expressing it in SQL - would mean re-implementing requirementApplies()
      // as a JSONB predicate, which is a second copy of the rule that decides
      // what a subject is asked for. One wrong answer there is a document
      // nobody ever chases.
      //
      // This loads the tenant's open cases and their documents. Fine at present
      // scale and honest about being O(cases); if a workspace ever grows past
      // what one request should carry, the answer is a summary table maintained
      // on write, not a cleverer query here.
      const rows = await tx
        .select({
          id: cases.id,
          reference: cases.reference,
          data: cases.data,
          workflowId: cases.workflowId,
          updatedAt: cases.updatedAt,
          subjectName: contacts.name,
          subjectOrganisation: contacts.organisation,
          stageName: workflowStages.name,
        })
        .from(cases)
        .leftJoin(contacts, eq(cases.contactId, contacts.id))
        .leftJoin(workflowStages, eq(cases.stageId, workflowStages.id))
        .where(isNull(cases.deletedAt))
        .orderBy(desc(cases.updatedAt));

      const reqs = await tx
        .select()
        .from(documentRequirements)
        .orderBy(asc(documentRequirements.position));

      const docs = await tx
        .select({
          caseId: documents.caseId,
          requirementId: documents.requirementId,
          status: documents.status,
          sourceChannel: documents.sourceChannel,
          // Required by rollUpStatus: without it an abandoned upload (a row
          // with no bytes behind it) counted as "awaiting review" and inflated
          // the dashboard with work that does not exist.
          storageKey: documents.storageKey,
        })
        .from(documents)
        .where(isNull(documents.deletedAt));

      const reqsByWorkflow = new Map<string, typeof reqs>();
      for (const r of reqs) {
        const list = reqsByWorkflow.get(r.workflowId) ?? [];
        list.push(r);
        reqsByWorkflow.set(r.workflowId, list);
      }
      const docsByCase = new Map<string, typeof docs>();
      for (const d of docs) {
        const list = docsByCase.get(d.caseId) ?? [];
        list.push(d);
        docsByCase.set(d.caseId, list);
      }

      // Counted over live documents only; a removed one never arrived as far
      // as anyone is concerned.
      const bySource: Record<string, number> = {};
      for (const d of docs) {
        const channel = d.sourceChannel ?? "unknown";
        bySource[channel] = (bySource[channel] ?? 0) + 1;
      }

      const attention: AttentionItem[] = [];
      let complete = 0;
      let awaitingReviewTotal = 0;
      let outstandingTotal = 0;

      for (const c of rows) {
        const applicable = (reqsByWorkflow.get(c.workflowId) ?? []).filter((r) =>
          requirementApplies(r.condition, c.data),
        );
        const mine = docsByCase.get(c.id) ?? [];

        let outstanding = 0;
        let awaitingReview = 0;
        for (const r of applicable) {
          const status = rollUpStatus(mine.filter((d) => d.requirementId === r.id));
          if (status === "received" || status === "needs_review") awaitingReview++;
          // Only REQUIRED items count as outstanding. An optional document
          // nobody sent is not a case sitting still.
          if (r.required && (status === "missing" || status === "rejected" || status === "expired")) {
            outstanding++;
          }
        }

        awaitingReviewTotal += awaitingReview;
        outstandingTotal += outstanding;

        // A case with required items still open, or files waiting on a
        // decision, is one a human can do something about. Everything else is
        // either finished or waiting on the subject with nothing to action.
        if (outstanding > 0 || awaitingReview > 0) {
          attention.push({
            caseId: c.id,
            reference: c.reference,
            subjectName: c.subjectName,
            subjectOrganisation: c.subjectOrganisation,
            stageName: c.stageName,
            outstanding,
            awaitingReview,
            updatedAt: c.updatedAt,
          });
        } else if (applicable.some((r) => r.required)) {
          // "Complete" means a checklist existed and is satisfied. A workflow
          // with no required documents has not completed anything.
          complete++;
        }
      }

      // Files waiting on a decision first, then longest untouched: the two
      // things that actually make a case urgent.
      attention.sort(
        (a, b) =>
          b.awaitingReview - a.awaitingReview ||
          a.updatedAt.getTime() - b.updatedAt.getTime(),
      );

      return {
        totals: {
          cases: rows.length,
          casesNeedingAttention: attention.length,
          casesComplete: complete,
          documentsAwaitingReview: awaitingReviewTotal,
          documentsOutstanding: outstandingTotal,
        },
        attention: attention.slice(0, 8),
        /*
         * How documents are actually reaching us.
         *
         * The product's premise is a dedicated WhatsApp number and mailbox per
         * tenant, but nothing ingests from either yet, so in practice every
         * document here was uploaded by hand. Rather than assert that - a
         * hardcoded `false` would be one more claim to go stale - the counts
         * are reported per channel and the screen draws its own conclusion.
         * The day a document arrives by WhatsApp, this changes on its own.
         */
        intake: bySource,
      };
    });
  }
}

@Controller("overview")
@UseGuards(JwtAuthGuard)
export class OverviewController {
  constructor(private readonly overview: OverviewService) { }

  @Get()
  get(@CurrentUser() u: AuthUser) {
    return this.overview.overview(u.tenantId);
  }
}

@Module({ controllers: [OverviewController], providers: [OverviewService] })
export class OverviewModule { }
