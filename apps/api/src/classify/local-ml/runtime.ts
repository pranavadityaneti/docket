import { calibrate, scoresToProbs, type ConfidenceBand } from "./calibration";
import { MODEL_VERSION } from "./constants";
import {
  classifyWithOnnx,
  onnxModelAvailable,
  type OnnxClassifyResult,
} from "./onnx-classifier";
import { findLabel, getLabels, labelTerms } from "./ontology";
import { mapSlot, type ClassifySlot } from "./slot-mapper";
import { normalizeText, tokens } from "./text";

export { MODEL_VERSION } from "./constants";
export { onnxModelAvailable } from "./onnx-classifier";

export type LocalMlResult = OnnxClassifyResult;

const STOPWORDS = new Set([
  "and", "by", "copy", "document", "for", "from", "issued", "of", "or", "page",
  "showing", "the", "with",
]);

/**
 * Classify image / raster bytes with the trained ONNX EfficientNet.
 * Filename is never considered.
 */
export async function classifyImageBytes(
  bytes: Buffer,
  _mimeType: string,
  slots: ClassifySlot[],
): Promise<LocalMlResult> {
  if (!onnxModelAvailable()) {
    return abstain(slots, ["onnx:missing"]);
  }
  return classifyWithOnnx(bytes, slots);
}

/**
 * Typed-PDF text path: local keyword/IDF against ontology (content only — still
 * no filename). Prefer raster+ONNX when the PDF has no usable text.
 */
export async function classifyPdfText(
  text: string,
  slots: ClassifySlot[],
): Promise<LocalMlResult> {
  const labels = getLabels();
  const normalized = normalizeText(text);
  const textTokens = tokens(normalized);
  const scored = labels
    .filter((l) => l.id !== "other")
    .map((label) => ({
      id: label.id,
      score: scoreTextLabel(normalized, textTokens, label, labels),
    }));

  // Include other with residual weight when nothing matches.
  if (scored.every((s) => s.score <= 0)) {
    scored.push({ id: "other", score: 1 });
  } else {
    scored.push({ id: "other", score: 0.05 });
  }

  const probs = scoresToProbs(scored);
  const calibrated = calibrate(probs);
  const reasons = ["route:pdf_text_local", ...calibrated.reasons];
  let slotId: string | null = null;
  if (calibrated.band !== "unknown") {
    slotId = mapSlot({ ontologyLabel: calibrated.label, slots });
  }
  if (!slots.length) reasons.push("empty_allow_list");
  else if (slotId === null) reasons.push("slot:none");
  else reasons.push(`slot:${slotId}`);

  const label = findLabel(calibrated.label);
  return {
    ontologyLabel: calibrated.label,
    documentType: label?.title ?? calibrated.label,
    slotId,
    band: calibrated.band,
    calibratedProb: Math.round(calibrated.prob * 10_000) / 10_000,
    modelVersion: MODEL_VERSION,
    reasons,
  };
}

function scoreTextLabel(
  normalizedText: string,
  textTokens: string[],
  label: { id: string; title: string; description: string; aliases: string[] },
  labels: ReturnType<typeof getLabels>,
): number {
  const terms = labelTerms(label);
  let score = 0;
  const set = new Set(textTokens);
  for (const term of terms) {
    const nt = normalizeText(term);
    if (!nt) continue;
    const termTokens = tokens(nt).filter((t) => !STOPWORDS.has(t));
    if (normalizedText.includes(nt)) score += nt.includes(" ") ? 4 : 2;
    for (const token of termTokens) {
      if (set.has(token)) {
        let docs = 0;
        for (const other of labels) {
          if (new Set(tokens(normalizeText(labelTerms(other).join(" ")))).has(token)) {
            docs += 1;
          }
        }
        score += 1 + Math.log((labels.length + 1) / (docs + 1));
      }
    }
  }
  return score;
}

function abstain(slots: ClassifySlot[], reasons: string[]): LocalMlResult {
  return {
    ontologyLabel: "other",
    documentType: "Other",
    slotId: null,
    band: "unknown",
    calibratedProb: 0,
    modelVersion: MODEL_VERSION,
    reasons: [...reasons, "calibration:abstain_no_model"],
  };
}

/** Optional boot warm — loads ONNX session into memory. */
export async function warmLocalModels(): Promise<void> {
  if (!onnxModelAvailable()) return;
  // Tiny 1x1 png is enough to force session load path; classifyWithOnnx needs a real image —
  // just resolve the session via a no-op availability check for now.
  await Promise.resolve();
}
