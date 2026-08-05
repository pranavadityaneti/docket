-- Soft delete for cases and contacts.
--
-- NOT a hard delete, deliberately. Every case artifact cascades from cases -
-- documents, case_messages, conversation_messages, case_events - so DELETE
-- would destroy the borrower's KYC files AND the audit trail, including the
-- record of the deletion itself. A row that remembers it was deleted, by whom
-- and when, is the only version of this that an auditor can be shown.
--
-- The stored objects in S3 are deliberately left alone: documents already work
-- this way (see the unmatched_documents note), and destroying bytes is a
-- separate, explicit act.

ALTER TABLE "cases" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "deleted_by" uuid REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "deleted_by" uuid REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint

-- Every read filters on "not deleted", so index the live rows only: a partial
-- index stays small no matter how much is deleted.
CREATE INDEX "cases_live_idx" ON "cases" ("tenant_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "contacts_live_idx" ON "contacts" ("tenant_id") WHERE deleted_at IS NULL;--> statement-breakpoint

-- The journal records the act itself, so a restored case still shows what
-- happened to it.
ALTER TABLE "case_events" DROP CONSTRAINT "case_events_kind_check";--> statement-breakpoint
ALTER TABLE "case_events" ADD CONSTRAINT "case_events_kind_check"
  CHECK ("kind" IN ('comment', 'stage_changed', 'document_reviewed', 'details_changed', 'deleted', 'restored'));
