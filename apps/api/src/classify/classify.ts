import { cases, documentRequirements, documents } from "@docket/db";
import {
  Controller,
  Inject,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from "@nestjs/common";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import { and, asc, eq, isNotNull, isNull, ne } from "drizzle-orm";
import { CurrentUser, JwtAuthGuard, type AuthUser } from "../auth/auth";
import { DbService } from "../db/db";
import { DocumentsModule, DocumentsService, requirementApplies } from "../documents/documents";
import { STORAGE, StorageModule, type StorageDriver } from "../storage/storage";
import {
  clampText,
  MAX_CLASSIFY_BYTES,
  MAX_RASTER_PAGES,
  MAX_RASTER_PIXELS,
  MIN_PDF_TEXT_CHARS,
  rasterScaleFor,
  routeForMime,
} from "./classify-helpers";
import {
  classifyImageBytes,
  classifyPdfText,
  MODEL_VERSION,
  type LocalMlResult,
} from "./local-ml";

export {
  clampText,
  MAX_CLASSIFY_BYTES, MAX_RASTER_PAGES,
  MAX_RASTER_PIXELS, MAX_TEXT_CHARS,
  MIN_PDF_TEXT_CHARS, rasterScaleFor,
  routeForMime,
  type InputRoute
} from "./classify-helpers";

/**
 * Local-ML document classification — "which checklist item is this file?"
 *
 * NO cloud generative AI. NO filenames. Images / scanned PDFs run through a
 * trained EfficientNet ONNX model (local weights under models/onnx/). Typed
 * PDFs with a real text layer use local ontology keyword/IDF scoring on the
 * extracted text. Ontology labels map onto the case checklist; high confidence
 * auto-files; anything unidentified stays in Unmatched files.
 */

/* ------------------------------- types ------------------------------- */

export interface ClassifyOption {
  key: string;
  label: string;
  description: string | null;
}

/** `fileName` is for operator logs ONLY — never fed to the local models. */
export interface ClassifyRequest {
  storageKey: string;
  fileName: string;
  mimeType: string | null;
  options: ClassifyOption[];
}

export type ClassifyOutcome =
  | {
    outcome: "classified";
    requirementKey: string | null;
    confidence: "high" | "medium" | "low";
    documentType: string;
    reasoning: string;
  }
  | { outcome: "skipped"; reason: string }
  | { outcome: "error"; reason: string };

function toOutcome(result: LocalMlResult): ClassifyOutcome {
  if (result.band === "unknown") {
    return {
      outcome: "classified",
      requirementKey: null,
      confidence: "low",
      documentType: result.documentType,
      reasoning: result.reasons.join("; "),
    };
  }
  return {
    outcome: "classified",
    requirementKey: result.slotId,
    confidence: result.band,
    documentType: result.documentType,
    reasoning: result.reasons.join("; "),
  };
}

/* ------------------------------- the service ------------------------------- */

@Injectable()
export class ClassifyService {
  private readonly log = new Logger(ClassifyService.name);

  constructor(@Inject(STORAGE) private readonly storage: StorageDriver) { }

  /** Always on — local models, no API key. */
  enabled(): boolean {
    return true;
  }

  /**
   * Classify one stored document against one case's checklist. Never throws.
   * Filename is accepted only for logs and is never passed to models.
   */
  async classify(req: ClassifyRequest): Promise<ClassifyOutcome> {
    if (req.options.length === 0) {
      return { outcome: "skipped", reason: "checklist has no items" };
    }

    const route = routeForMime(req.mimeType);
    if (route.route === "unsupported") {
      return { outcome: "skipped", reason: route.reason };
    }

    let bytes: Buffer;
    try {
      bytes = await this.storage.get(req.storageKey);
    } catch (e) {
      return { outcome: "error", reason: `could not read stored object: ${msg(e)}` };
    }
    if (bytes.length === 0) return { outcome: "skipped", reason: "stored object is empty" };
    if (bytes.length > MAX_CLASSIFY_BYTES) {
      return { outcome: "skipped", reason: "file exceeds classification size limit" };
    }

    const slots = req.options.map((o) => ({
      id: o.key,
      title: o.label,
      description: o.description,
      aliases: [] as string[],
    }));

    try {
      let result: LocalMlResult;

      if (route.route === "image") {
        const mime = (req.mimeType ?? "image/jpeg").split(";")[0].trim();
        result = await classifyImageBytes(bytes, mime, slots);
      } else {
        const text = await this.extractPdfText(bytes);
        if (text !== null) {
          result = await classifyPdfText(text, slots);
        } else {
          // Scanned PDF: rasterise pages and CLIP the first readable page.
          const pages = await this.rasterisePdfPages(bytes);
          if (pages === null || pages.length === 0) {
            return {
              outcome: "skipped",
              reason: "PDF has no text layer and could not be rendered",
            };
          }
          result = await classifyImageBytes(pages[0], "image/png", slots);
        }
      }

      this.log.log(
        `Classified ${req.fileName}: ${result.documentType} -> ${result.slotId ?? "(unmatched)"} [${result.band}] (${MODEL_VERSION})`,
      );
      return toOutcome(result);
    } catch (e) {
      return { outcome: "error", reason: `local ML classify failed: ${msg(e)}` };
    }
  }

  private async extractPdfText(bytes: Buffer): Promise<string | null> {
    try {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      const { text } = await extractText(pdf, { mergePages: false });
      const firstPages = (Array.isArray(text) ? text.slice(0, 2) : [String(text)]).join("\n");
      const clamped = clampText(firstPages);
      return clamped.length >= MIN_PDF_TEXT_CHARS ? clamped : null;
    } catch (e) {
      this.log.warn(`PDF text extraction failed: ${msg(e)}`);
      return null;
    }
  }

  private async rasterisePdfPages(bytes: Buffer): Promise<Buffer[] | null> {
    try {
      const { getDocumentProxy, renderPageAsImage } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      const pageCount = Math.min(pdf.numPages, MAX_RASTER_PAGES);
      const images: Buffer[] = [];
      let total = 0;
      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
        try {
          const page = await pdf.getPage(pageNumber);
          const { width, height } = page.getViewport({ scale: 1 });
          const png = await renderPageAsImage(new Uint8Array(bytes), pageNumber, {
            canvasImport: () => import("@napi-rs/canvas"),
            scale: rasterScaleFor(width, height),
          });
          const buf = Buffer.from(new Uint8Array(png));
          total += buf.length;
          if (total > MAX_CLASSIFY_BYTES) break;
          images.push(buf);
        } catch (e) {
          this.log.warn(`PDF page ${pageNumber} rasterisation failed: ${msg(e)}`);
        }
      }
      return images.length > 0 ? images : null;
    } catch (e) {
      this.log.warn(`PDF rasterisation failed: ${msg(e)}`);
      return null;
    }
  }
}

