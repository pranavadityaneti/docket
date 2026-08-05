import {
  caseEvents,
  cases,
  documentRequirements,
  documents,
  users,
  type DocumentStatus,
  type RequirementCondition,
} from "@docket/db";
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from "@nestjs/common";
import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from "class-validator";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { Request, Response } from "express";
import { CurrentUser, JwtAuthGuard, type AuthUser } from "../auth/auth";
import { env } from "../config/env";
import { DbService } from "../db/db";
import {
  LocalStorageDriver,
  STORAGE,
  StorageModule,
  documentKey,
  type StorageDriver,
} from "../storage/storage";

/**
 * Documents: what a case still needs, and what has arrived.
 *
 * The upload flow is deliberately two-step - ask for a target, PUT the bytes,
 * then confirm. A single-step "post the file to the API" would put every
 * borrower's 12 bank statements through the API process, and would leave no
 * way to move to presigned S3 uploads later without changing the client. The
 * confirm step is also what stops a row claiming a file that never landed.
 */

/**
 * Does a requirement apply to this case?
 *
 * A checklist that asks a sole proprietor for a Partnership Deed is a checklist
 * people learn to ignore, so requirements can be gated on the case's own data.
 * Comparison is on the STRING form of both sides: case data arrives as JSON
 * where "5" and 5 are different, and a condition that silently fails to match
 * would quietly drop a required document from the list.
 */
export function requirementApplies(
  condition: RequirementCondition | null | undefined,
  data: Record<string, unknown> | null,
): boolean {
  if (!condition) return true;
  const actual = data?.[condition.field];
  if (actual === undefined || actual === null) return false;
  const actualStr = String(actual);
  if (condition.equals !== undefined) return actualStr === String(condition.equals);
  if (condition.in) return condition.in.some((v) => String(v) === actualStr);
  // A condition naming neither `equals` nor `in` is malformed. Include the
  // requirement rather than drop it: over-asking is recoverable, silently
  // never asking for a mandatory document is not.
  return true;
}

/** Per-checklist-item state, derived from the documents received against it. */
export type ChecklistItemStatus =
  | "missing"
  | "received"
  | "needs_review"
  | "accepted"
  | "rejected"
  | "expired";

/**
 * Have this row's bytes actually reached storage?
 *
 * A document row is created BEFORE the upload, so a row on its own proves
 * nothing - it is a reservation. If the upload is abandoned (a dropped
 * connection, a closed tab, an expired ticket) the row survives with no file
 * behind it. Such a row is not a document and must not be treated as one:
 * counting it told a borrower's checklist that a file had arrived when nothing
 * had.
 */
export function hasLanded(doc: { storageKey: string | null }): boolean {
  return doc.storageKey !== null;
}

/**
 * Does this document occupy one of a requirement's `maxFiles` slots?
 *
 * This used to be "every row that exists", on the reasoning that a rejected
 * file still occupies a slot *until someone removes it*. There is no remove
 * action, so that reasoning never completed: rejecting the single permitted
 * copy of a document made the item permanently unfillable. Staff rejected a
 * blurry Aadhaar and then could not accept a clear one - the exact workflow the
 * product exists to run, deadlocked by its own validation.
 *
 * A slot is held by a file that is still a candidate:
 *   - accepted / received / needs_review → yes, it is the live copy
 *   - rejected  → no. It was refused; a replacement is the point.
 *   - expired   → no. It is out of date; a fresh one is required.
 *   - no bytes  → no. Nothing was ever uploaded.
 *
 * Note this is deliberately NOT the same question as rollUpStatus answers. A
 * rejected document must keep *showing* as rejected - that is the signal a
 * human acts on - while no longer *blocking* the replacement it is asking for.
 * Occupancy is about capacity; roll-up is about what to display.
 */
export function occupiesSlot(doc: {
  storageKey: string | null;
  status: DocumentStatus;
}): boolean {
  if (!hasLanded(doc)) return false;
  return doc.status !== "rejected" && doc.status !== "expired";
}

