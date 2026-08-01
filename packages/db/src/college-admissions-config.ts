// The College-Admissions workflow definition.
//
// WHY THIS FILE EXISTS AT ALL
// This workflow has been live in production since before it was written down:
// the workflow, its 5 stages, 3 fields and 7 document requirements existed
// only as rows in the database, created ad hoc. Nothing in the repository
// could recreate it, nobody could review its checklist, and it never received
// the disambiguation pass that migration 0015 gave Business Loan — so all
// seven of its descriptions were NULL, which is the worst possible input to
// the AI classifier. This file is that drift closed.
//
// WHAT CHANGED BESIDES WRITING IT DOWN
// The seven existing items keep their keys, so nothing already filed moves.
// They gain the descriptions they never had. The new items and the new fields
// exist because an admission's document set genuinely depends on answers —
// a PG applicant owes a degree certificate a UG applicant cannot have, and a
// caste certificate is meaningless for a General-category student. Every new
// field below earns its place by gating at least one document; none is a
// question staff answer for nothing.
import type { FieldDef, NewDocumentRequirement } from "./schema";

/* Vocabulary. A college says Student/Admission where a lender says
 * Borrower/Application — the same engine, different nouns. */
export const WORKFLOW = {
  name: "College Admissions",
  slug: "college-admissions",
  subjectLabel: "Student",
  caseLabel: "Admission",
} as const;

/* The 5 stages already live in production, kept exactly as they are. */
export const STAGES: { name: string; tone: string }[] = [
  { name: "New enquiry", tone: "muted" },
  { name: "Documents pending", tone: "teal" },
  { name: "Under review", tone: "amber" },
  { name: "Offer made", tone: "orange" },
  { name: "Enrolled", tone: "green" },
];

/**
 * Case fields.
 *
 * The first three already exist in production as free text. The rest are new
 * and are DROPDOWNS on purpose: a condition can only be evaluated against a
 * value it can compare, and "entrance_exam: CUET" as free text cannot answer
 * "was this an entrance-route admission?". Each new field gates a document.
 */
export const ADMISSION_FIELDS: FieldDef[] = [
  { field_key: "course_applied", label: "Course applied for", field_type: "string", input_type: "text", required: true, placeholder: "e.g. B.Sc Computer Science", order: 0, show_in_table: true },
  // Gates the degree documents. Left blank, PG-only items are simply not
  // asked for — the safe direction, since over-asking a UG applicant for a
  // degree certificate they cannot have is worse than asking later.
  { field_key: "course_level", label: "Course level", field_type: "enum", input_type: "dropdown", required: true, options: ["Undergraduate", "Postgraduate", "Diploma"], order: 1, show_in_table: true },
  { field_key: "admission_route", label: "Admission route", field_type: "enum", input_type: "dropdown", required: false, options: ["Entrance exam", "Merit based", "Counselling allotment", "Direct"], order: 2, show_in_table: true },
  { field_key: "entrance_exam", label: "Entrance exam", field_type: "string", input_type: "text", required: false, placeholder: "e.g. CUET, NEET, JEE", order: 3, show_in_table: true },
  // Drives the entire reservation document block. "General" asks for none.
  { field_key: "category", label: "Category", field_type: "enum", input_type: "dropdown", required: false, options: ["General", "OBC", "SC", "ST", "EWS", "PwD"], order: 4, show_in_table: true },
  { field_key: "seat_type", label: "Seat type", field_type: "enum", input_type: "dropdown", required: false, options: ["State quota", "All India", "Management", "NRI"], order: 5 },
  { field_key: "previous_school", label: "Previous school / college", field_type: "string", input_type: "text", required: false, order: 6 },
  { field_key: "has_gap", label: "Gap after last qualification?", field_type: "enum", input_type: "dropdown", required: false, options: ["No", "Yes"], order: 7 },
  { field_key: "scholarship", label: "Applying for a scholarship?", field_type: "enum", input_type: "dropdown", required: false, options: ["No", "Yes"], order: 8 },
];

