-- AI classification columns on documents (see apps/api/src/classify/classify.ts).
--
-- suggested_requirement_id: the slot the classifier believes this document
-- satisfies when it was NOT confident enough to file it itself — a human
-- confirms (copying it into requirement_id) or ignores it.
-- auto_filed: true when requirement_id was set by the classifier, so "who
-- filed this here?" is always answerable in the audit trail.
ALTER TABLE "documents" ADD COLUMN "suggested_requirement_id" uuid REFERENCES "document_requirements"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "classified_type" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "classification_confidence" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "classified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "auto_filed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_classification_confidence_check" CHECK ("classification_confidence" IS NULL OR "classification_confidence" IN ('high', 'medium', 'low'));