/**
 * Roll a requirement's documents up into one status.
 *
 * Order matters and is chosen so the worst actionable state wins: anything
 * accepted means done; otherwise something waiting on a human outranks
 * something merely received, and a rejection outranks nothing at all. The one
 * a human should act on is the one that surfaces.
 *
 * Takes whole documents, NOT bare statuses, deliberately: a reservation whose
 * bytes never landed still carries status "received", so a status-only
 * signature let every caller quietly report that a file had arrived when
 * nothing had - on the checklist AND on the Overview counts. Requiring
 * storageKey makes that mistake impossible to express.
 */
export function rollUpStatus(
  docs: Array<{ status: DocumentStatus; storageKey: string | null }>,
): ChecklistItemStatus {
  const docStatuses = docs.filter(hasLanded).map((d) => d.status);
  if (docStatuses.length === 0) return "missing";
  if (docStatuses.includes("accepted")) return "accepted";
  if (docStatuses.includes("needs_review")) return "needs_review";
  if (docStatuses.includes("received")) return "received";
  if (docStatuses.includes("expired")) return "expired";
  if (docStatuses.includes("rejected")) return "rejected";
  return "missing";
}

export class BeginUploadDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  fileName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  contentType?: string;

  /**
   * Which checklist item this satisfies. Omitted = unclassified, for a human
   * to place.
   *
   * Validated as a UUID, not merely a string: the column is uuid, so an empty
   * string or any malformed value would otherwise travel all the way to
   * Postgres and surface as a 500 "Internal server error" instead of a 400
   * telling the caller what they got wrong.
   */
  @IsOptional()
  @IsUUID()
  requirementId?: string;
}

export class ReviewDocumentDto {
  @IsIn(["accepted", "rejected", "needs_review"])
  status!: "accepted" | "rejected" | "needs_review";

