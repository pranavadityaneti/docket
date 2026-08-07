-- Link inbound documents back to the conversation message they arrived with.
-- Email uses Message-ID; WhatsApp uses Meta's message id. Lets the conversation
-- thread show attachment chips without stuffing bytes into conversation_messages.
ALTER TABLE "documents" ADD COLUMN "source_external_id" text;--> statement-breakpoint
CREATE INDEX "documents_case_source_ext_idx" ON "documents" ("case_id", "source_external_id") WHERE "source_external_id" IS NOT NULL;--> statement-breakpoint
