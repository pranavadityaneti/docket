import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { calibrate, scoresToProbs, type ConfidenceBand } from "./calibration";
import { MODEL_VERSION as FALLBACK_VERSION } from "./constants";
import { findLabel } from "./ontology";
import { mapSlot, type ClassifySlot } from "./slot-mapper";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));

export interface OnnxMeta {
  classes: string[];
  img_size: number;
  model_name: string;
}

export interface OnnxClassifyResult {
  ontologyLabel: string;
  documentType: string;
  slotId: string | null;
  band: ConfidenceBand;
  calibratedProb: number;
  modelVersion: string;
  reasons: string[];
}

let sessionPromise: Promise<{
  session: import("onnxruntime-node").InferenceSession;
  meta: OnnxMeta;
}> | null = null;

function resolveModelPaths(): { onnx: string; meta: string } | null {
  const candidates = [
    join(process.cwd(), "models/onnx"),
    join(HERE, "../../../../models/onnx"),
    join(HERE, "../../../../../apps/api/models/onnx"),
  ];
  for (const dir of candidates) {
    const onnx = join(dir, "classifier.onnx");
    const meta = join(dir, "classifier.json");
    if (existsSync(onnx) && existsSync(meta)) return { onnx, meta };
  }
  return null;
}

export function onnxModelAvailable(): boolean {
  return resolveModelPaths() !== null;
}

async function getSession() {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const paths = resolveModelPaths();
      if (!paths) throw new Error("classifier.onnx not found under models/onnx");
      const ort = require("onnxruntime-node") as typeof import("onnxruntime-node");
      const session = await ort.InferenceSession.create(paths.onnx);
      const meta = JSON.parse(readFileSync(paths.meta, "utf8")) as OnnxMeta;
      return { session, meta };
    })();
  }
  return sessionPromise;
}

/** ImageNet mean/std — must match training transforms. */
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

async function preprocessImage(
  bytes: Buffer,
  imgSize: number,
): Promise<Float32Array> {
  const sharp = (await import("sharp")).default;
  const { data, info } = await sharp(bytes)
    .rotate() // honor EXIF
    .resize(imgSize, imgSize, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (info.channels < 3) {
    throw new Error(`expected RGB image, got ${info.channels} channels`);
  }

  const size = imgSize * imgSize;
  const out = new Float32Array(3 * size);
  for (let i = 0; i < size; i++) {
    const r = data[i * info.channels]! / 255;
    const g = data[i * info.channels + 1]! / 255;
    const b = data[i * info.channels + 2]! / 255;
    out[i] = (r - MEAN[0]!) / STD[0]!;
    out[size + i] = (g - MEAN[1]!) / STD[1]!;
    out[2 * size + i] = (b - MEAN[2]!) / STD[2]!;
  }
  return out;
}

function softmax(logits: Float32Array | number[]): number[] {
  const arr = Array.from(logits);
  const max = Math.max(...arr);
  const exps = arr.map((v) => Math.exp(v - max));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  return exps.map((v) => v / sum);
}

/**
 * Classify image bytes with the trained local EfficientNet ONNX model.
 * Never uses filenames.
 */
export async function scoreImageWithOnnx(bytes: Buffer): Promise<{
  scores: Array<{ id: string; score: number }>;
  modelName: string;
  modelVersion: string;
}> {
  const ort = require("onnxruntime-node") as typeof import("onnxruntime-node");
  const { session, meta } = await getSession();
  const input = await preprocessImage(bytes, meta.img_size || 224);
  const tensor = new ort.Tensor("float32", input, [1, 3, meta.img_size, meta.img_size]);
  const inputName = session.inputNames[0] ?? "image";
  const output = await session.run({ [inputName]: tensor });
  const outputName = session.outputNames[0] ?? "logits";
  const logits = output[outputName]?.data as Float32Array;
  if (!logits) throw new Error("ONNX session returned no logits");

  const probsArr = softmax(logits);
  return {
    scores: meta.classes.map((id, i) => ({
      id,
      score: Math.round((probsArr[i] ?? 0) * 10_000) / 10_000,
    })),
    modelName: meta.model_name,
    modelVersion: `${FALLBACK_VERSION}+${meta.model_name}`,
  };
}

/**
 * Classify image bytes with the trained local EfficientNet ONNX model.
 * Never uses filenames.
 */
export async function classifyWithOnnx(
  bytes: Buffer,
  slots: ClassifySlot[],
): Promise<OnnxClassifyResult> {
  const scored = await scoreImageWithOnnx(bytes);
  const probs = scoresToProbs(scored.scores);
  const calibrated = calibrate(probs);
  const reasons = [
    "route:onnx_efficientnet",
    `model:${scored.modelName}`,
    ...calibrated.reasons,
  ];

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
    modelVersion: scored.modelVersion,
    reasons,
  };
}