  /** Required when rejecting - it is shown to staff AND used to compose the re-ask. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  rejectionReason?: string;
}

export class RemoveDocumentDto {
  /** Optional, but it is the whole audit value - prompted for in the UI. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

@Injectable()
export class DocumentsService {
  constructor(
    private readonly db: DbService,
    @Inject(STORAGE) private readonly storage: StorageDriver,
  ) { }

  /**
   * The core read: what this case still needs.
   *
   * Answers "what is missing from this borrower?" - the question the whole
   * product exists to close, and the one the AI will ask before composing a
   * nudge. Conditions are resolved against the case's own data here rather
   * than in the client, so the dashboard, the WhatsApp bot and the voice bot
   * can never disagree about what was asked for.
   */
  checklist(tenantId: string, caseId: string) {
    return this.db.withTenant(tenantId, async (tx) => {
      const [row] = await tx
        .select({ id: cases.id, workflowId: cases.workflowId, data: cases.data })
        .from(cases)
        .where(and(eq(cases.id, caseId), isNull(cases.deletedAt)))
        .limit(1);
      if (!row) throw new NotFoundException("Case not found");

      const reqs = await tx
        .select()
        .from(documentRequirements)
        .where(eq(documentRequirements.workflowId, row.workflowId))
        .orderBy(asc(documentRequirements.position));

      // Removed documents are gone from every staff-facing surface. The row
      // survives for audit; it is not a document any more.
      const docs = await tx
        .select()
        .from(documents)
        .where(and(eq(documents.caseId, caseId), isNull(documents.deletedAt)))
        .orderBy(asc(documents.receivedAt));

      const applicable = reqs.filter((r) => requirementApplies(r.condition, row.data));

      const items = applicable.map((r) => {
        const mine = docs.filter((d) => d.requirementId === r.id);
        // Whether another file may be added is decided HERE, by the same
        // predicate beginUpload enforces with. The client must not re-derive it
        // from documents.length: that is a second implementation of the rule,
        // and it would grey out the upload button on a rejected item that the
        // API would in fact accept - the deadlock reappearing in the UI only.
        const slotsUsed = mine.filter(occupiesSlot).length;
        return {
          requirementId: r.id,
          key: r.key,
          label: r.label,
          description: r.description,
          required: r.required,
          maxFiles: r.maxFiles,
          slotsUsed,
          canUpload: slotsUsed < r.maxFiles,
          reusable: r.reusable,
          validityDays: r.validityDays,
          status: rollUpStatus(mine),
          documents: mine.map((d) => ({
            id: d.id,
            fileName: d.fileName,
            mimeType: d.mimeType,
            status: d.status,
            rejectionReason: d.rejectionReason,
            sizeBytes: d.sizeBytes,
            sourceChannel: d.sourceChannel,
            receivedAt: d.receivedAt,
            uploaded: d.storageKey !== null,
            // Who put it here, and what the classifier read it as. Staff must
            // be able to see that a machine made this placement.
            autoFiled: d.autoFiled,
            classifiedType: d.classifiedType,
            classificationConfidence: d.classificationConfidence,
          })),
        };
      });

      // Files that arrived but match no requirement - a borrower sending
      // something unexpected, or the classifier declining to guess. Surfaced
      // separately so a human can place them; never silently dropped.
      //
      // A document the classifier recognised but was not confident enough to
      // file carries a SUGGESTION: the label rides along so the screen can
      // offer "looks like Aadhaar - confirm?" without a second lookup. The
      // suggestion is resolved against `applicable`, so a suggestion for a
      // requirement that no longer applies to this case simply does not
      // appear rather than offering staff a slot that is not on the checklist.
      const labelByRequirementId = new Map(applicable.map((r) => [r.id, r.label]));
      const unclassified = docs
        .filter((d) => d.requirementId === null)
        .map((d) => {
          const suggestedLabel = d.suggestedRequirementId
            ? (labelByRequirementId.get(d.suggestedRequirementId) ?? null)
            : null;
          return {
            id: d.id,
            fileName: d.fileName,
            mimeType: d.mimeType,
            status: d.status,
            sourceChannel: d.sourceChannel,
            receivedAt: d.receivedAt,
            uploaded: d.storageKey !== null,
            classifiedType: d.classifiedType,
            classificationConfidence: d.classificationConfidence,
            suggestedRequirementId: suggestedLabel ? d.suggestedRequirementId : null,
            suggestedLabel,
          };
        });

      const requiredItems = items.filter((i) => i.required);
      return {
        caseId,
        items,
        unclassified,
        summary: {
          required: requiredItems.length,
          accepted: requiredItems.filter((i) => i.status === "accepted").length,
          outstanding: requiredItems.filter(
            (i) => i.status === "missing" || i.status === "rejected" || i.status === "expired",
          ).length,
          awaitingReview: items.filter(
            (i) => i.status === "received" || i.status === "needs_review",
          ).length,
        },
      };
    });
  }

  /**
   * Refuse the caller if the requirement has no free slot left.
   *
   * Capacity used to be checked in exactly one place - beginUpload - and that
   * was sufficient only while "a row exists" meant "a slot is used". Now that
   * occupancy is a predicate that CHANGES over a document's life (a rejection
   * frees a slot, an upload completing takes one), a single up-front check is
   * no longer enough: the limit has to hold at every transition INTO occupancy,
   * or it can be walked around. Two ways it could be, both verified reachable:
   *
   *   - complete two uploads that were reserved before either finished, since
   *     neither reservation held a slot at the time it was created;
   *   - review a rejected document back to accepted after its replacement has
   *     already taken the slot.
   *
   * `excludeDocumentId` is the document being changed - it must not be counted
   * against itself.
   */
  // Public because assigning an unmatched arrival files a document too, and the
  // slot rule must have exactly one implementation (see the checklist comment).
  async assertSlotFree(
    tx: Parameters<Parameters<DbService["withTenant"]>[1]>[0],
    caseId: string,
    requirementId: string,
    excludeDocumentId: string | null,
  ) {
    const [req] = await tx
      .select({ maxFiles: documentRequirements.maxFiles, label: documentRequirements.label })
      .from(documentRequirements)
      .where(eq(documentRequirements.id, requirementId))
      .limit(1);
    if (!req) return;

    const rows = await tx
      .select({ id: documents.id, status: documents.status, storageKey: documents.storageKey })
      .from(documents)
      .where(
        and(
          eq(documents.caseId, caseId),
          eq(documents.requirementId, requirementId),
          // A removed document frees its slot - that is most of the point of
          // being able to remove one.
          isNull(documents.deletedAt),
        ),
      );

    const used = rows.filter((d) => d.id !== excludeDocumentId && occupiesSlot(d)).length;
    if (used >= req.maxFiles) {
      throw new BadRequestException(
        `"${req.label}" already has ${req.maxFiles} file${req.maxFiles === 1 ? "" : "s"}. ` +
        `Reject the existing one first if this should replace it.`,
      );
    }
  }

