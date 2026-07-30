import { Inject, Injectable, Logger, Module } from "@nestjs/common";
import OpenAI from "openai";
import { STORAGE, StorageModule, type StorageDriver } from "../storage/storage";
import { env } from "../config/env";

/**
 * AI document classification — "which checklist item is this file?"
 *
 * A subject sends a phone photo named IMG_4821.jpg over WhatsApp; the filename
 * carries nothing. This module reads the document itself and picks the
 * checklist slot it satisfies, choosing from a CLOSED list — the case's actual
 * requirements — so it can never invent a bucket. "None of these" is always a
 * valid answer, and anything the model is not highly confident about is left
 * for a human. The intake's "never guess" rule survives; the guessing is merely
 * done by something that has read the document, with a human still owning
 * everything below high confidence.
 *
 * Input handling is tiered by what the file IS (see prepareInput):
 *   photo        -> the vision model reads it directly (it is better OCR than
 *                   OCR, especially on skewed bilingual phone photos);
 *   native PDF   -> the embedded text layer is extracted locally — free, exact,
 *                   and the document image itself never leaves the box;
 *   scanned PDF  -> not classified in this tier (no text layer, needs real
 *                   OCR); deliberately left for the Textract follow-up rather
 *                   than half-done here.
 *
 * Fail-soft everywhere: no key configured, an API error, an unsupported type,
 * an oversized file — every one returns a non-answer and the document stays
 * exactly where it would have been without this module.
 */

/* ------------------------------- types ------------------------------- */

/** One checklist option the model may choose. */
export interface ClassifyOption {
  key: string;
  label: string;
  description: string | null;
}

/** What the caller hands us: the stored file plus the case's checklist. */
export interface ClassifyRequest {
  storageKey: string;
  fileName: string;
  mimeType: string | null;
  options: ClassifyOption[];
}

export type ClassifyOutcome =
  | {
      outcome: "classified";
      /** null = the model looked and says none of the options fit. */
      requirementKey: string | null;
      confidence: "high" | "medium" | "low";
      documentType: string;
      reasoning: string;
    }
  | { outcome: "skipped"; reason: string }
  | { outcome: "error"; reason: string };

/* --------------------------- pure helpers (tested) --------------------------- */

/** Ceiling on bytes we will read and send. Vision rejects huge payloads anyway. */
export const MAX_CLASSIFY_BYTES = 15 * 1024 * 1024;
/** Ceiling on extracted PDF text sent to the model — page 1 is plenty. */
export const MAX_TEXT_CHARS = 8_000;
/**
 * A "text layer" shorter than this is not a text layer. Scanned PDFs often
 * carry a few stray characters of metadata; classifying on that would be
 * guessing with extra steps.
 */
export const MIN_PDF_TEXT_CHARS = 40;

export type InputRoute =
  | { route: "vision" }
  | { route: "pdf-text" }
  | { route: "unsupported"; reason: string };

const VISION_MIMES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

/** Decide how a file reaches the model, from its type alone. Pure. */
export function routeForMime(mimeType: string | null): InputRoute {
  if (!mimeType) return { route: "unsupported", reason: "no MIME type recorded" };
  const mime = mimeType.split(";")[0].trim().toLowerCase();
  if (VISION_MIMES.has(mime)) return { route: "vision" };
  if (mime === "application/pdf") return { route: "pdf-text" };
  return { route: "unsupported", reason: `unsupported type ${mime}` };
}

/**
 * The JSON schema the model must answer in. Built per call because the legal
 * answers ARE the case's requirement keys — the closed list is enforced by the
 * schema itself, not by hoping the prompt is obeyed.
 */
export function buildResponseSchema(optionKeys: string[]): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      requirement_key: {
        anyOf: [{ type: "string", enum: optionKeys }, { type: "null" }],
        description: "The matching requirement, or null if none of them fit.",
      },
      document_type: {
        type: "string",
        description: "What this document actually is, in a few words.",
      },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
      reasoning: { type: "string", description: "One sentence: why this match." },
    },
    required: ["requirement_key", "document_type", "confidence", "reasoning"],
    additionalProperties: false,
  };
}

/** The instruction the model works under. Pure so the tests can pin it. */
export function buildSystemPrompt(): string {
  return [
    "You classify documents for a document-collection checklist (KYC and similar).",
    "You are given the checklist for one case and one document (an image or extracted text).",
    "Pick the single checklist item this document satisfies, or null if none of them fit.",
    "Rules:",
    "- Choose ONLY from the provided requirement keys. Never invent a category.",
    "- Documents may be photographed at an angle, partly cropped, or in any Indian language alongside English. Read what is actually there.",
    "- confidence=high ONLY when the document unmistakably matches one item (e.g. an Aadhaar card for an 'Aadhaar' item). If two items could both fit, or the image is unclear, use medium or low.",
    "- A wrong high-confidence answer files someone's document in the wrong place; null is always the safer answer than a doubtful match.",
  ].join("\n");
}

/** The user-message text: the checklist as compact JSON. Pure. */
export function buildOptionsBlock(options: ClassifyOption[]): string {
  const list = options.map((o) => ({
    key: o.key,
    label: o.label,
    ...(o.description ? { description: o.description } : {}),
  }));
  return `Checklist items for this case:\n${JSON.stringify(list, null, 1)}`;
}

