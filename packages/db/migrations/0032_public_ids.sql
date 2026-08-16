-- Server-issued public IDs: DPT (tenants), DPU (users), DPC (cases).
ALTER TABLE "tenants" ADD COLUMN "public_id" text;--> statement-breakpoint
UPDATE "tenants"
SET "public_id" = 'DPT-' || upper(substr(replace("id"::text, '-', ''), 1, 7))
WHERE "public_id" IS NULL;--> statement-breakpoint
UPDATE "tenants" t
SET "public_id" = 'DPT-' || upper(substr(replace("id"::text, '-', ''), 8, 7))
WHERE t."public_id" IN (
  SELECT "public_id" FROM "tenants" GROUP BY "public_id" HAVING count(*) > 1
);--> statement-breakpoint
ALTER TABLE "tenants" ALTER COLUMN "public_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_public_id_unique" UNIQUE ("public_id");--> statement-breakpoint

UPDATE "users"
SET "login_id" = 'DPU-' || upper(substr(replace("id"::text, '-', ''), 1, 7))
WHERE "login_id" !~* '^DPU-[0-9A-Z]{7}$';--> statement-breakpoint
UPDATE "users" u
SET "login_id" = 'DPU-' || upper(substr(replace("id"::text, '-', ''), 8, 7))
WHERE u."login_id" IN (
  SELECT "login_id" FROM "users" GROUP BY "login_id" HAVING count(*) > 1
);--> statement-breakpoint
UPDATE "users"
SET "login_id" = upper("login_id")
WHERE "login_id" <> upper("login_id");--> statement-breakpoint

UPDATE "cases"
SET "reference" = 'DPC-' || upper(substr(replace("id"::text, '-', ''), 1, 7))
WHERE "reference" !~* '^DPC-[0-9A-Z]{7}$';--> statement-breakpoint
UPDATE "cases" c
SET "reference" = 'DPC-' || upper(substr(replace("id"::text, '-', ''), 8, 7))
WHERE (c."tenant_id", c."reference") IN (
  SELECT "tenant_id", "reference" FROM "cases" GROUP BY "tenant_id", "reference" HAVING count(*) > 1
);--> statement-breakpoint
UPDATE "cases"
SET "reference" = upper("reference")
WHERE "reference" <> upper("reference");