  /** Step 1: reserve a row and hand back somewhere to PUT the bytes. */
  beginUpload(tenantId: string, caseId: string, input: BeginUploadDto) {
    return this.db.withTenant(tenantId, async (tx) => {
      const [row] = await tx
        .select({ id: cases.id, workflowId: cases.workflowId })
        .from(cases)
        .where(and(eq(cases.id, caseId), isNull(cases.deletedAt)))
        .limit(1);
      if (!row) throw new NotFoundException("Case not found");

      if (input.requirementId) {
        // RLS scopes this to the tenant; the workflow match additionally stops a
        // document being filed against another workflow's checklist item.
        const [req] = await tx
          .select()
          .from(documentRequirements)
          .where(
            and(
              eq(documentRequirements.id, input.requirementId),
              eq(documentRequirements.workflowId, row.workflowId),
            ),
          )
          .limit(1);
        if (!req) throw new BadRequestException("Requirement does not belong to this case");

        // Fail fast, before the caller uploads bytes it cannot file. This is
        // early feedback, NOT the authoritative check - a reservation holds no
        // slot, so the binding check is the one in completeUpload().
        await this.assertSlotFree(tx, caseId, input.requirementId, null);
      }

      const [doc] = await tx
        .insert(documents)
        .values({
          tenantId,
          caseId,
          requirementId: input.requirementId ?? null,
          fileName: input.fileName,
          mimeType: input.contentType ?? null,
          status: "received",
          sourceChannel: "upload",
          // storageKey stays null until the upload is confirmed: a row without
          // one is a reservation, not a document.
        })
        .returning();

      const key = documentKey(tenantId, caseId, doc.id);
      const target = await this.storage.requestUpload(key, input.contentType);
      return { documentId: doc.id, upload: target };
    });
  }

  /** Step 2: the bytes are in storage - verify and record what actually landed. */
  completeUpload(tenantId: string, documentId: string) {
    return this.db.withTenant(tenantId, async (tx) => {
      const [doc] = await tx
        .select()
        .from(documents)
        .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)))
        .limit(1);
      // Also covers the removed case: an upload confirmed after its row was
      // removed must not write a storage key back onto it and resurrect a
      // document whose file was deliberately purged.
      if (!doc) throw new NotFoundException("Document not found");

      const key = documentKey(tenantId, doc.caseId, doc.id);
      // Trust storage, not the client: size and checksum come from the object
      // itself, so a client cannot claim a file it never uploaded or lie about
      // what it sent.
      const object = await this.storage.head(key);
      if (!object) throw new BadRequestException("No file was uploaded for this document");

      // The authoritative capacity check. A reservation holds no slot, so two
      // uploads can legitimately be in flight for a one-file requirement; the
      // first to land takes it and the second must be refused here rather than
      // silently pushing the item over its limit. The object is removed so a
      // refused upload does not leave bytes behind with nothing pointing at them.
      if (doc.requirementId) {
        try {
          await this.assertSlotFree(tx, doc.caseId, doc.requirementId, doc.id);
        } catch (err) {
          await this.storage.delete(key);
          throw err;
        }
      }
      if (object.sizeBytes > env.maxUploadBytes) {
        await this.storage.delete(key);
        throw new BadRequestException(
          `File exceeds the ${Math.floor(env.maxUploadBytes / 1024 / 1024)}MB limit`,
        );
      }