/**
 * The checklist.
 *
 * Descriptions follow the standard migration 0015 set for Business Loan:
 * state what the document IS and, wherever a real confusion is likely, what
 * it is NOT. These are the only guidance the classifier receives, and a
 * student's folder is full of look-alikes — a marksheet and a passing
 * certificate arrive from the same board on the same day.
 *
 * `condition` gates an item on the case's own answers, exactly as the
 * Partnership Deed is gated on entity type in the lending workflow.
 */
export const DOCUMENT_REQUIREMENTS: Omit<
  NewDocumentRequirement,
  "tenantId" | "workflowId"
>[] = [
  /* ---- identity: unchanged keys, descriptions added ---- */
  // Named "Identity proof", not "Aadhaar", for the same reason as the lending
  // workflow: RBI accepts any one of six OVDs and Aadhaar cannot be compelled.
  { key: "id_proof", label: "Identity proof (Aadhaar, passport or voter ID)", description: "Any ONE government-issued photo identity document of the STUDENT: Aadhaar, passport, voter ID or driving licence. NOT a parent's or guardian's ID, and NOT a school-issued identity card.", required: true, reusable: true, position: 0 },
  { key: "passport_photo", label: "Passport photograph", description: "A standalone passport-size headshot of the student on a plain background. NOT a photograph cropped out of a certificate, marksheet or identity card.", required: true, reusable: true, validityDays: 1095, position: 1 },
  { key: "birth_certificate", label: "Birth certificate", description: "The municipal birth certificate, as proof of date of birth. A marksheet or school record that merely prints a date of birth is NOT this document.", required: true, reusable: true, position: 2 },

  /* ---- academic: school ---- */
  { key: "marksheet_10", label: "Class 10 marksheet", description: "The board's statement of marks for Class 10 / SSC. NOT the passing certificate, which is a separate document, and NOT the school leaving certificate.", required: true, reusable: true, position: 3 },
  { key: "certificate_10", label: "Class 10 passing certificate", description: "The board-issued certificate confirming the Class 10 pass. NOT the marksheet — this one certifies the result rather than listing subject marks.", required: true, reusable: true, position: 4 },
  { key: "marksheet_12", label: "Class 12 marksheet", description: "The board's statement of marks for Class 12 / HSC — the document admission ranks are usually computed from. NOT the passing certificate. Asked for at every course level, including postgraduate.", required: true, reusable: true, position: 5 },
  { key: "certificate_12", label: "Class 12 passing certificate", description: "The board-issued certificate confirming the Class 12 pass. NOT the marksheet.", required: true, reusable: true, position: 6 },

  /* ---- academic: degree (postgraduate only) ---- */
  { key: "degree_marksheets", label: "Degree marksheets (all semesters)", description: "Consolidated or semester-wise marksheets of the qualifying degree. ALL semesters or years, not only the final one. NOT the degree certificate.", required: true, reusable: true, condition: { field: "course_level", equals: "Postgraduate" }, maxFiles: 12, position: 7 },
  { key: "degree_certificate", label: "Degree / provisional certificate", description: "The degree certificate for the qualifying degree, or the provisional certificate where the degree has not yet been conferred. NOT a marksheet.", required: true, reusable: true, condition: { field: "course_level", equals: "Postgraduate" }, position: 8 },

  /* ---- admission route ---- */
  { key: "entrance_score", label: "Entrance exam score card", description: "The rank or score card for the entrance the seat was allotted on — CUET, JEE, NEET, CAT or a state CET. NOT the admit card or hall ticket, which is issued before the exam and carries no result.", required: true, reusable: false, validityDays: 365, condition: { field: "admission_route", equals: "Entrance exam" }, position: 9 },
  { key: "seat_allotment", label: "Seat allotment letter", description: "The allotment letter issued by the counselling authority naming this institution and course. NOT the entrance score card.", required: true, reusable: false, condition: { field: "admission_route", equals: "Counselling allotment" }, position: 10 },

  /* ---- transfer & conduct ---- */
  { key: "transfer_certificate", label: "Transfer certificate", description: "The transfer certificate or school leaving certificate from the last institution attended, proving the student has formally left it. NOT the migration certificate, which permits a change of board or university.", required: true, reusable: false, position: 11 },
  { key: "migration_certificate", label: "Migration certificate", description: "Issued by the previous board or university, permitting migration to another. NOT the transfer certificate. Needed only when the student is changing board or university.", required: false, reusable: false, position: 12 },
  { key: "character_certificate", label: "Character certificate", description: "The conduct or character certificate from the last institution attended.", required: true, reusable: false, validityDays: 365, position: 13 },
  { key: "gap_affidavit", label: "Gap year affidavit", description: "A notarised affidavit accounting for the break in education, naming the years concerned. Required only where there is a gap after the last qualification.", required: true, reusable: false, condition: { field: "has_gap", equals: "Yes" }, position: 14 },

  /* ---- category & quota ---- */
  { key: "caste_certificate", label: "Caste certificate", description: "The SC, ST or OBC certificate in the exact central or state format this institution requires. A certificate in the wrong format is routinely rejected at verification.", required: true, reusable: true, condition: { field: "category", in: ["OBC", "SC", "ST"] }, position: 15 },
  { key: "ncl_certificate", label: "Non-creamy-layer certificate", description: "The current-year non-creamy-layer certificate for OBC candidates. This EXPIRES — a certificate from an earlier financial year is not accepted. NOT the caste certificate itself.", required: true, reusable: false, validityDays: 365, condition: { field: "category", equals: "OBC" }, position: 16 },
  { key: "ews_certificate", label: "EWS certificate", description: "The Economically Weaker Section certificate in the prescribed format. NOT an income certificate, though it is issued on the basis of one.", required: true, reusable: false, validityDays: 365, condition: { field: "category", equals: "EWS" }, position: 17 },
  { key: "disability_certificate", label: "Disability certificate", description: "A UDID card or competent medical board certificate stating the percentage of disability.", required: true, reusable: true, condition: { field: "category", equals: "PwD" }, position: 18 },
  { key: "domicile_certificate", label: "Domicile / residence certificate", description: "The competent authority's certificate establishing state candidature. NOT an address proof such as a utility bill or rent agreement.", required: true, reusable: true, condition: { field: "seat_type", equals: "State quota" }, position: 19 },

  /* ---- means & scholarship ---- */
  { key: "income_certificate", label: "Income certificate", description: "The competent authority's income certificate. NOT a salary slip, NOT an income tax return and NOT a bank statement — those evidence income but are not this certificate.", required: true, reusable: false, validityDays: 365, condition: { field: "scholarship", equals: "Yes" }, position: 20 },
  { key: "bank_proof", label: "Bank account proof", description: "Passbook first page or a cancelled cheque in the STUDENT's name, for scholarship disbursement. A parent's account is not accepted.", required: true, reusable: true, condition: { field: "scholarship", equals: "Yes" }, position: 21 },

  /* ---- health & institutional ---- */
  { key: "medical_fitness", label: "Medical fitness certificate", description: "A registered medical practitioner's fitness certificate, often on the institution's own proforma. NOT a blood group report or a vaccination record.", required: false, reusable: false, validityDays: 180, position: 22 },
  { key: "antiragging_undertaking", label: "Anti-ragging undertaking", description: "The UGC anti-ragging affidavit signed by student and parent, filed on the UGC portal and printed with its reference number.", required: true, reusable: false, validityDays: 365, position: 23 },
  { key: "fee_receipt", label: "Fee payment receipt", description: "Proof of admission fee payment for this admission cycle. NOT a fee structure or demand note, which state what is owed rather than what was paid.", required: true, reusable: false, position: 24 },
];
