// The Business-Loan workflow definition, shared by the dev seed and the
// production bootstrap. It lives here rather than in seed.ts because seed.ts
// runs main() on import — importing its constants would run the seed — and
// because a second copy would drift from this one the first time a stage or
// field changes.
import type { FieldDef, NewDocumentRequirement } from "./schema";

/* Vocabulary for this workflow. Docket itself is industry-agnostic — these
 * nouns are what make this particular workflow a lending one. A college's
 * workflow would carry Student/Admission, a CA firm's Client/Engagement. */
export const WORKFLOW = {
  name: "Business Loan",
  slug: "business-loan",
  subjectLabel: "Borrower",
  caseLabel: "Application",
} as const;

/* The Business-Loan workflow's 12 stages (mirrors the live Gain tenant). */
export const STAGES: { name: string; tone: string }[] = [
  { name: "Pending", tone: "muted" },
  { name: "Proprietorship Documents Collection", tone: "teal" },
  { name: "Partnership Document Collection", tone: "teal" },
  { name: "PVT LTD Document Collection", tone: "teal" },
  { name: "Follow up", tone: "amber" },
  { name: "Auto Follow-Up", tone: "amber" },
  { name: "Human Escalated", tone: "orange" },
  { name: "Not Interested", tone: "muted" },
  { name: "Not Picked", tone: "muted" },
  { name: "No Answer", tone: "muted" },
  { name: "Completed", tone: "green" },
  { name: "Missing PanCard", tone: "red" },
];

/* The 8-field Business-Loan lead config ("Portal" corrects Gain's "Protal" typo). */
export const LEAD_FIELDS: FieldDef[] = [
  { field_key: "pan_number", label: "PAN Number", field_type: "string", input_type: "text", required: false, validation: { regex: "^[A-Z]{5}[0-9]{4}[A-Z]{1}$", minimum: "10", maximum: "10" }, placeholder: "Enter PAN number", order: 0 },
  { field_key: "company_name", label: "Company Name", field_type: "string", input_type: "text", required: false, validation: { minimum: "1", maximum: "100" }, placeholder: "Enter company name", order: 1 },
  { field_key: "loan_amount", label: "Loan Amount (₹)", field_type: "integer", input_type: "number", required: false, validation: { minimum: "1" }, placeholder: "Enter loan amount", order: 2, show_in_table: true, format: "inr" },
  { field_key: "loan_type", label: "Loan Type", field_type: "enum", input_type: "dropdown", required: false, options: ["SME Term Loan", "LAP", "Working Capital", "Top-up"], order: 3, show_in_table: true },
  { field_key: "entity_type", label: "Entity Type", field_type: "enum", input_type: "dropdown", required: false, options: ["Proprietorship", "Partnership", "Private Limited", "Public Limited", "LLP"], order: 4, show_in_table: true },
  { field_key: "source", label: "Source", field_type: "enum", input_type: "dropdown", required: false, options: ["Portal", "Whatsapp", "Email", "Referral", "Website", "Other"], order: 5 },
  { field_key: "monthly_turnover", label: "Monthly Turnover", field_type: "integer", input_type: "number", required: false, order: 6 },
  { field_key: "funds_needed", label: "Funds Needed", field_type: "string", input_type: "textarea", required: false, order: 7 },
];

/**
 * The Business-Loan document checklist.
 *
 * This replaces the hardcoded DOC_HINTS list the dashboard used to render: the
 * checklist is data now, so a tenant (or an AI-generated blueprint) can change
 * it without a deploy.
 *
 * Two things are doing real work here and are worth understanding:
 *
 * `reusable` + `validityDays` decide whether a document can be carried forward
 * from the subject's other cases. A PAN card is the same PAN card forever, so
 * it is reused indefinitely. Bank statements and GST returns are reusable only
 * while fresh — a 12-month statement collected 8 months ago must NOT be pulled
 * into a new application, so it carries a validity window instead. Anything
 * describing this particular deal is not reusable at all.
 *
 * `condition` gates a requirement on the case's own data. A Partnership Deed is
 * only meaningful for a partnership; asking every borrower for one is how
 * checklists become noise that people ignore.
 *
 * Omitted deliberately: `accepts` is left empty (any file type). Borrowers send
 * phone photos, scans and PDFs, and rejecting a legible photo because it is a
 * HEIC would cost more than it saves.
 */
export const DOCUMENT_REQUIREMENTS: Omit<
  NewDocumentRequirement,
  "tenantId" | "workflowId"