      const [updated] = await tx
        .update(documents)
        .set({
          storageKey: key,
          sizeBytes: object.sizeBytes,
          checksum: object.checksum,
        })
        .where(eq(documents.id, documentId))
        .returning();
      return updated;
    });
  }

  /**
   * Remove a document: purge the file, keep the record.
   *
   * The file is deleted first and the row updated second. If the purge fails
   * the whole thing fails and the document is untouched - the opposite order
   * could mark a document removed while its bytes are still sitting in storage,
   * which is precisely the outcome someone removing a misfiled KYC document is
   * trying to avoid. A crash between the two leaves an orphaned object with no
   * row pointing at it, which is recoverable; the reverse is not.
   *
   * storage_key is cleared because the object it names no longer exists. What
   * stays - file name, checksum, size - describes what the file was without
   * being the file.
   */
  remove(tenantId: string, userId: string, documentId: string, input: RemoveDocumentDto) {
    return this.db.withTenant(tenantId, async (tx) => {
      const [doc] = await tx
        .select({ id: documents.id, caseId: documents.caseId, storageKey: documents.storageKey })
        .from(documents)
        .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)))
        .limit(1);
      // Already removed reads as "not found" rather than succeeding quietly:
      // a second remove is a sign the caller believes something else is true.
      if (!doc) throw new NotFoundException("Document not found");

      if (doc.storageKey) {
        await this.storage.delete(doc.storageKey);
      }

      const [updated] = await tx
        .update(documents)
        .set({
          deletedAt: new Date(),
          deletedBy: userId,
          deletionReason: input.reason?.trim() || null,
          storageKey: null,
        })
        .where(eq(documents.id, documentId))
        .returning({ id: documents.id, caseId: documents.caseId });
      return updated;
    });
  }

  /** Staff review. The AI will drive this later; the human path exists first. */
  /**
   * Accept the classifier's suggestion: file the document onto the slot it
   * proposed. This is the human confirmation the auto-file path skips, so it
   * runs the SAME capacity check every other placement runs - a suggestion is
   * a proposal, never a licence to overflow an item.
   *
   * autoFiled stays false: a person made this placement, on advice. The audit
   * trail must not later claim the machine filed it.
   */
  confirmSuggestion(tenantId: string, documentId: string) {
    return this.db.withTenant(tenantId, async (tx) => {
      const [doc] = await tx
        .select({
          id: documents.id,
          caseId: documents.caseId,
          requirementId: documents.requirementId,
          suggestedRequirementId: documents.suggestedRequirementId,
          status: documents.status,
          storageKey: documents.storageKey,
        })
        .from(documents)
        .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)))
        .for("update")
        .limit(1);
      if (!doc) throw new NotFoundException("Document not found");
      if (doc.requirementId) {
        throw new BadRequestException("This document is already filed against a checklist item");
      }
      if (!doc.suggestedRequirementId) {
        throw new BadRequestException("There is no suggestion to confirm for this document");
      }

      // The suggestion must still belong to this case's workflow - a workflow
      // can be edited between the suggestion and the click.
      const [row] = await tx
        .select({ workflowId: cases.workflowId })
        .from(cases)
        .where(and(eq(cases.id, doc.caseId), isNull(cases.deletedAt)))
        .limit(1);
      if (!row) throw new NotFoundException("Case not found");
      const [req] = await tx
        .select({ id: documentRequirements.id })
        .from(documentRequirements)
        .where(
          and(
            eq(documentRequirements.id, doc.suggestedRequirementId),
            eq(documentRequirements.workflowId, row.workflowId),
          ),
        )
        .limit(1);
      if (!req) throw new BadRequestException("The suggested item no longer exists on this workflow");

      await this.assertSlotFree(tx, doc.caseId, doc.suggestedRequirementId, doc.id);

      const [updated] = await tx
        .update(documents)
        .set({ requirementId: doc.suggestedRequirementId, suggestedRequirementId: null })
        .where(eq(documents.id, documentId))
        .returning({ id: documents.id, requirementId: documents.requirementId });
      return updated;
    });
  }

  /**
   * Reject the classifier's suggestion. The document stays unfiled and the
   * proposal is cleared, so the queue does not keep offering a wrong answer.
   * What the classifier READ is deliberately kept (classifiedType) - that is
   * evidence about the document, not the discarded proposal.
   */
  dismissSuggestion(tenantId: string, documentId: string) {
    return this.db.withTenant(tenantId, async (tx) => {
      const [updated] = await tx
        .update(documents)
        .set({ suggestedRequirementId: null })
        .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)))
        .returning({ id: documents.id });
      if (!updated) throw new NotFoundException("Document not found");
      return updated;
    });
  }

  review(tenantId: string, userId: string, documentId: string, input: ReviewDocumentDto) {
    if (input.status === "rejected" && !input.rejectionReason?.trim()) {
      throw new BadRequestException("A reason is required when rejecting a document");
    }
    return this.db.withTenant(tenantId, async (tx) => {
      const [doc] = await tx
        .select({
          id: documents.id,
          caseId: documents.caseId,
          requirementId: documents.requirementId,
          status: documents.status,
          storageKey: documents.storageKey,
          fileName: documents.fileName,
        })
        .from(documents)
        .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)))
        .limit(1);
      if (!doc) throw new NotFoundException("Document not found");

      // Un-rejecting takes a slot back. If the replacement has already filled
      // it, this would push the item past maxFiles, so the same guard applies
      // here as on upload. Only this ONE transition needs it: rejecting never
      // adds occupancy, and accepting something already received does not
      // change it - so a plain review of a live file is untouched.
      const willOccupy = input.status !== "rejected" && hasLanded(doc);
      if (willOccupy && !occupiesSlot(doc) && doc.requirementId) {
        await this.assertSlotFree(tx, doc.caseId, doc.requirementId, doc.id);
      }

      // On acceptance, stamp the expiry from the requirement's validity window.
      // This is what later makes "reusable AND still valid" answerable without
      // re-deriving it: a document carries its own use-by date.
      let expiresAt: Date | null = null;
      if (input.status === "accepted" && doc.requirementId) {
        const [req] = await tx
          .select({ validityDays: documentRequirements.validityDays })
          .from(documentRequirements)
          .where(eq(documentRequirements.id, doc.requirementId))
          .limit(1);
        if (req?.validityDays) {
          expiresAt = new Date(Date.now() + req.validityDays * 24 * 60 * 60 * 1000);
        }
      }

      const [updated] = await tx
        .update(documents)
        .set({
          status: input.status,
          rejectionReason: input.status === "rejected" ? input.rejectionReason!.trim() : null,
          reviewedBy: userId,
          reviewedAt: new Date(),
          expiresAt,
        })
        .where(eq(documents.id, documentId))
        .returning();

      // The journal line - same transaction as the verdict, so the two can
      // never disagree. Pinned to the document's checklist item, which lets
      // the item's own history answer "why was this rejected?".
      await tx.insert(caseEvents).values({
        tenantId,
        caseId: doc.caseId,
        requirementId: doc.requirementId,
        kind: "document_reviewed",
        authorId: userId,
        authorName: await this.authorName(userId),
        data: {
          fileName: doc.fileName,
          status: input.status,
          reason: input.status === "rejected" ? input.rejectionReason!.trim() : null,
        },
      });
      return updated;
    });
  }

  /** The name history keeps - read via admin exactly as auth reads users. */
  private async authorName(userId: string): Promise<string> {
    const [u] = await this.db.admin
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return u?.name ?? "Unknown";
  }

  /**
   * Bytes for staff preview / download.
   *
   * Auth is the tenant boundary (RLS via withTenant); the storage key is never
   * taken from the client. A reserved row with no landed file is not previewable.
   */
  content(tenantId: string, documentId: string) {
    return this.db.withTenant(tenantId, async (tx) => {
      const [doc] = await tx
        .select({
          id: documents.id,
          fileName: documents.fileName,
          mimeType: documents.mimeType,
          storageKey: documents.storageKey,
        })
        .from(documents)
        .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)))
        .limit(1);
      if (!doc) throw new NotFoundException("Document not found");
      if (!doc.storageKey) {
        throw new BadRequestException("This document has no file to preview yet");
      }
      const body = await this.storage.get(doc.storageKey);
      return {
        body,
        fileName: doc.fileName,
        mimeType: doc.mimeType ?? "application/octet-stream",
      };
    });
  }
}

