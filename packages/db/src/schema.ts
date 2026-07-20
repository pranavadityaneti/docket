import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  integer,
  bigint,
  boolean,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

/* ------------------------------------------------------------------ *
 * Docket data model — industry-agnostic core.
 *
 * Docket collects documents from a subject on behalf of a tenant. The
 * tenant may be a lender, a college, a CA firm, an insurer, a hospital —
 * so NOTHING here names an industry. A tenant runs `workflows`; each
 * workflow owns its own vocabulary, its own fields, and (from Change 2)
 * its own document checklist. Anything domain-specific — loan amount,
 * course applied for, claim number — lives in `cases.data`, described by
 * that workflow's field config. No industry gets first-class columns.
 *
 * Multi-tenant: every tenant-scoped table carries `tenant_id`, and
 * Row-Level Security (see migrations/*_rls.sql) enforces isolation at
 * the database, not in application code.
 * ------------------------------------------------------------------ */

/** Shape of one configurable case field (stored in field_configs.fields). */
export type FieldDef = {
  field_key: string;
  label: string;
  field_type: "string" | "integer" | "enum";
  input_type: "text" | "number" | "dropdown" | "textarea";
  required: boolean;
  options?: string[];
  validation?: Record<string, unknown>;
  placeholder?: string;
  order: number;
};

/** A subject is the party documents are collected FROM: a person or an organisation. */
export const SUBJECT_KINDS = ["person", "organisation"] as const;
export type SubjectKind = (typeof SUBJECT_KINDS)[number];

export const ROLES = ["owner", "admin", "agent", "reviewer"] as const;
export type Role = (typeof ROLES)[number];

/**
 * Lifecycle of one received document.
 *
 * `needs_review` is deliberately distinct from `rejected`. The AI rejects only
 * when it is confident the document is wrong — the wrong type, or belonging to
 * someone else. When it is merely unsure (a poor scan, or an Indian name that
 * varies legitimately between documents: "P. A. Neti" vs "Pranav Aditya Neti"),
 * it must park the document for a human instead. Auto-rejecting a genuine
 * document tells a real customer their real PAN card is fake, which is worse
 * than making a colleague glance at it.
 */
export const DOCUMENT_STATUSES = [
  "received",
  "needs_review",
  "accepted",
  "rejected",
  "expired",
] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

/** How a document reached us. The product's premise is that most arrive conversationally. */
export const DOCUMENT_CHANNELS = ["whatsapp", "email", "upload", "import", "api"] as const;
export type DocumentChannel = (typeof DOCUMENT_CHANNELS)[number];

/**
 * Optional gate on a checklist item: include this requirement only when the
 * case's `data` satisfies it. Lending needs a Partnership Deed only from a
 * partnership; a college needs a transfer certificate only from transferring
 * students. Without this, every workflow would need a separate checklist per
 * permutation.
 */
export type RequirementCondition = {
  /** A key in cases.data, as named by the workflow's field config. */
  field: string;
  /** Include when the value equals this, or is one of these. */
  equals?: string | number | boolean;
  in?: (string | number)[];
};

/* ------------------------------- tenancy + identity ------------------------------- */

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  plan: text("plan").notNull().default("trial"),
  branding: jsonb("branding").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  avatarUrl: text("avatar_url"),
  // argon2id hash; NULL = no password set yet (e.g. invited-but-not-activated).
  passwordHash: text("password_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    role: text("role", { enum: ROLES }).notNull().default("agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("memberships_user_tenant_uq").on(t.userId, t.tenantId),
    index("memberships_tenant_idx").on(t.tenantId),
  ],
);

/* ------------------------------- workflows (a process a tenant runs) ------------------------------- */

export const workflows = pgTable(
  "workflows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    // Vocabulary. A lender says Borrower/Application, a college says
    // Student/Admission, a CA firm says Client/Engagement. The UI reads these
    // rather than hardcoding a noun, which is what stops Docket being a
    // lending tool with other industries bolted on.
    subjectLabel: text("subject_label").notNull().default("Contact"),
    caseLabel: text("case_label").notNull().default("Case"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("workflows_tenant_slug_uq").on(t.tenantId, t.slug),
    index("workflows_tenant_idx").on(t.tenantId),
  ],
);