>[] = [
  // ---- identity: the same document forever, so reusable with no expiry ----
  { key: "applicant_pan", label: "PAN Card", description: "The PAN card itself, for the proprietor, partners or directors. NOT a tax return, Form 26AS, annual tax statement or any other document that merely quotes a PAN number.", required: true, reusable: true, position: 0 },
  // Deliberately NOT "Aadhaar". RBI's KYC framework accepts any ONE of six
  // Officially Valid Documents, and the Supreme Court struck down s.57 of the
  // Aadhaar Act, which is what had let private entities compel Aadhaar. Naming
  // one OVD and marking it required asks borrowers for something we may not
  // insist on — and mis-files the passport of anyone who sends one instead.
  // The label carries the alternatives because request emails list labels
  // only, never descriptions (see nudges/compose.ts).
  { key: "applicant_identity", label: "Identity proof (Aadhaar, passport or voter ID)", description: "Any ONE government-issued identity document for the proprietor, partners or directors: Aadhaar (both sides), passport, driving licence, voter ID card, or NREGA job card. Aadhaar is accepted but is not required — any one of these is enough. File the identity document here even though it also shows an address; it is not the residence address proof.", required: true, reusable: true, position: 1 },
  { key: "photograph", label: "Passport photograph", description: "A standalone passport-size headshot of the applicant, on a plain background. NOT a passport, and NOT a form, bank record or other document that happens to contain a photograph.", required: true, reusable: true, validityDays: 1095, position: 2 },

  // ---- address: stable, but re-verified yearly ----
  { key: "residence_address_proof", label: "Residence address proof", description: "Proof of where the applicant LIVES: a utility bill, rent or lease agreement, or property tax receipt in their name for their home address. If the document is for business or commercial premises, it belongs to Office address proof instead. An identity document — Aadhaar, passport, driving licence or voter ID — belongs to Identity proof, not here, even though it shows an address.", required: true, reusable: true, validityDays: 365, position: 3 },
  { key: "office_address_proof", label: "Office address proof", description: "Proof of where the BUSINESS operates: a utility bill, rent or lease agreement, or ownership document for the shop, office or commercial premises. If the document is for the applicant's home, it belongs to Residence address proof instead. When a bill or agreement gives no indication whether the address is a home or a business, do not choose between these two with high confidence.", required: true, reusable: true, validityDays: 365, position: 4 },

  // ---- the business ----
  { key: "business_proof", label: "Business proof", description: "Registration proving the business exists: Shop Act licence, Udyam/MSME registration, or trade licence. A GST certificate has its own item — do not file one here.", required: true, reusable: true, validityDays: 365, position: 5 },
  { key: "gst_certificate", label: "GST certificate", description: "The GST registration certificate (Form GST REG-06) showing the GSTIN. NOT a GST return such as GSTR-3B, which has its own item.", required: false, reusable: true, validityDays: 365, position: 6 },

  // ---- financials: reusable ONLY while current ----
  { key: "itr_computation", label: "ITR + computation", description: "The filed income tax return (ITR-V / acknowledgement) with its computation of income, last 2 assessment years. A Form 26AS or annual tax statement is NOT an ITR.", required: true, reusable: true, validityDays: 365, position: 7 },
  { key: "audited_financials", label: "Audited financials", description: "The auditor's report and audited statements — Form 3CB/3CD with balance sheet and profit-and-loss, last 2 years. Not the income tax return itself, which has its own item.", required: true, reusable: true, validityDays: 365, position: 8 },
  { key: "bank_statements", label: "Current account statements", description: "Bank statements for the business current account(s), showing transactions, last 12 months. NOT a passbook photo, cheque, or a savings-scheme record such as PPF.", required: true, maxFiles: 12, reusable: true, validityDays: 90, position: 9 },
  { key: "gstr_3b", label: "GSTR-3B returns", description: "Filed GSTR-3B monthly return forms, last 12 months. NOT the GST registration certificate, which has its own item.", required: false, maxFiles: 12, reusable: true, validityDays: 90, position: 10 },

  // ---- constitution: gated on entity_type, and never reusable across cases ----
  {
    key: "partnership_deed",
    label: "Partnership Deed",
    description: "Registered deed with the current partner list",
    required: true,
    reusable: false,
    position: 11,
    condition: { field: "entity_type", equals: "Partnership" },
  },
  {
    key: "incorporation_certificate",
    label: "Certificate of Incorporation",
    description: "With MOA and AOA",
    required: true,
    reusable: false,
    position: 12,
    condition: { field: "entity_type", in: ["Private Limited", "Public Limited", "LLP"] },
  },
];
