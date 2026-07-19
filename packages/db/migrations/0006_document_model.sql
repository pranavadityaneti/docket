-- The document model: WHAT a workflow needs collected, and WHAT actually arrived.
--
-- This is the product. Everything before it was the frame: tenants, workflows,
-- cases. A tenant defines a checklist per workflow (document_requirements) and
-- files land against it (documents), whichever channel they come in on.
--
-- ⚠ RLS IS NOT AUTOMATIC ON NEW TABLES.
-- Migration 0002 ran ALTER DEFAULT PRIVILEGES, so docket_app is granted
-- SELECT/INSERT/UPDATE/DELETE on these tables the moment they are created — but
-- a new table has RLS *disabled*, and a table with RLS disabled ignores every
-- policy. Without the ENABLE + CREATE POLICY statements at the bottom of this
-- file, docket_app could read every tenant's documents, on the two tables that
-- will hold PAN cards, Aadhaar and bank statements. Grants arrive by default;
-- isolation must be asked for.

CREATE TABLE "document_requirements" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id"      uuid NOT NULL,
  "workflow_id"    uuid NOT NULL,
  -- Stable machine key ("pan_card") — what the AI classifier matches against.
  "key"            text NOT NULL,
  "label"          text NOT NULL,
  "description"    text,
  "required"       boolean NOT NULL DEFAULT true,
  -- Allowed MIME types; empty array = accept anything.
  "accepts"        jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Bank statements may be 12 files; a PAN card is 1.
  "max_files"      integer NOT NULL DEFAULT 1,
  -- TRUE only for documents that describe the PERSON and do not change (PAN,
  -- Aadhaar, degree certificate). FALSE for anything about this specific case.
  "reusable"       boolean NOT NULL DEFAULT false,
  -- Days an accepted document stays valid; NULL = forever. Paired with
  -- `reusable`, this is what stops a stale bank statement being carried into a
  -- fresh credit decision.
  "validity_days"  integer,
  -- Optional gate: include only when the case data matches, e.g.
  -- {"field":"entity_type","equals":"Partnership"}.
  "condition"      jsonb,
  "position"       integer NOT NULL DEFAULT 0,
  "created_at"     timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE "documents" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id"         uuid NOT NULL,
  "case_id"           uuid NOT NULL,
  -- NULL = arrived but not yet matched to a requirement. Nullable on purpose:
  -- a borrower photographs something and replies on WhatsApp, and an
  -- unrecognised file must be captured for a human, never dropped.
  "requirement_id"    uuid,
  "file_name"         text NOT NULL,
  "mime_type"         text,
  "size_bytes"        bigint,
  -- SHA-256: catches the same file sent twice across two channels.
  "checksum"          text,
  -- Object-store key. NULL until storage lands (Change 3).
  "storage_key"       text,
  "status"            text NOT NULL DEFAULT 'received',
  "rejection_reason"  text,
  "expires_at"        timestamp with time zone,
  "source_channel"    text,
  -- The WhatsApp number / email address it actually came from, for audit.
  "source_identifier" text,
  -- Set when carried over from another case of the same subject, so staff can
  -- see it was originally supplied elsewhere and when.
  "reused_from_id"    uuid,
  -- NULL = no human has confirmed it; the AI alone decided.
  "reviewed_by"       uuid,
  "reviewed_at"       timestamp with time zone,
  "received_at"       timestamp with time zone DEFAULT now() NOT NULL,
  "created_at"        timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

-- Values are constrained in the database as well as in TypeScript: a bad status
-- written by a future migration, a script, or psql would otherwise sit there
-- silently and break the exceptions queue.
ALTER TABLE "documents" ADD CONSTRAINT "documents_status_check"
  CHECK ("status" IN ('received','needs_review','accepted','rejected','expired'));--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_source_channel_check"
  CHECK ("source_channel" IS NULL OR "source_channel" IN ('whatsapp','email','upload','import','api'));--> statement-breakpoint

ALTER TABLE "document_requirements" ADD CONSTRAINT "document_requirements_tenant_id_tenants_id_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "document_requirements" ADD CONSTRAINT "document_requirements_workflow_id_workflows_id_fk"
  FOREIGN KEY ("workflow_id") REFERENCES "workflows"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenant_id_tenants_id_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_case_id_cases_id_fk"
  FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE cascade;--> statement-breakpoint
-- set null, not cascade: deleting a checklist item must not delete the files
-- a borrower already sent. They become unclassified, for a human to re-place.
ALTER TABLE "documents" ADD CONSTRAINT "documents_requirement_id_document_requirements_id_fk"
  FOREIGN KEY ("requirement_id") REFERENCES "document_requirements"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_reused_from_id_documents_id_fk"
  FOREIGN KEY ("reused_from_id") REFERENCES "documents"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_reviewed_by_users_id_fk"
  FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE set null;--> statement-breakpoint

CREATE INDEX "document_requirements_tenant_idx" ON "document_requirements" ("tenant_id");--> statement-breakpoint
CREATE INDEX "document_requirements_workflow_idx" ON "document_requirements" ("workflow_id");--> statement-breakpoint
-- A workflow must not define the same key twice; the classifier resolves by key.
CREATE UNIQUE INDEX "document_requirements_workflow_key_uq" ON "document_requirements" ("workflow_id","key");--> statement-breakpoint
CREATE INDEX "documents_tenant_idx" ON "documents" ("tenant_id");--> statement-breakpoint
CREATE INDEX "documents_case_idx" ON "documents" ("case_id");--> statement-breakpoint
CREATE INDEX "documents_requirement_idx" ON "documents" ("requirement_id");--> statement-breakpoint
-- "what still needs a human?" — the exceptions queue.
CREATE INDEX "documents_tenant_status_idx" ON "documents" ("tenant_id","status");--> statement-breakpoint
-- Cross-channel duplicate detection.
CREATE INDEX "documents_tenant_checksum_idx" ON "documents" ("tenant_id","checksum");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Row-Level Security. Same shape as 0001. Without these two pairs of
-- statements both tables are readable across every tenant by the app role.
-- ---------------------------------------------------------------------------
ALTER TABLE "document_requirements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "document_requirements" USING ("tenant_id" = current_tenant()) WITH CHECK ("tenant_id" = current_tenant());--> statement-breakpoint
ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "documents" USING ("tenant_id" = current_tenant()) WITH CHECK ("tenant_id" = current_tenant());
