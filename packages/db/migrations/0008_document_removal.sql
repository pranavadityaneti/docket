-- ---------------------------------------------------------------------------
-- Document removal: soft-delete the row, hard-delete the file.
--
-- Staff need to take a document back — most often because the wrong file was
-- uploaded, sometimes one holding another person's KYC. That file has to
-- genuinely stop existing, so the application purges the stored object and
-- clears storage_key. What stays is the row: file name, checksum, size, and who
-- removed it when. A lender asked in an audit what became of a document it once
-- accepted can answer without still holding the document.
--
-- Nullable with no default and no backfill: every existing row is, correctly,
-- not deleted.
--
-- deleted_by is ON DELETE SET NULL to match reviewed_by. Removing a user from
-- the workspace must not cascade into destroying the removal records they made,
-- which is exactly the history an audit asks for.
-- ---------------------------------------------------------------------------
ALTER TABLE "documents" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "deleted_by" uuid REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "deletion_reason" text;--> statement-breakpoint

-- Every checklist read is "this case's documents that are still here". Without
-- deleted_at in the index that filter is applied after the fact on every read.
CREATE INDEX "documents_case_live_idx" ON "documents" ("case_id") WHERE "deleted_at" IS NULL;
