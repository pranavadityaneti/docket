-- Allow inbound chat alerts in the workspace bell.
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_kind_check";--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_kind_check" CHECK ("kind" IN (
  'document_received',
  'document_needs_review',
  'unmatched',
  'follow_up_due',
  'comment',
  'stage_changed',
  'message',
  'generic'
));