/* ------------------------------- the applier ------------------------------- */

/**
 * Applies local-ML outcomes:
 *   high → auto-file (or suggestion if slot full);
 *   medium/low → suggestion;
 *   no slot / abstain → stays Unmatched (requirementId null).
 */
@Injectable()
export class ClassifyApplier {
  private readonly log = new Logger(ClassifyApplier.name);

  constructor(
    private readonly db: DbService,
    private readonly classifier: ClassifyService,
    private readonly documents: DocumentsService,
  ) { }

  async process(tenantId: string, documentId: string): Promise<void> {
    if (!this.classifier.enabled()) return;
    try {
      await this.run(tenantId, documentId);
    } catch (e) {
      this.log.error(`Classification of ${documentId} failed: ${msg(e)}`);
    }
  }

  private async run(tenantId: string, documentId: string): Promise<void> {
    const ctx = await this.db.withTenant(tenantId, async (tx) => {
      const [doc] = await tx
        .update(documents)
        .set({ classifiedAt: new Date() })
        .where(
          and(
            eq(documents.id, documentId),
            isNull(documents.classifiedAt),
            isNull(documents.requirementId),
            isNull(documents.deletedAt),
            isNotNull(documents.storageKey),
          ),
        )
        .returning({
          id: documents.id,
          caseId: documents.caseId,
          fileName: documents.fileName,
          mimeType: documents.mimeType,
          storageKey: documents.storageKey,
        });
      if (!doc) return null;

      const [c] = await tx
        .select({ id: cases.id, workflowId: cases.workflowId, data: cases.data })
        .from(cases)
        .where(and(eq(cases.id, doc.caseId), isNull(cases.deletedAt)))
        .limit(1);
      if (!c) return null;

      const reqs = await tx
        .select()
        .from(documentRequirements)
        .where(eq(documentRequirements.workflowId, c.workflowId))
        .orderBy(asc(documentRequirements.position));
      const options = reqs
        .filter((r) => requirementApplies(r.condition, c.data))
        .map((r) => ({ key: r.key, label: r.label, description: r.description, id: r.id }));
      return { doc, caseId: c.id, options };
    });
    if (!ctx) return;

    const result = await this.classifier.classify({
      storageKey: ctx.doc.storageKey!,
      fileName: ctx.doc.fileName,
      mimeType: ctx.doc.mimeType,
      options: ctx.options.map(({ key, label, description }) => ({ key, label, description })),
    });
    if (result.outcome !== "classified") {
      if (result.outcome === "error") this.log.warn(`${ctx.doc.fileName}: ${result.reason}`);
      return;
    }

    const matched = result.requirementKey
      ? (ctx.options.find((o) => o.key === result.requirementKey) ?? null)
      : null;

    await this.db.withTenant(tenantId, async (tx) => {
      const [fresh] = await tx
        .select({
          id: documents.id,
          requirementId: documents.requirementId,
          deletedAt: documents.deletedAt,
          status: documents.status,
        })
        .from(documents)
        .where(eq(documents.id, documentId))
        .for("update")
        .limit(1);
      if (!fresh || fresh.deletedAt || fresh.requirementId) return;

      const stamp = {
        classifiedType: result.documentType,
        classificationConfidence: result.confidence,
      };

      if (fresh.status === "rejected") {
        await tx.update(documents).set(stamp).where(eq(documents.id, documentId));
        this.log.log(`${ctx.doc.fileName}: rejected by staff - reading recorded, not filed`);
        return;
      }

      if (matched && result.confidence === "high") {
        // high ⇒ calibratedProb ≥ 0.89 — only then auto-file onto the checklist.
        try {
          await this.documents.assertSlotFree(tx, ctx.caseId, matched.id, null);
        } catch {
          await tx
            .update(documents)
            .set({ ...stamp, suggestedRequirementId: matched.id })
            .where(eq(documents.id, documentId));
          this.log.log(`${ctx.doc.fileName}: slot "${matched.key}" full - left as suggestion`);
          return;
        }
        await tx
          .update(documents)
          .set({ ...stamp, requirementId: matched.id, autoFiled: true })
          .where(eq(documents.id, documentId));
        this.log.log(`${ctx.doc.fileName}: auto-filed as "${matched.key}" (${result.documentType})`);
        return;
      }

      // No high-confidence slot → Unmatched (or suggestion for medium/low).
      await tx
        .update(documents)
        .set({ ...stamp, suggestedRequirementId: matched?.id ?? null })
        .where(eq(documents.id, documentId));
      this.log.log(
        `${ctx.doc.fileName}: ${matched ? `suggested "${matched.key}"` : "unmatched"} [${result.confidence}]`,
      );
    });
  }

