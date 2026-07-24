-- Outbound document requests and reminders, one row per channel delivery.
-- Both the audit trail and the reminder scheduler's memory (it reads the newest
-- successful row per case to decide what is due). Tenant-scoped like every case
-- artifact.
ALTER TABLE "cases" ADD COLUMN "nudges_paused_at" timestamp with time zone;--> statement-breakpoint

CREATE TABLE "case_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "case_id" uuid NOT NULL REFERENCES "cases"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "channel" text NOT NULL,
  "recipient" text NOT NULL,
  "subject" text,
  "items_snapshot" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "status" text NOT NULL,
  "error" text,
  "sent_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "case_messages_kind_check" CHECK ("kind" IN ('initial', 'reminder', 'manual')),
  CONSTRAINT "case_messages_channel_check" CHECK ("channel" IN ('email', 'whatsapp')),
  CONSTRAINT "case_messages_status_check" CHECK ("status" IN ('sent', 'failed'))
);--> statement-breakpoint
CREATE INDEX "case_messages_tenant_idx" ON "case_messages" ("tenant_id");--> statement-breakpoint
CREATE INDEX "case_messages_case_sent_idx" ON "case_messages" ("case_id", "sent_at");--> statement-breakpoint

-- RLS: tenant-scoped exactly like channels. ALTER DEFAULT PRIVILEGES grants the
-- app role access the moment the table exists, so the policy is what confines it.
ALTER TABLE "case_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "case_messages" USING ("tenant_id" = current_tenant()) WITH CHECK ("tenant_id" = current_tenant());
