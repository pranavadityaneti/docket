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
  /**
   * Show this field as a column on the Cases table. Config, not code: which
   * domain values earn a column is the tenant's call ("Loan Type" for a lender,
   * "Course" for a college), and hardcoding one industry's picks is exactly the
   * leak this flag closes. The UI caps how many it renders.
   */
  show_in_table?: boolean;
  /** Display hint. "inr" renders an integer as Indian-format currency. */
  format?: "inr";
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

/** Kinds of inbound channel a tenant can operate. */
export const CHANNEL_KINDS = ["email", "whatsapp"] as const;
export type ChannelKind = (typeof CHANNEL_KINDS)[number];

/** Kinds of outbound document-request message. */
export const MESSAGE_KINDS = ["initial", "reminder", "manual"] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

export const CASE_EVENT_KINDS = [
  "comment",
  "stage_changed",
  "document_reviewed",
  "details_changed",
  "deleted",
  "restored",
] as const;
export type CaseEventKind = (typeof CASE_EVENT_KINDS)[number];

/** One item Docket is (still) asking a subject for, captured on each message. */
export type NudgeSnapshotItem = {
  key: string;
  label: string;
  state: "missing" | "rejected";
  reason?: string;
};

/** Non-secret channel settings. Credentials never live here — see secretCiphertext. */
export type ChannelConfig = {
  /** email: IMAP host/port, e.g. imap.gmail.com / 993 */
  imapHost?: string;
  imapPort?: number;
  imapUser?: string;
  /** whatsapp: Meta phone-number id the webhook delivers for. */
  phoneNumberId?: string;
  [key: string]: unknown;
};

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

/**
 * One-time password-reset tokens. GLOBAL (per-user), not tenant-scoped: a reset
 * is about a person, who may belong to several tenants. Reached only via the
 * owner role in the pre-auth flow, exactly as `login` reads `users`. No
 * tenant_id and no RLS — see migration 0009, which also revokes the app role's
 * auto-granted access so the tenant-scoped role can never read tokens.
 */
export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    // sha256(raw) hex — the raw token lives only in the emailed link.
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    // NULL until consumed; set when the reset succeeds or the token is superseded.
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("password_reset_tokens_token_hash_idx").on(t.tokenHash),
    index("password_reset_tokens_user_idx").on(t.userId),
  ],
);

/**
 * A tenant's own inbound channel — the mailbox or WhatsApp number a subject
 * actually writes to.
 *
 * Per-tenant by design, and that is the product, not a detail: Docket is
 * white-labelled, so a borrower must see their own lender's address, never
 * ours. One shared inbox would give the game away the moment a second customer
 * signed up. Adding a tenant is a row here, not a code change.
 *
 * Credentials (mailbox password, WhatsApp token) are stored ONLY as
 * `secretCiphertext` — AES-256-GCM, see secret-box.ts — and are never returned
 * by the API or written to logs. `config` holds the non-secret half.
 */
