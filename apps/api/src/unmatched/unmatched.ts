import { cases, documentRequirements, documents, unmatchedDocuments } from "@docket/db";
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from "@nestjs/common";
import { IsOptional, IsString, IsUUID, MaxLength } from "class-validator";
import { and, desc, eq, isNull } from "drizzle-orm";
import { CurrentUser, JwtAuthGuard, type AuthUser } from "../auth/auth";
import { ClassifyApplier, ClassifyModule } from "../classify/classify";
import { DbService } from "../db/db";
import { DocumentsModule, DocumentsService } from "../documents/documents";

/**
 * Triage for inbound documents that matched no case - the human half of the
 * "never guess" rule. The intake held the bytes (see holdUnmatched in the
 * channels); this module is where a person routes them.
 *
 * Assigning INSERTS a real documents row pointing at the same storage object
 * (no byte copying, no nullable caseId on documents) and stamps this row with
 * the full resolution audit. Discarding flips status and keeps the object -
 * deleting bytes is a separate, deliberate act that nothing here performs.
 */

export class AssignUnmatchedDto {
  @IsUUID()
  caseId!: string;

  /** Checklist slot to file it under. Omitted = unclassified, placed later. */
  @IsOptional()
  @IsUUID()
  requirementId?: string;
}

export class DiscardUnmatchedDto {
  /** Why it was discarded - the audit value, prompted for in the UI. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

@Injectable()
export class UnmatchedService {
  constructor(
    private readonly db: DbService,
    private readonly documents: DocumentsService,
    private readonly classify: ClassifyApplier,
  ) { }

  /** The tenant's pending arrivals, newest first. */
  list(tenantId: string) {
    return this.db.withTenant(tenantId, (tx) =>
      tx
        .select({
          id: unmatchedDocuments.id,
          channel: unmatchedDocuments.channel,
          sender: unmatchedDocuments.sender,
          context: unmatchedDocuments.context,
          fileName: unmatchedDocuments.fileName,
          mimeType: unmatchedDocuments.mimeType,
          sizeBytes: unmatchedDocuments.sizeBytes,
          receivedAt: unmatchedDocuments.receivedAt,
        })
        .from(unmatchedDocuments)
        .where(
          and(
            eq(unmatchedDocuments.tenantId, tenantId),
            eq(unmatchedDocuments.status, "pending"),
          ),
        )
        .orderBy(desc(unmatchedDocuments.receivedAt)),
    );
  }

  /**
   * File a pending arrival onto a case, optionally onto a checklist slot.
   * One transaction; the row is locked FOR UPDATE so two staff clicking
   * simultaneously cannot both assign it - the second sees a conflict.
   */
  assign(tenantId: string, unmatchedId: string, userId: string, input: AssignUnmatchedDto) {
    return this.db.withTenant(tenantId, async (tx) => {
      const [row] = await tx
        .select()
        .from(unmatchedDocuments)
        .where(eq(unmatchedDocuments.id, unmatchedId))
        .for("update")
        .limit(1);
      if (!row) throw new NotFoundException("Unmatched document not found");
      if (row.status !== "pending") {
        throw new ConflictException(`Already ${row.status}`);
      }

      const [target] = await tx
        .select({ id: cases.id, workflowId: cases.workflowId })
        .from(cases)
        .where(and(eq(cases.id, input.caseId), isNull(cases.deletedAt)))
        .limit(1);
      if (!target) throw new NotFoundException("Case not found");

      if (input.requirementId) {
        // Same two checks beginUpload makes, in the same order: the requirement
        // must belong to this case's workflow, and the slot must have room -
        // via the ONE implementation of that rule (DocumentsService).
        const [req] = await tx
          .select({ id: documentRequirements.id })
          .from(documentRequirements)
          .where(
            and(
              eq(documentRequirements.id, input.requirementId),
              eq(documentRequirements.workflowId, target.workflowId),
            ),
          )
          .limit(1);
        if (!req) throw new BadRequestException("Requirement does not belong to this case");
        await this.documents.assertSlotFree(tx, target.id, input.requirementId, null);
      }

      const [doc] = await tx
        .insert(documents)
        .values({
          tenantId,
          caseId: target.id,
          requirementId: input.requirementId ?? null,
          fileName: row.fileName,
          mimeType: row.mimeType,
          status: "received",
          // Provenance survives the detour: the document still arrived by
          // email/WhatsApp from that sender, at its original time.
          sourceChannel: row.channel,
          sourceIdentifier: row.sender,
          storageKey: row.storageKey,
          sizeBytes: row.sizeBytes,
          checksum: row.checksum,
          receivedAt: row.receivedAt,
        })
        .returning();

      await tx
        .update(unmatchedDocuments)
        .set({
          status: "assigned",
          assignedCaseId: target.id,
          assignedDocumentId: doc.id,
          resolvedAt: new Date(),
          resolvedBy: userId,
        })
        .where(eq(unmatchedDocuments.id, row.id));

      return { documentId: doc.id, caseId: target.id };
    }).then((result) => {
      // Staff chose "no specific item": let the classifier propose one, after
      // the assignment has committed. An explicit slot choice is never
      // second-guessed - this runs only when they declined to pick.
      if (!input.requirementId) {
        void this.classify.process(tenantId, result.documentId).catch(() => { });
      }
      return result;
    });
  }

  /** Mark a pending arrival as not-ours/junk. The object stays, for audit. */
  discard(tenantId: string, unmatchedId: string, userId: string, input: DiscardUnmatchedDto) {
    return this.db.withTenant(tenantId, async (tx) => {
      const [row] = await tx
        .select({ id: unmatchedDocuments.id, status: unmatchedDocuments.status })
        .from(unmatchedDocuments)
        .where(eq(unmatchedDocuments.id, unmatchedId))
        .for("update")
        .limit(1);
      if (!row) throw new NotFoundException("Unmatched document not found");
      if (row.status !== "pending") {
        throw new ConflictException(`Already ${row.status}`);
      }

      const [updated] = await tx
        .update(unmatchedDocuments)
        .set({
          status: "discarded",
          discardReason: input.reason ?? null,
          resolvedAt: new Date(),
          resolvedBy: userId,
        })
        .where(eq(unmatchedDocuments.id, row.id))
        .returning({ id: unmatchedDocuments.id, status: unmatchedDocuments.status });
      return updated;
    });
  }
}

@Controller("unmatched")
@UseGuards(JwtAuthGuard)
export class UnmatchedController {
  constructor(private readonly unmatched: UnmatchedService) { }

  @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.unmatched.list(u.tenantId);
  }

  @Post(":id/assign")
  assign(
    @CurrentUser() u: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: AssignUnmatchedDto,
  ) {
    return this.unmatched.assign(u.tenantId, id, u.userId, body);
  }

  @Post(":id/discard")
  discard(
    @CurrentUser() u: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: DiscardUnmatchedDto,
  ) {
    return this.unmatched.discard(u.tenantId, id, u.userId, body);
  }
}

@Module({
  imports: [DocumentsModule, ClassifyModule],
  controllers: [UnmatchedController],
  providers: [UnmatchedService],
})
export class UnmatchedModule { }