export const workflowStages = pgTable(
  "workflow_stages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    workflowId: uuid("workflow_id").notNull().references(() => workflows.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: integer("position").notNull(),
    tone: text("tone").notNull().default("muted"),
  },
  (t) => [
    index("workflow_stages_workflow_idx").on(t.workflowId),
    index("workflow_stages_tenant_idx").on(t.tenantId),
  ],
);

export const fieldConfigs = pgTable(
  "field_configs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    workflowId: uuid("workflow_id").notNull().references(() => workflows.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    fields: jsonb("fields").$type<FieldDef[]>().notNull().default(sql`'[]'::jsonb`),
    visibleRoles: jsonb("visible_roles").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("field_configs_tenant_idx").on(t.tenantId)],
);

/** The party documents are collected FROM — borrower, student, client, vendor. */
export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: SUBJECT_KINDS }).notNull().default("person"),
    name: text("name").notNull(),
    // Set when the subject IS an organisation, or when a person is acting for
    // one (a borrower's business, a candidate's employer). Was `company`.
    organisation: text("organisation"),
    email: text("email"),
    phone: text("phone"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("contacts_tenant_idx").on(t.tenantId),
    // Email and phone are the routing keys for inbound documents: every
    // WhatsApp message and every email that arrives is matched back to a
    // subject through these, so they are looked up on the hot path.
    index("contacts_tenant_email_idx").on(t.tenantId, t.email),
    index("contacts_tenant_phone_idx").on(t.tenantId, t.phone),
  ],
);

/** One instance of a workflow: a loan application, an admission, an audit engagement. */
export const cases = pgTable(
  "cases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    workflowId: uuid("workflow_id").notNull().references(() => workflows.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    stageId: uuid("stage_id").references(() => workflowStages.id, { onDelete: "set null" }),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    // Human-readable handle (DKT-7F3K2M). Quoted in WhatsApp and email, and
    // read aloud to the voice bot — hence a short, unambiguous alphabet
    // rather than a UUID or a sequence. See generateCaseReference().
    reference: text("reference").notNull(),
    // How the case arrived (Website, WhatsApp, Email, Referral, Import, API).
    // Structural, not domain-specific — it describes the channel, not the industry.
    source: text("source"),
    // Every domain-specific value lives here, described by the workflow's
    // field config: loan_amount and entity_type for a lender, course_applied
    // for a college, claim_number for an insurer.
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("cases_tenant_idx").on(t.tenantId),
    index("cases_workflow_idx").on(t.workflowId),
    index("cases_stage_idx").on(t.stageId),
    uniqueIndex("cases_tenant_reference_uq").on(t.tenantId, t.reference),
  ],
);

/* ------------------------------- documents ------------------------------- */

/**
 * The checklist for a workflow: WHAT must be collected. Config, not user data —
 * this is what an AI-generated blueprint writes, and what a tenant admin edits.
 *
 * Deliberately per-workflow rather than global: a college's "Transfer
 * Certificate" and a lender's "GST Returns" have nothing to say to each other,
 * and a shared taxonomy would force every tenant into one vocabulary.
 */
export const documentRequirements = pgTable(
  "document_requirements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    workflowId: uuid("workflow_id").notNull().references(() => workflows.id, { onDelete: "cascade" }),
    /** Stable machine key ("pan_card"). What the AI classifier matches against. */
    key: text("key").notNull(),
    label: text("label").notNull(),
    description: text("description"),
    required: boolean("required").notNull().default(true),
    /** Allowed MIME types, e.g. ["application/pdf","image/jpeg"]. Empty = anything. */
    accepts: jsonb("accepts").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    /** Bank statements may be 12 files; a PAN card is 1. */
    maxFiles: integer("max_files").notNull().default(1),
    /**
     * Can this be pulled forward from the subject's other cases?
     * TRUE for identity documents (PAN, Aadhaar, degree certificate) — they
     * describe the person and do not change. FALSE for case-specific ones
     * (property papers, this year's admission letter, this claim's FIR).
     */
    reusable: boolean("reusable").notNull().default(false),
    /**
     * How long an accepted document stays valid, in days. NULL = forever.
     * This is what stops a six-month-old bank statement being silently reused
     * into a fresh credit decision — the reuse rule is "reusable AND not
     * expired", never "we already have one".
     */
    validityDays: integer("validity_days"),
    /** Include this requirement only when the case data matches (see RequirementCondition). */
    condition: jsonb("condition").$type<RequirementCondition | null>(),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("document_requirements_tenant_idx").on(t.tenantId),
    index("document_requirements_workflow_idx").on(t.workflowId),
    // The classifier resolves an inbound file to a requirement by key, and a
    // workflow must not define the same key twice.
    uniqueIndex("document_requirements_workflow_key_uq").on(t.workflowId, t.key),
  ],
);

