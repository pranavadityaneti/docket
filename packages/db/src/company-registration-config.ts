// The Company-Registration workflow definition.
//
// ONE workflow for nine entity types, not nine workflows.
//
// The shared core — promoter KYC, registered office, photographs — is roughly
// half the checklist and identical whichever entity is being formed. Split into
// nine workflows, that core is written nine times and drifts the first time
// anyone corrects a description in one of them. Kept as one, the differences
// are expressed as conditions on `entity_type`, which is exactly the mechanism
// the lending workflow already uses to ask a Partnership for its deed and a
// Private Limited for its incorporation certificate.
//
// Conditions COMBINE rather than compete: "has a foreign promoter" is a second,
// independent question that stacks apostilled documents on top of whichever
// entity type was chosen.
import type { FieldDef, NewDocumentRequirement } from "./schema";

export const WORKFLOW = {
  name: "Company Registration",
  slug: "company-registration",
  subjectLabel: "Promoter",
  caseLabel: "Registration",
} as const;

/**
 * Stages deliberately generic enough for all nine types. "Filed", not "Filed
 * with MCA" — a partnership deed is registered with the Registrar of Firms and
 * a proprietorship is never filed with MCA at all, so an MCA-specific stage
 * would be a lie on two of the nine.
 */
export const STAGES: { name: string; tone: string }[] = [
  { name: "New request", tone: "muted" },
  { name: "Name approval", tone: "teal" },
  { name: "Documents pending", tone: "teal" },
  { name: "Filed", tone: "amber" },
  { name: "Query raised", tone: "red" },
  { name: "Incorporated", tone: "green" },
];

/** The nine structures this workflow forms. Referenced by the conditions below. */
export const ENTITY_TYPES = [
  "Private Limited",
  "Public Limited",
  "One Person Company",
  "LLP",
  "Partnership Firm",
  "Sole Proprietorship",
  "Section 8 (NGO)",
  "Nidhi",
  "Producer Company",
] as const;

/** Types incorporated through MCA — these need DSC, DIN and MCA forms. */
const MCA_FILED = [
  "Private Limited",
  "Public Limited",
  "One Person Company",
  "LLP",
  "Section 8 (NGO)",
  "Nidhi",
  "Producer Company",
];

/** Types governed by the Companies Act — these carry MOA, AOA and INC-9. */
const COMPANIES_ACT = [
  "Private Limited",
  "Public Limited",
  "One Person Company",
  "Section 8 (NGO)",
  "Nidhi",
  "Producer Company",
];

/**
 * Case fields.
 *
 * Three of these gate documents and earn their place that way: entity_type is
 * the fork itself, office_premises decides between an owner's NOC and an
 * ownership document, and foreign_promoter stacks the apostilled set. The rest
 * are what a filing needs recorded.
 */
export const REGISTRATION_FIELDS: FieldDef[] = [
  { field_key: "entity_type", label: "Entity type", field_type: "enum", input_type: "dropdown", required: true, options: [...ENTITY_TYPES], order: 0, show_in_table: true },
  { field_key: "proposed_name_1", label: "Proposed name (first choice)", field_type: "string", input_type: "text", required: true, placeholder: "e.g. Acme Technologies", order: 1, show_in_table: true },
  { field_key: "proposed_name_2", label: "Proposed name (second choice)", field_type: "string", input_type: "text", required: false, order: 2 },
  { field_key: "office_state", label: "Registered office state", field_type: "string", input_type: "text", required: false, placeholder: "e.g. Telangana", order: 3, show_in_table: true },
  // Gates the office documents: a rented office needs the owner's NOC and the
  // rent agreement, an owned one needs the ownership proof. Asking for all
  // three of everyone is how a checklist stops being believed.
  { field_key: "office_premises", label: "Registered office premises", field_type: "enum", input_type: "dropdown", required: false, options: ["Rented", "Owned"], order: 4 },
  { field_key: "foreign_promoter", label: "Any foreign promoter or subscriber?", field_type: "enum", input_type: "dropdown", required: false, options: ["No", "Yes"], order: 5 },
  { field_key: "number_of_promoters", label: "Number of promoters / directors", field_type: "integer", input_type: "number", required: false, validation: { minimum: "1", maximum: "50" }, order: 6 },
  { field_key: "authorised_capital", label: "Authorised capital (₹)", field_type: "integer", input_type: "number", required: false, order: 7, format: "inr" },
];

