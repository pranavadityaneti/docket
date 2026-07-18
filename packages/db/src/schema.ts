import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  integer,
  bigint,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
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
