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
 * Docket data model — v1 (Phase B0).
 * Multi-tenant: every tenant-scoped table carries `tenant_id`, and
 * Row-Level Security (see migrations/*_rls.sql) enforces isolation at
 * the database. Configurable/variable fields live in JSONB.
 * ------------------------------------------------------------------ */

/** Shape of one configurable lead field (stored in lead_configs.fields). */
export type LeadFieldDef = {
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

/* ------------------------------- pipeline (Sales → Leads) ------------------------------- */

export const workflows = pgTable(
  "workflows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
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

export const leadConfigs = pgTable(
  "lead_configs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    workflowId: uuid("workflow_id").notNull().references(() => workflows.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    fields: jsonb("fields").$type<LeadFieldDef[]>().notNull().default(sql`'[]'::jsonb`),
    visibleRoles: jsonb("visible_roles").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("lead_configs_tenant_idx").on(t.tenantId)],
);

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    company: text("company"),
    email: text("email"),
    phone: text("phone"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("contacts_tenant_idx").on(t.tenantId)],
);

export const leads = pgTable(
  "leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    workflowId: uuid("workflow_id").notNull().references(() => workflows.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    stageId: uuid("stage_id").references(() => workflowStages.id, { onDelete: "set null" }),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    // display / filter fields
    amount: bigint("amount", { mode: "number" }),
    loanType: text("loan_type"),
    entityType: text("entity_type"),
    source: text("source"),
    monthlyTurnover: bigint("monthly_turnover", { mode: "number" }),
    // remaining configurable field values (pan_number, funds_needed, …)
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("leads_tenant_idx").on(t.tenantId),
    index("leads_workflow_idx").on(t.workflowId),
    index("leads_stage_idx").on(t.stageId),
  ],
);

/* ------------------------------- inferred types ------------------------------- */

export type Tenant = typeof tenants.$inferSelect;
export type User = typeof users.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type Workflow = typeof workflows.$inferSelect;
export type WorkflowStage = typeof workflowStages.$inferSelect;
export type LeadConfig = typeof leadConfigs.$inferSelect;
export type Contact = typeof contacts.$inferSelect;
export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;