/**
 * The checklist. Descriptions follow the migration-0015 standard: what the
 * document IS and, where a look-alike exists, what it is NOT. Incorporation
 * paperwork is full of them — an MOA and an AOA arrive as one PDF from the same
 * portal, and a DSC token is not a DIN.
 */
export const DOCUMENT_REQUIREMENTS: Omit<
  NewDocumentRequirement,
  "tenantId" | "workflowId"
>[] = [
  /* ---- every promoter, every entity type ---- */
  // maxFiles is generous because these repeat per promoter: a Producer Company
  // needs ten. One slot per document type would make the tenth PAN unfileable.
  { key: "promoter_pan", label: "PAN card of each promoter", description: "The PAN card of every subscriber, director or partner. NOT an income tax return, Form 26AS or any other document that merely quotes a PAN number.", required: true, reusable: true, maxFiles: 15, position: 0 },
  { key: "promoter_identity", label: "Identity proof of each promoter", description: "Any ONE government-issued photo identity per promoter: Aadhaar, passport, voter ID or driving licence. NOT the PAN card, which is collected separately.", required: true, reusable: true, maxFiles: 15, position: 1 },
  // The 2-month rule is a hard MCA rejection, which is exactly what
  // validityDays exists to catch before a filing is refused.
  { key: "promoter_address_proof", label: "Residential address proof of each promoter (under 2 months old)", description: "A utility bill or bank statement per promoter, DATED WITHIN THE LAST 2 MONTHS. An older bill is rejected at filing. NOT Aadhaar or a passport — those are identity proof, even though they print an address.", required: true, reusable: false, validityDays: 60, maxFiles: 15, position: 2 },
  { key: "promoter_photo", label: "Passport photograph of each promoter", description: "A standalone passport-size headshot per promoter, plain background. NOT a photo cropped from an identity document.", required: true, reusable: true, validityDays: 1095, maxFiles: 15, position: 3 },

  /* ---- registered office ---- */
  { key: "office_utility_bill", label: "Utility bill for the registered office (under 2 months old)", description: "Electricity, telephone, gas or water bill for the proposed registered office, DATED WITHIN THE LAST 2 MONTHS. It must show the office address, not a promoter's home address.", required: true, reusable: false, validityDays: 60, position: 4 },
  { key: "office_noc", label: "NOC from the premises owner", description: "A no-objection certificate signed by the owner permitting the address to be used as the registered office. NOT the rent agreement — this is the owner's separate consent.", required: true, reusable: false, condition: { field: "office_premises", equals: "Rented" }, position: 5 },
  { key: "office_rent_agreement", label: "Rent / lease agreement for the office", description: "The registered rent or lease agreement for the premises. NOT the owner's NOC.", required: true, reusable: false, condition: { field: "office_premises", equals: "Rented" }, position: 6 },
  { key: "office_ownership_proof", label: "Ownership proof for the office", description: "The sale deed or latest property tax receipt where the premises are owned by a promoter or the entity. NOT a rent agreement.", required: true, reusable: false, condition: { field: "office_premises", equals: "Owned" }, position: 7 },

  /* ---- filing credentials (MCA-filed types only) ---- */
  { key: "dsc", label: "Class 3 Digital Signature Certificate", description: "A Class 3 DSC for every signing director or partner, from an MCA-authorised certifying authority. The filing cannot be submitted without it. NOT a DIN — a DSC is the signing token, a DIN is an identification number.", required: true, reusable: false, maxFiles: 15, condition: { field: "entity_type", in: MCA_FILED }, position: 8 },
  { key: "din", label: "DIN of existing directors", description: "The Director Identification Number where a director already holds one. Where none exists it is applied for inside the incorporation form, so this is only for directors who already have one.", required: false, reusable: true, maxFiles: 15, condition: { field: "entity_type", in: MCA_FILED }, position: 9 },

  /* ---- constitutional documents, by entity type ---- */
  { key: "moa", label: "Memorandum of Association (MOA)", description: "The MOA stating the objects and the subscribers to the memorandum. NOT the Articles of Association, though the two are usually issued together — the MOA defines what the company may do.", required: true, reusable: false, condition: { field: "entity_type", in: COMPANIES_ACT }, position: 10 },
  { key: "aoa", label: "Articles of Association (AOA)", description: "The AOA setting out the company's internal rules and governance. NOT the Memorandum — the AOA governs how the company runs, not what it may do.", required: true, reusable: false, condition: { field: "entity_type", in: COMPANIES_ACT }, position: 11 },
  { key: "inc9", label: "INC-9 declaration", description: "The statutory declaration under section 7(1)(b) of the Companies Act by every subscriber and first director, confirming they are not disqualified. NOT the MOA or AOA.", required: true, reusable: false, condition: { field: "entity_type", in: COMPANIES_ACT }, position: 12 },
  { key: "llp_agreement", label: "LLP agreement", description: "The agreement between designated partners governing the LLP, filed within 30 days of incorporation. An LLP has NO memorandum or articles — this document takes their place.", required: true, reusable: false, condition: { field: "entity_type", equals: "LLP" }, position: 13 },
  { key: "partnership_deed", label: "Partnership deed", description: "The executed partnership deed on stamp paper, naming partners and profit-sharing ratios. NOT an LLP agreement, which is a different instrument under a different Act.", required: true, reusable: false, condition: { field: "entity_type", equals: "Partnership Firm" }, position: 14 },
  { key: "inc3_nominee", label: "Nominee consent (INC-3)", description: "The written consent of the nominee who takes over the company on the sole member's death or incapacity. Unique to a One Person Company — no other structure needs a nominee.", required: true, reusable: false, condition: { field: "entity_type", equals: "One Person Company" }, position: 15 },
  { key: "section8_licence", label: "Section 8 licence application", description: "The application for a licence under section 8 to operate as a not-for-profit. It must be obtained BEFORE incorporation, unlike every other document here.", required: true, reusable: false, condition: { field: "entity_type", equals: "Section 8 (NGO)" }, position: 16 },
  { key: "section8_projections", label: "Three-year income & expenditure projection", description: "The projected income and expenditure statement for three years, supporting the section 8 licence application. NOT audited financials — this is a forward projection.", required: true, reusable: false, condition: { field: "entity_type", equals: "Section 8 (NGO)" }, position: 17 },
  { key: "nidhi_member_declarations", label: "Declarations from the seven members", description: "Signed declarations from the minimum seven members required to form a Nidhi. NOT the subscriber sheet of the MOA.", required: true, reusable: false, maxFiles: 10, condition: { field: "entity_type", equals: "Nidhi" }, position: 18 },
  { key: "producer_member_proof", label: "Proof that members are primary producers", description: "Evidence that each of the ten or more members is a primary producer — land records, farmer ID or a producer-organisation certificate. Unique to a Producer Company.", required: true, reusable: false, maxFiles: 15, condition: { field: "entity_type", equals: "Producer Company" }, position: 19 },
  { key: "proprietor_business_proof", label: "Business registration proof", description: "For a sole proprietorship there is no incorporation: the business is evidenced by a GST certificate, Udyam registration or Shop & Establishment licence. Any ONE of these.", required: true, reusable: true, condition: { field: "entity_type", equals: "Sole Proprietorship" }, position: 20 },

  /* ---- foreign promoters: stacks on top of the entity type ---- */
  { key: "foreign_passport", label: "Apostilled passport of foreign promoter", description: "The passport of each foreign national promoter, notarised and apostilled (or consularised) in the country of origin. A plain photocopy is not accepted.", required: true, reusable: true, maxFiles: 10, condition: { field: "foreign_promoter", equals: "Yes" }, position: 21 },
  { key: "foreign_address_proof", label: "Apostilled address proof of foreign promoter", description: "Address proof for each foreign promoter, apostilled, and dated within the last 2 months. NOT the passport, which is identity.", required: true, reusable: false, validityDays: 60, maxFiles: 10, condition: { field: "foreign_promoter", equals: "Yes" }, position: 22 },

  /* ---- name & pre-filing ---- */
  { key: "name_approval_letter", label: "Name approval letter (RUN / SPICe+ Part A)", description: "The approval letter reserving the proposed company name. NOT a trademark certificate.", required: false, reusable: false, validityDays: 20, condition: { field: "entity_type", in: MCA_FILED }, position: 23 },
  { key: "trademark_noc", label: "Trademark owner's NOC", description: "Where the proposed name matches a registered trademark, the trademark owner's no-objection certificate authorising its use.", required: false, reusable: false, position: 24 },

  /* ---- post-incorporation (bundled by SPICe+ / AGILE-PRO) ---- */
  { key: "bank_account_form", label: "Bank account opening form", description: "The bank account opening application bundled with incorporation. NOT a cancelled cheque — the account does not exist yet.", required: false, reusable: false, condition: { field: "entity_type", in: MCA_FILED }, position: 25 },
  { key: "gst_application", label: "GST registration application", description: "The GST registration application submitted alongside incorporation. NOT a GST certificate, which is issued afterwards.", required: false, reusable: false, position: 26 },
];