  async processCase(tenantId: string, caseId: string): Promise<void> {
    if (!this.classifier.enabled()) return;
    try {
      const ids = await this.db.withTenant(tenantId, (tx) =>
        tx
          .select({ id: documents.id })
          .from(documents)
          .where(
            and(
              eq(documents.caseId, caseId),
              isNull(documents.requirementId),
              isNull(documents.deletedAt),
              isNull(documents.classifiedAt),
            ),
          ),
      );
      for (const { id } of ids) await this.process(tenantId, id);
    } catch (e) {
      this.log.error(`Case classification sweep failed: ${msg(e)}`);
    }
  }

  async reclassify(tenantId: string, documentId: string): Promise<{ id: string }> {
    const [doc] = await this.db.withTenant(tenantId, (tx) =>
      tx
        .update(documents)
        .set({
          classifiedAt: null,
          suggestedRequirementId: null,
          classifiedType: null,
          classificationConfidence: null,
        })
        .where(
          and(
            eq(documents.id, documentId),
            isNull(documents.requirementId),
            isNull(documents.deletedAt),
            isNotNull(documents.storageKey),
            ne(documents.status, "rejected"),
          ),
        )
        .returning({ id: documents.id }),
    );
    if (!doc) {
      throw new NotFoundException(
        "Document not found, already filed against a checklist item, rejected, or has no stored file",
      );
    }
    await this.process(tenantId, documentId);
    return { id: doc.id };
  }
}

@UseGuards(JwtAuthGuard, ThrottlerGuard)
@Controller()
export class ClassifyController {
  constructor(private readonly applier: ClassifyApplier) { }

  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post("documents/:id/reclassify")
  reclassify(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.applier.reclassify(u.tenantId, id);
  }
}

function msg(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const parts = [e.message];
  let cause: unknown = (e as { cause?: unknown }).cause;
  for (let depth = 0; cause instanceof Error && depth < 3; depth++) {
    const code = (cause as { code?: string }).code;
    parts.push(`caused by: ${cause.message}${code ? ` (${code})` : ""}`);
    cause = (cause as { cause?: unknown }).cause;
  }
  return parts.join(" | ");
}

@Module({
  imports: [StorageModule, DocumentsModule],
  controllers: [ClassifyController],
  providers: [ClassifyService, ClassifyApplier],
  exports: [ClassifyService, ClassifyApplier],
})
export class ClassifyModule { }
