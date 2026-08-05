-- Inbound documents that matched no case - the intake's holding pen.
-- Before this table, "left for a human" was a fiction: the mail cursor advances
-- past unmatched messages and Meta stops redelivering once we return 200, so an
-- unmatched document was simply lost. Now the bytes are stored on arrival and a
-- human routes them. Assignment INSERTS a real documents row (documents.case_id
-- stays NOT NULL); this row only records the resolution.
CREATE TABLE "unmatched_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "channel" text NOT NULL,
  "sender" text,
  "context" text,
  "file_name" text NOT NULL,
  "mime_type" text,
  "size_bytes" bigint,
  "checksum" text,
  "storage_key" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "assigned_case_id" uuid REFERENCES "cases"("id") ON DELETE SET NULL,
  "assigned_document_id" uuid REFERENCES "documents"("id") ON DELETE SET NULL,
  "resolved_at" timestamp with time zone,
  "resolved_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "discard_reason" text,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "unmatched_documents_channel_check" CHECK ("channel" IN ('email', 'whatsapp')),
  CONSTRAINT "unmatched_documents_status_check" CHECK ("status" IN ('pending', 'assigned', 'discarded'))
);--> statement-breakpoint
CREATE INDEX "unmatched_documents_tenant_idx" ON "unmatched_documents" ("tenant_id");--> statement-breakpoint
-- The queue read: this tenant's pending arrivals, newest first.
CREATE INDEX "unmatched_documents_tenant_status_idx" ON "unmatched_documents" ("tenant_id", "status", "received_at");--> statement-breakpoint
-- Redelivery dedupe scans pending rows by checksum.
CREATE INDEX "unmatched_documents_tenant_checksum_idx" ON "unmatched_documents" ("tenant_id", "checksum") WHERE "status" = 'pending';--> statement-breakpoint

-- RLS: tenant-scoped exactly like channels and case_messages. ALTER DEFAULT
-- PRIVILEGES grants the app role access the moment the table exists, so the
-- policy is what confines it.
ALTER TABLE "unmatched_documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "unmatched_documents" USING ("tenant_id" = current_tenant()) WITH CHECK ("tenant_id" = current_tenant());