export const channels = pgTable(
  "channels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: CHANNEL_KINDS }).notNull(),
    /** What the subject sees: docs@theirbank.com, or +91XXXXXXXXXX. */
    address: text("address").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    config: jsonb("config").$type<ChannelConfig>().notNull().default(sql`'{}'::jsonb`),
    secretCiphertext: text("secret_ciphertext"),
    /**
     * Where polling got to — IMAP UIDVALIDITY/UID for mail. Opaque to everything
     * but the poller; kept so a restart resumes instead of re-importing every
     * message in the mailbox as new documents.
     */
    cursor: text("cursor"),
    lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
    /** Last failure, surfaced in the UI so a broken mailbox is visible not silent. */
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("channels_tenant_idx").on(t.tenantId),
    // One address per kind per tenant; re-adding the same mailbox is a mistake.
    uniqueIndex("channels_tenant_kind_address_uq").on(t.tenantId, t.kind, t.address),
    // The poller asks "which channels are due?" across all tenants.
    index("channels_kind_enabled_idx").on(t.kind, t.enabled),
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
    /** Soft delete — see migration 0019 on why this is not a DELETE. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "set null" }),
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
    /**
     * Set when staff pause automated document requests for this case. Null =
     * active. The reminder cron skips paused cases; a manual "Request documents"
     * still works — pause stops the machine, not the person.
     */
    nudgesPausedAt: timestamp("nudges_paused_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * Soft delete. Every case artifact cascades from this row, so a real
     * DELETE would take the borrower's documents and the audit trail with it
     * — including the record of the deletion. See migration 0019.
     */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by").references(() => users.id, { onDelete: "set null" }),
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

    /* ---- AI classification (see classify.ts) ---- */
    /**
     * The slot the classifier believes this document satisfies, when it was
     * NOT confident enough to file it there itself. A human confirms or
     * ignores; confirming copies this into requirementId.
     */
    suggestedRequirementId: uuid("suggested_requirement_id").references(
      () => documentRequirements.id,
      { onDelete: "set null" },
    ),
    /** What the classifier read the document AS ("Aadhaar card", "bank statement"). */
    classifiedType: text("classified_type"),
    classificationConfidence: text("classification_confidence", {
      enum: ["high", "medium", "low"],
    }),
    classifiedAt: timestamp("classified_at", { withTimezone: true }),
    /**
     * True when requirementId was set by the classifier rather than a person.
     * The audit question "who filed this here?" must always be answerable.
     */
    autoFiled: boolean("auto_filed").notNull().default(false),
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

/**
 * One outbound document request or reminder, per channel delivered.
 *
 * This is both the audit trail ("what did we ask for, when, on which channel?")
 * and the reminder scheduler's memory: the cron decides what is due by reading
 * the newest successful row for a case. Snapshotting the items asked for
 * (itemsSnapshot) keeps the audit honest even after the checklist later changes.
 */
export const caseMessages = pgTable(
  "case_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    caseId: uuid("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: MESSAGE_KINDS }).notNull(),
    // Reuses CHANNEL_KINDS — an outbound message goes over the same kinds of
    // channel a subject writes in on.
    channel: text("channel", { enum: CHANNEL_KINDS }).notNull(),
    /** The address/number it was sent to, for audit. */
    recipient: text("recipient").notNull(),
    /** Email subject; null for WhatsApp (template-driven). */
    subject: text("subject"),
    itemsSnapshot: jsonb("items_snapshot")
      .$type<NudgeSnapshotItem[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    status: text("status", { enum: ["sent", "failed"] }).notNull(),
    /** Populated when status = 'failed'. */
    error: text("error"),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("case_messages_tenant_idx").on(t.tenantId),
    // The reminder cron and the case screen both read "this case's messages,
    // newest first".
    index("case_messages_case_sent_idx").on(t.caseId, t.sentAt),
  ],
);

/**
 * The case's written journal — notes people leave and things that happened.
 *
 * One table serves both because they are the same thing to a reader: "what
 * went on here, and who did it". `kind` says which; comments carry `body`
 * (optionally pinned to a checklist item via requirement_id — "special
 * instructions on THIS document"), events carry a small `data` payload
 * (stage from/to, review verdicts).
 *
 * author_name is denormalised on purpose: the journal is an audit trail, and
 * "who said this" must survive the author's account being deleted. author_id
 * stays for joins while the account lives; the name is what history keeps.
 */
export const caseEvents = pgTable(
  "case_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    caseId: uuid("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
    /** Set when a comment is pinned to one checklist item. */
    requirementId: uuid("requirement_id").references(() => documentRequirements.id, {
      onDelete: "set null",
    }),
    kind: text("kind", { enum: CASE_EVENT_KINDS }).notNull(),
    /** Null for system-written events. */
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    authorName: text("author_name"),
    /** Comment text; null for events. */
    body: text("body"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("case_events_tenant_idx").on(t.tenantId),
    // The journal is always read "this case, newest first".
    index("case_events_case_created_idx").on(t.caseId, t.createdAt),
  ],
);

