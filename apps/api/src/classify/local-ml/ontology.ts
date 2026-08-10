export interface OntologyLabel {
  id: string;
  title: string;
  description: string;
  aliases: string[];
}

export const ONTOLOGY_VERSION = 1;

/** Visual document types — mapped to checklist slots after classification. */
export const ONTOLOGY_LABELS: OntologyLabel[] = [
  {
    id: "pan_card",
    title: "PAN card",
    description: "Indian Permanent Account Number card issued by Income Tax Department",
    aliases: ["pan", "pan card", "income tax pan"],
  },
  {
    id: "aadhaar_front",
    title: "Aadhaar front",
    description: "Front of UIDAI Aadhaar card with photo and demographic details",
    aliases: ["aadhaar", "aadhar", "uidai"],
  },
  {
    id: "aadhaar_back",
    title: "Aadhaar back",
    description: "Back of UIDAI Aadhaar card with address",
    aliases: ["aadhaar back", "aadhar back"],
  },
  {
    id: "passport",
    title: "Passport",
    description: "Passport biodata page",
    aliases: ["passport", "passport copy"],
  },
  {
    id: "photograph",
    title: "Photograph",
    description: "Passport-style personal photograph, not a document containing a photo",
    aliases: ["photo", "passport photo", "passport size photo"],
  },
  {
    id: "bank_statement",
    title: "Bank statement",
    description: "Bank account statement showing transactions over a period",
    aliases: ["bank statement", "account statement", "passbook"],
  },
  {
    id: "rental_agreement",
    title: "Rental agreement",
    description: "Lease or rental agreement document",
    aliases: ["rent agreement", "lease"],
  },
  {
    id: "cancelled_cheque",
    title: "Cancelled cheque",
    description: "Cancelled cheque leaf showing account details",
    aliases: ["cheque", "canceled cheque"],
  },
  {
    id: "salary_slip",
    title: "Salary slip",
    description: "Payslip or salary statement",
    aliases: ["payslip", "salary"],
  },
  {
    id: "utility_bill",
    title: "Utility bill",
    description: "Electricity, water, gas or similar utility bill",
    aliases: ["electricity bill", "water bill"],
  },
  {
    id: "form_16",
    title: "Form 16",
    description: "Indian Form 16 tax certificate",
    aliases: ["form16", "form 16"],
  },
  {
    id: "gst_certificate",
    title: "GST certificate",
    description: "GST registration certificate",
    aliases: ["gst", "gstin"],
  },
  {
    id: "other",
    title: "Other",
    description: "Document that does not match known ontology types",
    aliases: [],
  },
];

export function getLabels(): OntologyLabel[] {
  return ONTOLOGY_LABELS.map((l) => ({ ...l, aliases: [...l.aliases] }));
}

export function findLabel(id: string): OntologyLabel | null {
  return ONTOLOGY_LABELS.find((l) => l.id === id) ?? null;
}

export function labelTerms(label: OntologyLabel): string[] {
  return [
    label.id.replaceAll("_", " "),
    label.title,
    label.description,
    ...label.aliases,
  ].filter(Boolean);
}

/**
 * CLIP / NLI hypothesis strings. Rich enough for zero-shot, never filenames.
 * Includes an explicit "other" catch-all so the model can abstain.
 */
export function candidatePhrases(labels: OntologyLabel[] = getLabels()): Array<{
  id: string;
  phrase: string;
}> {
  return labels.map((label) => ({
    id: label.id,
    phrase:
      label.id === "other"
        ? "a random photo or document that is not a government ID or KYC paper"
        : `an Indian KYC document: ${label.title}. ${label.description}`,
  }));
}
