import {
  BadRequestException,
  Body,
  Controller,
  Injectable,
  Module,
  NotFoundException,
  Post,
  UseGuards,
} from "@nestjs/common";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import { IsString, MinLength } from "class-validator";
import { env } from "../config/env";
import {
  clampText,
  MAX_CLASSIFY_BYTES,
  MIN_PDF_TEXT_CHARS,
  rasterScaleFor,
  routeForMime,
  MAX_RASTER_PAGES,
} from "./classify-helpers";
import { calibrate, scoresToProbs } from "./local-ml/calibration";
import { findLabel, getLabels, ONTOLOGY_LABELS } from "./local-ml/ontology";
import { onnxModelAvailable, scoreImageWithOnnx } from "./local-ml/onnx-classifier";
import { classifyPdfText } from "./local-ml/runtime";

class ClassifyTestDto {
  /** MIME type of the uploaded bytes (image/* or application/pdf). */
  @IsString()
  @MinLength(3)
  mimeType!: string;

  /** Raw file bytes as base64. Filename is intentionally NOT accepted. */
  @IsString()
  @MinLength(8)
  dataBase64!: string;
}

export type ClassifyTestScore = {
  id: string;
  title: string;
  score: number;
};

export type ClassifyTestResponse = {
  label: string;
  title: string;
  confidence: number;
  band: "high" | "medium" | "low" | "unknown";
  scores: ClassifyTestScore[];
  modelVersion: string;
  route: string;
};

@Injectable()
export class ClassifyTestService {
  async preview(mimeType: string, bytes: Buffer): Promise<ClassifyTestResponse> {
    if (bytes.length === 0) throw new BadRequestException("Empty file");
    if (bytes.length > MAX_CLASSIFY_BYTES) {
      throw new BadRequestException("File exceeds classification size limit");
    }

    const route = routeForMime(mimeType);
    if (route.route === "unsupported") {
      throw new BadRequestException(route.reason);
    }

    if (route.route === "image") {
      return this.fromImage(bytes, "image");
    }

    // PDF: prefer typed text when rich enough; otherwise rasterise page 1 → ONNX.
    const text = await this.extractPdfText(bytes);
    if (text) {
      const result = await classifyPdfText(text, []);
      const scores = this.scoresFromReasonsOrRebuild(result);
      return {
        label: result.ontologyLabel,
        title: result.documentType,
        confidence: result.calibratedProb,
        band: result.band,
        scores,
        modelVersion: result.modelVersion,
        route: "pdf_text",
      };
    }

    const pages = await this.rasteriseFirstPage(bytes);
    if (!pages) {
      throw new BadRequestException(
        "PDF has no usable text layer and could not be rendered for the model",
      );
    }
    return this.fromImage(pages, "pdf_raster");
  }

  private async fromImage(
    bytes: Buffer,
    route: string,
  ): Promise<ClassifyTestResponse> {
    if (!onnxModelAvailable()) {
      throw new BadRequestException(
        "Local ONNX model not found (apps/api/models/onnx/classifier.onnx)",
      );
    }
    const scored = await scoreImageWithOnnx(bytes);
    const probs = scoresToProbs(scored.scores);
    const calibrated = calibrate(probs);
    const labelMeta = findLabel(calibrated.label);
    const titles = new Map(getLabels().map((l) => [l.id, l.title]));

    return {
      label: calibrated.label,
      title: labelMeta?.title ?? calibrated.label,
      confidence: Math.round(calibrated.prob * 10_000) / 10_000,
      band: calibrated.band,
      scores: scored.scores
        .map((s) => ({
          id: s.id,
          title: titles.get(s.id) ?? s.id,
          score: s.score,
        }))
        .sort((a, b) => b.score - a.score),
      modelVersion: scored.modelVersion,
      route,
    };
  }

  /** Rebuild a full scoreboard for the PDF-text path (IDF has no full softmax table). */
  private scoresFromReasonsOrRebuild(result: {
    ontologyLabel: string;
    calibratedProb: number;
  }): ClassifyTestScore[] {
    const titles = new Map(ONTOLOGY_LABELS.map((l) => [l.id, l.title]));
    return ONTOLOGY_LABELS.map((l) => ({
      id: l.id,
      title: titles.get(l.id) ?? l.id,
      score:
        l.id === result.ontologyLabel
          ? result.calibratedProb
          : Math.round(
            ((1 - result.calibratedProb) / Math.max(1, ONTOLOGY_LABELS.length - 1)) *
              10_000,
          ) / 10_000,
    })).sort((a, b) => b.score - a.score);
  }

  private async extractPdfText(bytes: Buffer): Promise<string | null> {
    try {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      const { text } = await extractText(pdf, { mergePages: false });
      const firstPages = (Array.isArray(text) ? text.slice(0, 2) : [String(text)]).join("\n");
      const clamped = clampText(firstPages);
      return clamped.length >= MIN_PDF_TEXT_CHARS ? clamped : null;
    } catch {
      return null;
    }
  }

  private async rasteriseFirstPage(bytes: Buffer): Promise<Buffer | null> {
    try {
      const { getDocumentProxy, renderPageAsImage } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      const pageCount = Math.min(pdf.numPages, MAX_RASTER_PAGES);
      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
        try {
          const page = await pdf.getPage(pageNumber);
          const { width, height } = page.getViewport({ scale: 1 });
          const png = await renderPageAsImage(new Uint8Array(bytes), pageNumber, {
            canvasImport: () => import("@napi-rs/canvas"),
            scale: rasterScaleFor(width, height),
          });
          return Buffer.from(new Uint8Array(png));
        } catch {
          /* try next page */
        }
      }
      return null;
    } catch {
      return null;
    }
  }
}

/**
 * Dev-only model playground — no auth. Not registered in production
 * (see AppModule); still hard-404 here as belt-and-suspenders.
 */
@UseGuards(ThrottlerGuard)
@Controller("classify")
export class ClassifyTestController {
  constructor(private readonly preview: ClassifyTestService) { }

  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Post("test")
  async test(@Body() body: ClassifyTestDto): Promise<ClassifyTestResponse> {
    if (env.isProd) throw new NotFoundException();
    let bytes: Buffer;
    try {
      bytes = Buffer.from(body.dataBase64, "base64");
    } catch {
      throw new BadRequestException("Invalid base64 payload");
    }
    if (!bytes.length) throw new BadRequestException("Empty decoded file");
    return this.preview.preview(body.mimeType, bytes);
  }
}

@Module({
  controllers: [ClassifyTestController],
  providers: [ClassifyTestService],
})
export class ClassifyTestModule { }
