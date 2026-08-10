/** Auto-file only when model probability is at least this (89%). */
export const HIGH_THRESHOLD = 0.89;
/** Suggest for human confirm between medium and high. */
export const MEDIUM_THRESHOLD = 0.55;
export const LOW_THRESHOLD = 0.35;
export const LOW_MARGIN = 0.06;


export type ConfidenceBand = "high" | "medium" | "low" | "unknown";

export interface CalibratedResult {
  label: string;
  band: ConfidenceBand;
  prob: number;
  reasons: string[];
}

/**
 * Calibrate a probability distribution over ontology labels.
 * `high` (≥89%) is the only band that auto-files onto a checklist slot.
 */
export function calibrate(probs: Record<string, number>): CalibratedResult {
  const ordered = Object.entries(probs)
    .map(([label, prob]): [string, number] => [label, Number(prob)])
    .sort((a, b) => b[1] - a[1]);

  if (ordered.length === 0) {
    return {
      label: "other",
      band: "unknown",
      prob: 0,
      reasons: ["calibration:no_probs"],
    };
  }

  const [bestLabel, bestProb] = ordered[0];
  const secondProb = ordered[1]?.[1] ?? 0;
  const margin = bestProb - secondProb;
  const band = bandForProb(bestProb);
  const reasons = [
    `calibration:band:${band}`,
    `calibration:margin:${margin.toFixed(3)}`,
  ];

  if (bestLabel === "other") {
    return {
      label: "other",
      band: "unknown",
      prob: bestProb,
      reasons: [...reasons, "calibration:abstain_other"],
    };
  }
  if (band === "unknown") {
    return {
      label: "other",
      band: "unknown",
      prob: bestProb,
      reasons: [...reasons, "calibration:abstain_below_low"],
    };
  }
  if (margin < LOW_MARGIN) {
    return {
      label: "other",
      band: "unknown",
      prob: bestProb,
      reasons: [...reasons, "calibration:abstain_low_margin"],
    };
  }

  return { label: bestLabel, band, prob: bestProb, reasons };
}

function bandForProb(prob: number): ConfidenceBand {
  if (prob >= HIGH_THRESHOLD) return "high";
  if (prob >= MEDIUM_THRESHOLD) return "medium";
  if (prob >= LOW_THRESHOLD) return "low";
  return "unknown";
}

export function scoresToProbs(
  scored: Array<{ id: string; score: number }>,
): Record<string, number> {
  const clipped = scored.map((s) => ({
    id: s.id,
    score: Math.max(0, Number(s.score) || 0),
  }));
  const total = clipped.reduce((a, b) => a + b.score, 0);
  if (total <= 0) {
    const out: Record<string, number> = {};
    for (const s of clipped) out[s.id] = s.id === "other" ? 1 : 0;
    return out;
  }
  const out: Record<string, number> = {};
  for (const s of clipped) out[s.id] = s.score / total;
  return out;
}
