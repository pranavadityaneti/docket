-- Allow the journal to record an edit to a case's own details.
--
-- Editing a subject's email or phone is not cosmetic: those two fields are the
-- routing keys every inbound WhatsApp message and email is matched by, so a
-- change silently redirects where a borrower's documents land. That belongs in
-- the audit trail beside stage moves and document verdicts.

ALTER TABLE "case_events" DROP CONSTRAINT "case_events_kind_check";--> statement-breakpoint
ALTER TABLE "case_events" ADD CONSTRAINT "case_events_kind_check"
  CHECK ("kind" IN ('comment', 'stage_changed', 'document_reviewed', 'details_changed'));
