/** Pure classify helpers — no Nest / transformers imports (unit-test friendly). */

export const MAX_CLASSIFY_BYTES = 15 * 1024 * 1024;
export const MAX_TEXT_CHARS = 8_000;
export const MIN_PDF_TEXT_CHARS = 250;
export const MAX_RASTER_PAGES = 2;
export const MAX_RASTER_PIXELS = 16_000_000;

const RASTER_SCALE = 2;

export function rasterScaleFor(width: number, height: number): number {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return RASTER_SCALE;
  }
  return Math.min(RASTER_SCALE, Math.sqrt(MAX_RASTER_PIXELS / (width * height)));
}

export type InputRoute =
  | { route: "image" }
  | { route: "pdf" }
  | { route: "unsupported"; reason: string };

const IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export function routeForMime(mimeType: string | null): InputRoute {
  if (!mimeType) return { route: "unsupported", reason: "no MIME type recorded" };
  const mime = mimeType.split(";")[0].trim().toLowerCase();
  if (IMAGE_MIMES.has(mime)) return { route: "image" };
  if (mime === "application/pdf") return { route: "pdf" };
  return { route: "unsupported", reason: `unsupported type ${mime}` };
}

export function clampText(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > MAX_TEXT_CHARS ? t.slice(0, MAX_TEXT_CHARS) : t;
}