/**
 * A document actually received for a case — the heart of the product.
 *
 * Files arrive conversationally (a borrower photographs their PAN and replies
 * on WhatsApp; a student emails three marksheets), so a row here may exist
 * before anyone knows which requirement it satisfies: `requirementId` is
 * nullable precisely so an unrecognised file is captured rather than dropped.
 */
export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    caseId: uuid("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
    /** NULL until classified — an arrived-but-unrecognised file, for a human to place. */
    requirementId: uuid("requirement_id").references(() => documentRequirements.id, {
      onDelete: "set null",
    }),

    /* ---- the file ---- */
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    /** SHA-256. Detects the same file sent twice across two channels. */
    checksum: text("checksum"),
    /** Object-store key. NULL until storage lands (Change 3). */
    storageKey: text("storage_key"),

    /* ---- lifecycle ---- */
    status: text("status", { enum: DOCUMENT_STATUSES }).notNull().default("received"),
    /** Why it was rejected — shown to staff AND used to compose the re-ask message. */
    rejectionReason: text("rejection_reason"),
    /** Set on acceptance from the requirement's validityDays. NULL = does not expire. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),

    /* ---- provenance ---- */
    sourceChannel: text("source_channel", { enum: DOCUMENT_CHANNELS }),
    /** The WhatsApp number / email address it actually came from, for audit. */
    sourceIdentifier: text("source_identifier"),
    /**
     * Set when this document was carried over from another case of the same
     * subject rather than collected again. Keeps the audit trail honest: staff
     * can see it was originally supplied on DKT-7F3K2M in March.
     */
    reusedFromId: uuid("reused_from_id").references((): AnyPgColumn => documents.id, {
      onDelete: "set null",
    }),

    /* ---- review ---- */
    /** NULL means no human has confirmed it — the AI alone decided. */
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),

    /* ---- removal ---- */
    /*
     * A soft delete of the ROW paired with a hard delete of the FILE — the only
     * combination that serves both reasons a document gets removed.
     *
     * The usual reason is a mistake: the wrong file, sometimes one holding
     * another person's KYC. That must genuinely stop existing, so the stored
     * object is purged and storage_key cleared. But a lender asked in an audit
     * what became of a document it once accepted cannot answer "no idea", so
     * the row survives with its file name, checksum and size — enough to say
     * what the file was and who removed it when, without keeping the file.
     *
     * Every read path must filter on deleted_at IS NULL. A soft delete that
     * leaks into one query is worse than no delete at all, because the record
     * reappears somewhere nobody is looking for it.
     */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "set null" }),
    deletionReason: text("deletion_reason"),

    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("documents_tenant_idx").on(t.tenantId),
    // "show me this case's documents" — the dashboard's main read.
    index("documents_case_idx").on(t.caseId),
    index("documents_requirement_idx").on(t.requirementId),
    // "what still needs a human?" — the exceptions queue.
    index("documents_tenant_status_idx").on(t.tenantId, t.status),
    // Cross-channel duplicate detection (same file on WhatsApp and email).
    index("documents_tenant_checksum_idx").on(t.tenantId, t.checksum),
    // Every checklist read is "this case's documents that are still here", so
    // the live-only filter belongs in the index rather than being applied to
    // the result of a wider scan.
    index("documents_case_live_idx").on(t.caseId).where(sql`${t.deletedAt} is null`),
  ],
);

/* ------------------------------- inferred types ------------------------------- */

export type Tenant = typeof tenants.$inferSelect;
export type User = typeof users.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type Workflow = typeof workflows.$inferSelect;
export type WorkflowStage = typeof workflowStages.$inferSelect;
export type FieldConfig = typeof fieldConfigs.$inferSelect;
export type Contact = typeof contacts.$inferSelect;
export type Case = typeof cases.$inferSelect;
export type NewCase = typeof cases.$inferInsert;
export type DocumentRequirement = typeof documentRequirements.$inferSelect;
export type NewDocumentRequirement = typeof documentRequirements.$inferInsert;
export type DocumentRow = typeof documents.$inferSelect;
export type NewDocumentRow = typeof documents.$inferInsert;
