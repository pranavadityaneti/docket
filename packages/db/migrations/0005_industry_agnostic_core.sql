-- Make the core model industry-agnostic: leads -> cases, and strip the lending
-- vocabulary out of the schema so a college, a CA firm or an insurer is a
-- first-class tenant rather than a special case.
--
-- Written by hand, NOT generated. drizzle-kit would express these renames as
-- DROP + CREATE, which silently discards the Row-Level Security policies that
-- migration 0001 attached to these tables - tenant isolation would be gone with
-- no error anywhere. ALTER TABLE ... RENAME carries policies, indexes,
-- constraints and grants across intact.
--
-- Safe to run without a data migration: at time of writing production holds
-- 0 cases and 0 contacts.

ALTER TABLE "leads" RENAME TO "cases";--> statement-breakpoint
ALTER TABLE "lead_configs" RENAME TO "field_configs";--> statement-breakpoint

-- Indexes do not follow a table rename, so rename them too. Left alone they
-- would keep names like "leads_workflow_idx" on a table called "cases", and
-- drizzle would try to recreate them on the next generate.
ALTER INDEX "leads_tenant_idx" RENAME TO "cases_tenant_idx";--> statement-breakpoint
ALTER INDEX "leads_workflow_idx" RENAME TO "cases_workflow_idx";--> statement-breakpoint
ALTER INDEX "leads_stage_idx" RENAME TO "cases_stage_idx";--> statement-breakpoint
ALTER INDEX "lead_configs_tenant_idx" RENAME TO "field_configs_tenant_idx";--> statement-breakpoint

-- Constraints do not follow the rename either. This is not cosmetic: drizzle
-- derives foreign-key names from the table name, so leaving "leads_*_fk" on a
-- table called "cases" reads as drift and the next `drizzle-kit generate` would
-- try to drop and recreate all of them.
ALTER TABLE "cases" RENAME CONSTRAINT "leads_pkey" TO "cases_pkey";--> statement-breakpoint
ALTER TABLE "cases" RENAME CONSTRAINT "leads_tenant_id_tenants_id_fk" TO "cases_tenant_id_tenants_id_fk";--> statement-breakpoint
ALTER TABLE "cases" RENAME CONSTRAINT "leads_workflow_id_workflows_id_fk" TO "cases_workflow_id_workflows_id_fk";--> statement-breakpoint
ALTER TABLE "cases" RENAME CONSTRAINT "leads_contact_id_contacts_id_fk" TO "cases_contact_id_contacts_id_fk";--> statement-breakpoint
ALTER TABLE "cases" RENAME CONSTRAINT "leads_stage_id_workflow_stages_id_fk" TO "cases_stage_id_workflow_stages_id_fk";--> statement-breakpoint
ALTER TABLE "cases" RENAME CONSTRAINT "leads_owner_id_users_id_fk" TO "cases_owner_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "field_configs" RENAME CONSTRAINT "lead_configs_pkey" TO "field_configs_pkey";--> statement-breakpoint
ALTER TABLE "field_configs" RENAME CONSTRAINT "lead_configs_tenant_id_tenants_id_fk" TO "field_configs_tenant_id_tenants_id_fk";--> statement-breakpoint
ALTER TABLE "field_configs" RENAME CONSTRAINT "lead_configs_workflow_id_workflows_id_fk" TO "field_configs_workflow_id_workflows_id_fk";--> statement-breakpoint

-- Lending-specific columns become ordinary entries in the workflow's field
-- config, stored in cases.data. monthly_turnover is meaningless to a college;
-- loan_type to a hospital.
--
-- Carry the VALUES across before dropping the columns. The keys match the
-- field config (business-loan-config.ts), so an existing row keeps rendering
-- exactly as it did. jsonb_strip_nulls keeps the bag clean where a column was
-- null, and `data || ...` leaves any keys already there untouched.
UPDATE "cases" SET "data" = "data" || jsonb_strip_nulls(jsonb_build_object(
  'loan_amount',      "amount",
  'loan_type',        "loan_type",
  'entity_type',      "entity_type",
  'monthly_turnover', "monthly_turnover"
));--> statement-breakpoint

ALTER TABLE "cases" DROP COLUMN "amount";--> statement-breakpoint
ALTER TABLE "cases" DROP COLUMN "loan_type";--> statement-breakpoint
ALTER TABLE "cases" DROP COLUMN "entity_type";--> statement-breakpoint
ALTER TABLE "cases" DROP COLUMN "monthly_turnover";--> statement-breakpoint

-- Human-readable handle, quoted over WhatsApp/email and spoken to the voice bot.
-- Added nullable, backfilled, then constrained - adding it NOT NULL outright
-- fails the moment the table has a single row, which would make this migration
-- valid only against an empty database.
ALTER TABLE "cases" ADD COLUMN "reference" text;--> statement-breakpoint

-- Same Crockford base32 alphabet as generateCaseReference() - no I, L, O or U,
-- because these get read aloud. Six independent random() calls rather than a
-- subquery: a scalar subquery could be evaluated once and hand every row the
-- same reference, which the unique index below would then reject.
UPDATE "cases" SET "reference" = 'DKT-'
  || substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', 1 + floor(random() * 32)::int, 1)
  || substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', 1 + floor(random() * 32)::int, 1)
  || substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', 1 + floor(random() * 32)::int, 1)
  || substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', 1 + floor(random() * 32)::int, 1)
  || substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', 1 + floor(random() * 32)::int, 1)
  || substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', 1 + floor(random() * 32)::int, 1)
WHERE "reference" IS NULL;--> statement-breakpoint

ALTER TABLE "cases" ALTER COLUMN "reference" SET NOT NULL;--> statement-breakpoint
-- If the backfill ever collided, this index fails and drizzle rolls the whole
-- migration back - loud, not silent.
CREATE UNIQUE INDEX "cases_tenant_reference_uq" ON "cases" ("tenant_id","reference");--> statement-breakpoint

-- Per-workflow vocabulary, so the UI never hardcodes an industry's noun.
ALTER TABLE "workflows" ADD COLUMN "subject_label" text NOT NULL DEFAULT 'Contact';--> statement-breakpoint
ALTER TABLE "workflows" ADD COLUMN "case_label" text NOT NULL DEFAULT 'Case';--> statement-breakpoint

-- A subject may be a person or an organisation.
ALTER TABLE "contacts" ADD COLUMN "kind" text NOT NULL DEFAULT 'person';--> statement-breakpoint
ALTER TABLE "contacts" RENAME COLUMN "company" TO "organisation";--> statement-breakpoint

-- Inbound routing keys: every WhatsApp message and email that arrives is
-- matched back to a subject by phone or email, on the hot path.
CREATE INDEX "contacts_tenant_email_idx" ON "contacts" ("tenant_id","email");--> statement-breakpoint
CREATE INDEX "contacts_tenant_phone_idx" ON "contacts" ("tenant_id","phone");
