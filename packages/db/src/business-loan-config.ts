// The Business-Loan workflow definition, shared by the dev seed and the
// production bootstrap. It lives here rather than in seed.ts because seed.ts
// runs main() on import — importing its constants would run the seed — and
// because a second copy would drift from this one the first time a stage or
// field changes.
import type { LeadFieldDef } from "./schema";

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
export const LEAD_FIELDS: LeadFieldDef[] = [
  { field_key: "pan_number", label: "PAN Number", field_type: "string", input_type: "text", required: false, validation: { regex: "^[A-Z]{5}[0-9]{4}[A-Z]{1}$", minimum: "10", maximum: "10" }, placeholder: "Enter PAN number", order: 0 },
  { field_key: "company_name", label: "Company Name", field_type: "string", input_type: "text", required: false, validation: { minimum: "1", maximum: "100" }, placeholder: "Enter company name", order: 1 },
  { field_key: "loan_amount", label: "Loan Amount (₹)", field_type: "integer", input_type: "number", required: false, validation: { minimum: "1" }, placeholder: "Enter loan amount", order: 2 },
  { field_key: "loan_type", label: "Loan Type", field_type: "enum", input_type: "dropdown", required: false, options: ["SME Term Loan", "LAP", "Working Capital", "Top-up"], order: 3 },
  { field_key: "entity_type", label: "Entity Type", field_type: "enum", input_type: "dropdown", required: false, options: ["Proprietorship", "Partnership", "Private Limited", "Public Limited", "LLP"], order: 4 },
  { field_key: "source", label: "Source", field_type: "enum", input_type: "dropdown", required: false, options: ["Portal", "Whatsapp", "Email", "Referral", "Website", "Other"], order: 5 },
  { field_key: "monthly_turnover", label: "Monthly Turnover", field_type: "integer", input_type: "number", required: false, order: 6 },
  { field_key: "funds_needed", label: "Funds Needed", field_type: "string", input_type: "textarea", required: false, order: 7 },
];
