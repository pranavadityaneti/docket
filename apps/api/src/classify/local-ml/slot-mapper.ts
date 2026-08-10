import { findLabel, getLabels, labelTerms, type OntologyLabel } from "./ontology";
import { normalizeText, tokens } from "./text";

export interface ClassifySlot {
  id: string;
  title: string;
  description?: string | null;
  aliases?: string[];
}

export function mapSlot(input: {
  ontologyLabel: string;
  slots: ClassifySlot[];
  labels?: OntologyLabel[];
}): string | null {
  const { ontologyLabel, slots } = input;
  if (!slots.length || ontologyLabel === "other") return null;

  const labels = input.labels ?? getLabels();
  const label = findLabel(ontologyLabel) ?? labels.find((l) => l.id === ontologyLabel);
  if (!label) return null;

  let bestSlotId: string | null = null;
  let bestScore = 0;
  for (const slot of slots) {
    if (!slot.id) continue;
    const score = scoreSlot(label, slot);
    if (score > bestScore) {
      bestScore = score;
      bestSlotId = slot.id;
    }
  }
  if (bestScore < 2) return null;
  return bestSlotId;
}

function scoreSlot(label: OntologyLabel, slot: ClassifySlot): number {
  const terms = labelTerms(label);
  const labelText = normalizeText(terms.join(" "));
  const slotId = normalizeText(slot.id);
  const slotTitle = normalizeText(slot.title);
  const slotDescription = normalizeText(slot.description ?? "");
  const slotAliases = (slot.aliases ?? []).map((a) => normalizeText(a));
  const slotText = normalizeText(
    [slotId, slotTitle, slotDescription, ...slotAliases].join(" "),
  );

  let score = 0;
  if (slotId === normalizeText(label.id)) score += 10;

  for (const term of terms) {
    const normalizedTerm = normalizeText(term);
    if (!normalizedTerm) continue;
    if (slotText.includes(normalizedTerm)) {
      score += normalizedTerm.includes(" ") ? 4 : 2.5;
    }
    for (const alias of slotAliases) {
      if (alias && (alias.includes(normalizedTerm) || normalizedTerm.includes(alias))) {
        score += 3;
      }
    }
  }

  for (const slotTerm of [slotTitle, slotDescription, ...slotAliases]) {
    if (slotTerm && labelText.includes(slotTerm)) score += 3;
  }

  const labelTokenSet = new Set(tokens(labelText));
  const slotTokenSet = new Set(tokens(slotText));
  let overlap = 0;
  for (const token of labelTokenSet) {
    if (slotTokenSet.has(token)) overlap += 1;
  }
  score += overlap;
  return score;
}