/** Clamp extracted PDF text to what classification needs. Pure. */
export function clampText(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > MAX_TEXT_CHARS ? t.slice(0, MAX_TEXT_CHARS) : t;
}

/** Parse + validate the model's JSON against our expectations. Pure. */
export function parseModelAnswer(
  raw: string,
  optionKeys: string[],
): Extract<ClassifyOutcome, { outcome: "classified" }> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const a = parsed as {
    requirement_key?: unknown;
    document_type?: unknown;
    confidence?: unknown;
    reasoning?: unknown;
  };
  const key =
    typeof a.requirement_key === "string" && optionKeys.includes(a.requirement_key)
      ? a.requirement_key
      : a.requirement_key === null
        ? null
        : undefined;
  if (key === undefined) return null;
  if (a.confidence !== "high" && a.confidence !== "medium" && a.confidence !== "low") return null;
  return {
    outcome: "classified",
    requirementKey: key,
    confidence: a.confidence,
    documentType: typeof a.document_type === "string" ? a.document_type : "unknown",
    reasoning: typeof a.reasoning === "string" ? a.reasoning : "",
  };
}

/* ------------------------------- the service ------------------------------- */

@Injectable()
export class ClassifyService {
  private readonly log = new Logger(ClassifyService.name);
  private readonly client = env.openaiApiKey ? new OpenAI({ apiKey: env.openaiApiKey }) : null;

  constructor(@Inject(STORAGE) private readonly storage: StorageDriver) {}

  /** Is classification available at all? Callers may skip the read if not. */
  enabled(): boolean {
    return this.client !== null;
  }

  /**
   * Classify one stored document against one case's checklist. Never throws.
   */
  async classify(req: ClassifyRequest): Promise<ClassifyOutcome> {
    if (!this.client) return { outcome: "skipped", reason: "OPENAI_API_KEY not configured" };
    if (req.options.length === 0) return { outcome: "skipped", reason: "checklist has no items" };

    const route = routeForMime(req.mimeType);
    if (route.route === "unsupported") return { outcome: "skipped", reason: route.reason };

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

    // Build the document part of the prompt per the route.
    let documentContent: OpenAI.Chat.Completions.ChatCompletionContentPart[];
    if (route.route === "vision") {
      const dataUrl = `data:${req.mimeType};base64,${bytes.toString("base64")}`;
      documentContent = [
        { type: "text", text: "The document (a photo or image):" },
        { type: "image_url", image_url: { url: dataUrl, detail: "low" } },
      ];
    } else {
      const text = await this.extractPdfText(bytes);
      if (text === null) {
        // No text layer worth reading: a scanned PDF. Real OCR is the Textract
        // follow-up; a half-answer here would just be guessing.
        return { outcome: "skipped", reason: "PDF has no text layer (scanned) — OCR not yet enabled" };
      }
      documentContent = [
        { type: "text", text: `The document (text extracted from a PDF, first pages):\n${text}` },
      ];
    }

    const optionKeys = req.options.map((o) => o.key);
    try {
      const completion = await this.client.chat.completions.create(
        {
          model: env.openaiModel,
          messages: [
            { role: "system", content: buildSystemPrompt() },
            {
              role: "user",
              content: [{ type: "text", text: buildOptionsBlock(req.options) }, ...documentContent],
            },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "document_classification",
              strict: true,
              schema: buildResponseSchema(optionKeys),
            },
          },
          max_tokens: 300,
        },
        { timeout: 30_000 },
      );
      const raw = completion.choices[0]?.message?.content;
      if (!raw) return { outcome: "error", reason: "model returned no content" };
      const answer = parseModelAnswer(raw, optionKeys);
      if (!answer) return { outcome: "error", reason: "model answer failed validation" };
      this.log.log(
        `Classified ${req.fileName}: ${answer.documentType} -> ${answer.requirementKey ?? "(no match)"} [${answer.confidence}]`,
      );
      return answer;
    } catch (e) {
      // Rate limits, timeouts, outages — the document stays where it is.
      return { outcome: "error", reason: `OpenAI call failed: ${msg(e)}` };
    }
  }

  /**
   * First pages of a native PDF's text layer, or null when there is none.
   * unpdf is pure JS (pdf.js underneath) — no native dependency to break the
   * Mac-to-Linux deploy, which is exactly how the argon2 binary once did.
   */
  private async extractPdfText(bytes: Buffer): Promise<string | null> {
    try {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      const { text } = await extractText(pdf, { mergePages: false });
      // Page 1 identifies the document; page 2 is there for letterheads that
      // waste the first page. More pages add cost, not signal.
      const firstPages = (Array.isArray(text) ? text.slice(0, 2) : [String(text)]).join("\n");
      const clamped = clampText(firstPages);
      return clamped.length >= MIN_PDF_TEXT_CHARS ? clamped : null;
    } catch (e) {
      this.log.warn(`PDF text extraction failed: ${msg(e)}`);
      return null;
    }
  }
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

@Module({
  imports: [StorageModule],
  providers: [ClassifyService],
  exports: [ClassifyService],
})
export class ClassifyModule {}