/**
 * The words of the conversation — one row per inbound message that matched a
 * case (and, later, per outbound reply sent from the dashboard).
 *
 * Documents were always kept; the TEXT around them was thrown away, so
 * "what did the borrower actually say?" had no answer. This table is that
 * answer. Outbound document requests stay in case_messages (they are the
 * reminder scheduler's memory); the conversation read merges both.
 *
 * external_id (email Message-ID / WhatsApp message id) carries a partial
 * unique index: redelivery and poller races collapse into one row instead of
 * a duplicated thread — same lesson as document checksums.
 */
export const conversationMessages = pgTable(
  "conversation_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    caseId: uuid("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
    channel: text("channel", { enum: CHANNEL_KINDS }).notNull(),
    direction: text("direction", { enum: ["inbound", "outbound"] }).notNull(),
    /** Email address or phone number the message came from (or went to). */
    sender: text("sender").notNull(),
    /** Email subject; null for WhatsApp. */
    subject: text("subject"),
    /** Message text, clamped at write. May be empty for a bare attachment. */
    body: text("body").notNull().default(""),
    /** Provider id used for dedup; null when the provider gave none. */
    externalId: text("external_id"),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("conversation_messages_tenant_idx").on(t.tenantId),
    // The thread is always read "this case, in order".
    index("conversation_messages_case_sent_idx").on(t.caseId, t.sentAt),
    uniqueIndex("conversation_messages_external_uq")
      .on(t.tenantId, t.channel, t.externalId)
      .where(sql`external_id IS NOT NULL`),
  ],
);

/**
 * An inbound document that matched no case — the intake's holding pen.
 *
 * The matchers are deliberately conservative: a wrong match files a borrower's
 * bank statement onto someone else's loan, so anything uncertain lands here
 * instead. Before this table, "left for a human" was a fiction — the poller's
 * cursor advances past unmatched mail and Meta stops redelivering once we 200,
 * so an unmatched document was simply lost. Now the bytes are stored the
 * moment they arrive, and routing is a ten-second staff action.
 *
 * A row never becomes a document by mutation: assignment INSERTS a real
 * documents row (documents.caseId stays NOT NULL, the checklist model intact)
 * pointing at the same storage object, and marks this row assigned. Discarded
 * rows keep their object for audit; deleting bytes is a separate, explicit act.
 */
export const unmatchedDocuments = pgTable(
  "unmatched_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    /** Which intake it arrived on. Reuses CHANNEL_KINDS. */
    channel: text("channel", { enum: CHANNEL_KINDS }).notNull(),
    /** The address/number it came from — the strongest routing clue. */
    sender: text("sender"),
    /** Email subject or WhatsApp caption — the human-readable clue. */
    context: text("context"),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    /** SHA-256; dedupes redeliveries while the row is still pending. */
    checksum: text("checksum"),
    storageKey: text("storage_key").notNull(),
    status: text("status", { enum: ["pending", "assigned", "discarded"] })
      .notNull()
      .default("pending"),
    /* ---- resolution audit ---- */
    assignedCaseId: uuid("assigned_case_id").references(() => cases.id, { onDelete: "set null" }),
    /** The documents row this became, when assigned. */
    assignedDocumentId: uuid("assigned_document_id").references(() => documents.id, {
      onDelete: "set null",
    }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: uuid("resolved_by").references(() => users.id, { onDelete: "set null" }),
    discardReason: text("discard_reason"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("unmatched_documents_tenant_idx").on(t.tenantId),
    // The queue read: this tenant's pending arrivals, newest first.
    index("unmatched_documents_tenant_status_idx").on(t.tenantId, t.status, t.receivedAt),
    // Redelivery dedupe scans pending rows by checksum.
    index("unmatched_documents_tenant_checksum_idx")
      .on(t.tenantId, t.checksum)
      .where(sql`${t.status} = 'pending'`),
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
export type CaseMessage = typeof caseMessages.$inferSelect;
export type UnmatchedDocument = typeof unmatchedDocuments.$inferSelect;
