-- The words of the conversation. Documents were always kept; the text around
-- them was thrown away, so "what did the borrower actually say?" had no
-- answer. One row per inbound message that matched a case (outbound document
-- requests stay in case_messages; reads merge both). The partial unique index
-- on external_id collapses provider redelivery and poller races into one row -
-- the same lesson as document checksums.

CREATE TABLE "conversation_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "case_id" uuid NOT NULL REFERENCES "cases"("id") ON DELETE CASCADE,
  "channel" text NOT NULL,
  "direction" text NOT NULL,
  "sender" text NOT NULL,
  "subject" text,
  "body" text DEFAULT '' NOT NULL,
  "external_id" text,
  "sent_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "conversation_messages_channel_check" CHECK ("channel" IN ('email', 'whatsapp')),
  CONSTRAINT "conversation_messages_direction_check" CHECK ("direction" IN ('inbound', 'outbound'))
);--> statement-breakpoint
CREATE INDEX "conversation_messages_tenant_idx" ON "conversation_messages" ("tenant_id");--> statement-breakpoint
CREATE INDEX "conversation_messages_case_sent_idx" ON "conversation_messages" ("case_id", "sent_at");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_messages_external_uq" ON "conversation_messages" ("tenant_id", "channel", "external_id") WHERE external_id IS NOT NULL;--> statement-breakpoint

-- RLS: tenant-scoped exactly like every case artifact.
ALTER TABLE "conversation_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "conversation_messages" USING ("tenant_id" = current_tenant()) WITH CHECK ("tenant_id" = current_tenant());
