-- Human-assigned User ID for tenant login (with email + password).
ALTER TABLE "users" ADD COLUMN "login_id" text;--> statement-breakpoint
UPDATE "users"
SET "login_id" = lower(split_part("email", '@', 1))
WHERE "login_id" IS NULL;--> statement-breakpoint
UPDATE "users" u
SET "login_id" = u."login_id" || '-' || substr(replace(u."id"::text, '-', ''), 1, 8)
WHERE u."login_id" IN (
  SELECT "login_id" FROM "users" GROUP BY "login_id" HAVING count(*) > 1
);--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "login_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_login_id_unique" UNIQUE ("login_id");
