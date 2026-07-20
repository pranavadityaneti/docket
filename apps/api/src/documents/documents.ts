import {
  BadRequestException,
  Body,
  Controller,
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
  UseGuards,
} from "@nestjs/common";
import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from "class-validator";
import { and, asc, eq } from "drizzle-orm";
import type { Request } from "express";
import {
  cases,
  documentRequirements,
  documents,
  type DocumentStatus,
  type RequirementCondition,
} from "@docket/db";
import { DbService } from "../db/db";
import { CurrentUser, JwtAuthGuard, type AuthUser } from "../auth/auth";
import {
  LocalStorageDriver,
  STORAGE,
  StorageModule,
  documentKey,
  type StorageDriver,
} from "../storage/storage";
import { env } from "../config/env";

/**
 * Documents: what a case still needs, and what has arrived.
 *
 * The upload flow is deliberately two-step — ask for a target, PUT the bytes,
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
 * Roll a requirement's documents up into one status.
 *
 * Order matters and is chosen so the worst actionable state wins: anything
 * accepted means done; otherwise something waiting on a human outranks
 * something merely received, and a rejection outranks nothing at all. The one
 * a human should act on is the one that surfaces.
 */
export function rollUpStatus(docStatuses: DocumentStatus[]): ChecklistItemStatus {
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

  /** Required when rejecting — it is shown to staff AND used to compose the re-ask. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  rejectionReason?: string;
}

@Injectable()
export class DocumentsService {
  constructor(
    private readonly db: DbService,
    @Inject(STORAGE) private readonly storage: StorageDriver,
  ) {}

  /**
   * The core read: what this case still needs.
   *
   * Answers "what is missing from this borrower?" — the question the whole
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
        .where(eq(cases.id, caseId))
        .limit(1);
      if (!row) throw new NotFoundException("Case not found");

      const reqs = await tx
        .select()
        .from(documentRequirements)
        .where(eq(documentRequirements.workflowId, row.workflowId))
        .orderBy(asc(documentRequirements.position));

      const docs = await tx
        .select()
        .from(documents)
        .where(eq(documents.caseId, caseId))
        .orderBy(asc(documents.receivedAt));

      const applicable = reqs.filter((r) => requirementApplies(r.condition, row.data));

      const items = applicable.map((r) => {
        const mine = docs.filter((d) => d.requirementId === r.id);
        return {
          requirementId: r.id,
          key: r.key,
          label: r.label,
          description: r.description,
          required: r.required,
          maxFiles: r.maxFiles,
          reusable: r.reusable,
          validityDays: r.validityDays,
          status: rollUpStatus(mine.map((d) => d.status)),
          documents: mine.map((d) => ({
            id: d.id,
            fileName: d.fileName,
            status: d.status,
            rejectionReason: d.rejectionReason,
            sizeBytes: d.sizeBytes,
            sourceChannel: d.sourceChannel,
            receivedAt: d.receivedAt,
            uploaded: d.storageKey !== null,
          })),
        };
      });

      // Files that arrived but match no requirement — a borrower sending
      // something unexpected, or the classifier declining to guess. Surfaced
      // separately so a human can place them; never silently dropped.
      const unclassified = docs
        .filter((d) => d.requirementId === null)
        .map((d) => ({
          id: d.id,
          fileName: d.fileName,
          status: d.status,
          sourceChannel: d.sourceChannel,
          receivedAt: d.receivedAt,
        }));

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

  /** Step 1: reserve a row and hand back somewhere to PUT the bytes. */
  beginUpload(tenantId: string, caseId: string, input: BeginUploadDto) {
    return this.db.withTenant(tenantId, async (tx) => {
      const [row] = await tx
        .select({ id: cases.id, workflowId: cases.workflowId })
        .from(cases)
        .where(eq(cases.id, caseId))
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

        // maxFiles counts what is actually there — a rejected file still
        // occupies a slot until someone removes it, which is the honest
        // reading of "how many files are attached to this item".
        const existing = await tx
          .select({ id: documents.id })
          .from(documents)
          .where(
            and(eq(documents.caseId, caseId), eq(documents.requirementId, input.requirementId)),
          );
        if (existing.length >= req.maxFiles) {
          throw new BadRequestException(
            `"${req.label}" accepts at most ${req.maxFiles} file${req.maxFiles === 1 ? "" : "s"}`,
          );
        }
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

  /** Step 2: the bytes are in storage — verify and record what actually landed. */
  completeUpload(tenantId: string, documentId: string) {
    return this.db.withTenant(tenantId, async (tx) => {
      const [doc] = await tx
        .select()
        .from(documents)
        .where(eq(documents.id, documentId))
        .limit(1);
      if (!doc) throw new NotFoundException("Document not found");

      const key = documentKey(tenantId, doc.caseId, doc.id);
      // Trust storage, not the client: size and checksum come from the object
      // itself, so a client cannot claim a file it never uploaded or lie about
      // what it sent.
      const object = await this.storage.head(key);
      if (!object) throw new BadRequestException("No file was uploaded for this document");
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

  /** Staff review. The AI will drive this later; the human path exists first. */
  review(tenantId: string, userId: string, documentId: string, input: ReviewDocumentDto) {
    if (input.status === "rejected" && !input.rejectionReason?.trim()) {
      throw new BadRequestException("A reason is required when rejecting a document");
    }
    return this.db.withTenant(tenantId, async (tx) => {
      const [doc] = await tx
        .select({ id: documents.id, requirementId: documents.requirementId })
        .from(documents)
        .where(eq(documents.id, documentId))
        .limit(1);
      if (!doc) throw new NotFoundException("Document not found");

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
      return updated;
    });
  }
}

@Controller()
@UseGuards(JwtAuthGuard)
export class DocumentsController {
  constructor(private readonly docs: DocumentsService) {}

  @Get("cases/:id/checklist")
  checklist(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.docs.checklist(u.tenantId, id);
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

  @Patch("documents/:id")
  review(
    @CurrentUser() u: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: ReviewDocumentDto,
  ) {
    return this.docs.review(u.tenantId, u.userId, id, body);
  }
}

/**
 * The local driver's upload endpoint.
 *
 * Deliberately NOT behind JwtAuthGuard: it stands in for a presigned S3 URL,
 * which is likewise unauthenticated and authorised solely by the signature.
 * Here the single-use, short-lived ticket in the path is that signature — it
 * names the key, so a caller cannot choose where the bytes land. Development
 * only; in production STORAGE_DRIVER=s3 and this route is never reached.
 */
@Controller("uploads")
export class LocalUploadController {
  constructor(private readonly local: LocalStorageDriver) {}

  // PUT, because that is the method LocalStorageDriver.requestUpload() hands
  // the client, and it is what a presigned S3 URL takes. This was @Post while
  // the driver advertised PUT, so any client that honoured the contract got a
  // 404 — invisible to a hand-written `curl -X POST`, and invisible to the S3
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
})
export class DocumentsModule {}