@Controller()
@UseGuards(JwtAuthGuard)
export class DocumentsController {
  constructor(private readonly docs: DocumentsService) { }

  @Get("cases/:id/checklist")
  checklist(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.docs.checklist(u.tenantId, id);
  }

  /**
   * Stream the file for in-app preview. `inline` so the browser can render PDFs
   * and images in a dialog rather than force-downloading every click.
   */
  @Get("documents/:id/content")
  async content(
    @CurrentUser() u: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { body, fileName, mimeType } = await this.docs.content(u.tenantId, id);
    // ASCII fallback + RFC 5987 filename* so unicode names (common on WhatsApp
    // captures) survive Content-Disposition without header injection.
    const safeAscii = fileName.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "");
    res.set({
      "Content-Type": mimeType,
      "Content-Length": String(body.byteLength),
      "Content-Disposition": `inline; filename="${safeAscii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "private, no-store",
    });
    return new StreamableFile(body);
  }

  @Post("cases/:id/documents")
  beginUpload(
    @CurrentUser() u: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: BeginUploadDto,
  ) {
    return this.docs.beginUpload(u.tenantId, id, body);
  }

  @Post("documents/:id/complete")
  complete(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.docs.completeUpload(u.tenantId, id);
  }

  @Delete("documents/:id")
  remove(
    @CurrentUser() u: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: RemoveDocumentDto,
  ) {
    return this.docs.remove(u.tenantId, u.userId, id, body);
  }

  @Patch("documents/:id")
  review(
    @CurrentUser() u: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: ReviewDocumentDto,
  ) {
    return this.docs.review(u.tenantId, u.userId, id, body);
  }

  @Post("documents/:id/suggestion/confirm")
  confirmSuggestion(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.docs.confirmSuggestion(u.tenantId, id);
  }

  @Post("documents/:id/suggestion/dismiss")
  dismissSuggestion(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.docs.dismissSuggestion(u.tenantId, id);
  }
}

/**
 * The local driver's upload endpoint.
 *
 * Deliberately NOT behind JwtAuthGuard: it stands in for a presigned S3 URL,
 * which is likewise unauthenticated and authorised solely by the signature.
 * Here the single-use, short-lived ticket in the path is that signature - it
 * names the key, so a caller cannot choose where the bytes land. Development
 * only; in production STORAGE_DRIVER=s3 and this route is never reached.
 */
@Controller("uploads")
export class LocalUploadController {
  constructor(private readonly local: LocalStorageDriver) { }

  // PUT, because that is the method LocalStorageDriver.requestUpload() hands
  // the client, and it is what a presigned S3 URL takes. This was @Post while
  // the driver advertised PUT, so any client that honoured the contract got a
  // 404 - invisible to a hand-written `curl -X POST`, and invisible to the S3
  // path, which uploads to Amazon and never reaches this route at all. Local
  // and production now exercise the same verb.
  @Put(":token")
  async upload(@Param("token") token: string, @Req() req: Request) {
    const ticket = this.local.redeemTicket(token);
    if (!ticket) throw new BadRequestException("Upload link is invalid or has expired");

    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of req) {
      total += (chunk as Buffer).byteLength;
      // Stop reading the moment the limit is passed rather than buffering the
      // whole body and checking afterwards.
      if (total > env.maxUploadBytes) {
        throw new BadRequestException(
          `File exceeds the ${Math.floor(env.maxUploadBytes / 1024 / 1024)}MB limit`,
        );
      }
      chunks.push(chunk as Buffer);
    }
    const object = await this.local.put(ticket.key, Buffer.concat(chunks));
    return { ok: true, sizeBytes: object.sizeBytes };
  }
}

@Module({
  // StorageModule provides the STORAGE token (and LocalStorageDriver, which the
  // upload route redeems tickets against). Nest resolves providers per module,
  // so without this import the driver is invisible here even though it is
  // registered on the app.
  imports: [StorageModule],
  controllers: [DocumentsController, LocalUploadController],
  providers: [DocumentsService],
  // Exported so the nudge feature can read the live checklist from the one place
  // that computes it - the dashboard and the document requests can never then
  // disagree about what a case still needs.
  exports: [DocumentsService],
})
export class DocumentsModule { }
